// ============================================================
// Supabase-compatible query builder backed by MongoDB.
//
// Reproduces the PostgREST API surface the app actually uses:
//   select (with count/head, single/maybeSingle), insert, update,
//   delete, upsert, eq/neq/gt/gte/lt/lte/in/is/like/ilike/contains/
//   match/or, order, limit, range, and embedded joins
//   (`*, contact:contacts(*)`, `stage:pipeline_stages(name)`,
//    `contact_tags!inner(tag_id)`, …).
//
// Account scoping (the RLS model in migrations/017+) is applied
// inside `execute()` for the user client; the service client skips it.
// ============================================================

import { collection } from "./connection";
import { TABLES, RELATIONS, FK_HINTS, roleAtLeast, type TableDef } from "./schema";
import { recordChange } from "./realtime";
import type { AccountRole } from "./schema";

export type SessionUser = {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown>;
  account_id: string | null;
  account_role: AccountRole | null;
};

export type QueryContext = {
  /** Set for the user client; service client leaves this unset. */
  user?: SessionUser;
  /** Service role bypasses all scoping. */
  service?: boolean;
};

export interface PostgrestErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

function rlsError(message: string, code = "42501"): PostgrestErrorLike {
  return { message, code };
}

function makeError(err: unknown): PostgrestErrorLike {
  if (err && typeof err === "object" && "message" in err) {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    return {
      message: e.message ?? "Unknown error",
      code: e.code ?? "PGRST000",
      details: e.details,
      hint: e.hint,
    };
  }
  return { message: String(err), code: "PGRST000" };
}

// ============================================================
// Filter model
// ============================================================

export type FilterOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "like"
  | "ilike" | "contains" | "match" | "or";

export interface Filter {
  op: FilterOp;
  column: string;
  value: unknown;
}

export interface Order {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

// ============================================================
// Select-clause parser
// ============================================================

export interface EmbedSpec {
  alias: string;
  table: string;
  hint: string | null; // "inner" | fkey hint | null
  inner: boolean;
  columns: string[] | null; // null = "*" | list of columns
  embeds: EmbedSpec[];
}

export interface ParsedSelect {
  columns: string[] | null; // null = "*"
  embeds: EmbedSpec[];
}

const TOKEN_SPLIT_RE = /\s*,/;

function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const EMBED_RE = /^([A-Za-z_]\w*):([A-Za-z_]\w*)!?([A-Za-z_]\w*)?\(([\s\S]*)\)$/;
const EMBED_NOALIAS_RE = /^([A-Za-z_]\w*)!?([A-Za-z_]\w*)?\(([\s\S]*)\)$/;

function parseEmbedClause(clause: string, def: TableDef | undefined, visited: Set<string>): EmbedSpec {
  const m = clause.match(EMBED_RE);
  if (m) {
    const [, alias, table, hintRaw, innerCols] = m;
    const hint = hintRaw ?? null;
    return buildEmbed(alias, table, hint, innerCols, visited);
  }
  const m2 = clause.match(EMBED_NOALIAS_RE);
  if (m2) {
    const [, table, hintRaw, innerCols] = m2;
    return buildEmbed(table, table, hintRaw ?? null, innerCols, visited);
  }
  throw new Error(`Cannot parse embed clause: ${clause}`);
}

function buildEmbed(
  alias: string,
  table: string,
  hint: string | null,
  innerCols: string,
  visited: Set<string>,
): EmbedSpec {
  const inner = hint === "inner";
  const parsed = parseSelectInner(innerCols, visited);
  return { alias, table, hint, inner, columns: parsed.columns, embeds: parsed.embeds };
}

export function parseSelectInner(input: string, visited: Set<string> = new Set()): ParsedSelect {
  const trimmed = input.trim();
  if (trimmed === "") return { columns: null, embeds: [] };
  const tokens = splitTopLevel(trimmed);
  const columns: string[] = [];
  const embeds: EmbedSpec[] = [];
  for (const tok of tokens) {
    if (/\(/.test(tok) && !/^[A-Za-z_]\w*$/.test(tok)) {
      embeds.push(parseEmbedClause(tok, undefined, visited));
    } else {
      columns.push(tok);
    }
  }
  return { columns: columns.length ? columns : null, embeds };
}

export function parseSelect(input: string): ParsedSelect {
  return parseSelectInner(input);
}

// ============================================================
// Or() grammar parser (PostgREST filter syntax)
// ============================================================

type OrNode =
  | { type: "cond"; column: string; op: string; value: string }
  | { type: "and"; children: OrNode[] }
  | { type: "not"; child: OrNode };

function parseOrExpression(input: string): OrNode[] {
  const nodes: OrNode[] = [];
  const parts = splitOrTopLevel(input);
  for (const part of parts) {
    if (part.startsWith("and(") && part.endsWith(")")) {
      nodes.push({ type: "and", children: parseOrExpression(part.slice(4, -1)) });
    } else if (part.startsWith("not.and(") && part.endsWith(")")) {
      nodes.push({
        type: "not",
        child: { type: "and", children: parseOrExpression(part.slice(8, -1)) },
      });
    } else {
      const idx = part.indexOf(".");
      if (idx === -1) continue;
      const column = part.slice(0, idx);
      const rest = part.slice(idx + 1);
      const dot = rest.indexOf(".");
      if (dot === -1) {
        nodes.push({ type: "cond", column, op: rest, value: "" });
      } else {
        const op = rest.slice(0, dot);
        let value = rest.slice(dot + 1);
        // PostgREST may wrap values in parens: col.eq.(val)
        if (value.startsWith("(") && value.endsWith(")")) value = value.slice(1, -1);
        nodes.push({ type: "cond", column, op, value });
      }
    }
  }
  return nodes;
}

function splitOrTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function wildcardToRegex(pattern: string): RegExp {
  // PostgREST * and SQL % both act as wildcards
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, (c) =>
    c === "*" ? ".*" : c === "\\" ? "\\\\" : `\\${c}`,
  );
  const regexStr = escaped.replace(/%/g, ".*");
  return new RegExp(`^${regexStr}$`);
}

// ============================================================
// Mongo filter builders
// ============================================================

function valueToMongo(v: unknown): unknown {
  return v;
}

export function buildMongoFilter(filters: Filter[]): Record<string, unknown> {
  const conds: Record<string, unknown>[] = [];
  for (const f of filters) {
    conds.push(buildSingleFilter(f));
  }
  if (conds.length === 0) return {};
  if (conds.length === 1) return conds[0];
  return { $and: conds };
}

function buildSingleFilter(f: Filter): Record<string, unknown> {
  const col = f.column;
  switch (f.op) {
    case "eq":
      return { [col]: valueToMongo(f.value) };
    case "neq":
      return { [col]: { $ne: valueToMongo(f.value) } };
    case "gt":
      return { [col]: { $gt: valueToMongo(f.value) } };
    case "gte":
      return { [col]: { $gte: valueToMongo(f.value) } };
    case "lt":
      return { [col]: { $lt: valueToMongo(f.value) } };
    case "lte":
      return { [col]: { $lte: valueToMongo(f.value) } };
    case "in": {
      const vals = Array.isArray(f.value) ? f.value : [f.value];
      return { [col]: { $in: vals } };
    }
    case "is":
      if (f.value === null) return { [col]: null };
      if (f.value === true) return { [col]: true };
      if (f.value === false) return { [col]: false };
      return { [col]: valueToMongo(f.value) };
    case "like": {
      const pattern = String(f.value);
      return { [col]: { $regex: wildcardToRegex(pattern.replace(/%/g, "*")) } };
    }
    case "ilike": {
      const pattern = String(f.value);
      const re = wildcardToRegex(pattern.replace(/%/g, "*"));
      return { [col]: { $regex: re.source, $options: "i" } };
    }
    case "contains": {
      const vals = Array.isArray(f.value) ? f.value : [f.value];
      return { [col]: { $all: vals } };
    }
    case "match": {
      // PostgREST `.match()` — every key/value must match (AND of eq)
      const obj = f.value as Record<string, unknown>;
      const sub: Record<string, unknown>[] = [];
      for (const [k, v] of Object.entries(obj)) sub.push({ [k]: v });
      return sub.length === 1 ? sub[0] : { $and: sub };
    }
    case "or": {
      const expr = String(f.value);
      const nodes = parseOrExpression(expr);
      const mongo = nodesToMongo(nodes);
      return Array.isArray(mongo) && mongo.length === 1 ? mongo[0] : { $or: mongo };
    }
    default:
      return { [col]: valueToMongo(f.value) };
  }
}

function nodesToMongo(nodes: OrNode[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const n of nodes) {
    if (n.type === "cond") {
      out.push(orCondToMongo(n));
    } else if (n.type === "and") {
      out.push({ $and: nodesToMongo(n.children) });
    } else if (n.type === "not") {
      out.push({ $not: nodesToMongo([n.child])[0] });
    }
  }
  return out;
}

function orCondToMongo(c: { column: string; op: string; value: string }): Record<string, unknown> {
  const { column, op, value } = c;
  switch (op) {
    case "eq":
      return { [column]: value };
    case "neq":
      return { [column]: { $ne: value } };
    case "gt":
      return { [column]: { $gt: value } };
    case "gte":
      return { [column]: { $gte: value } };
    case "lt":
      return { [column]: { $lt: value } };
    case "lte":
      return { [column]: { $lte: value } };
    case "is":
      if (value === "null") return { [column]: null };
      if (value === "true") return { [column]: true };
      if (value === "false") return { [column]: false };
      return { [column]: value };
    case "in": {
      const vals = value.split(",");
      return { [column]: { $in: vals } };
    }
    case "like": {
      return { [column]: { $regex: wildcardToRegex(value) } };
    }
    case "ilike": {
      const re = wildcardToRegex(value);
      return { [column]: { $regex: re.source, $options: "i" } };
    }
    default:
      return { [column]: value };
  }
}

// ============================================================
// Builder state
// ============================================================

export interface BuilderState {
  table: string;
  mode: "select" | "insert" | "update" | "delete" | "upsert";
  selectCols: string | null;
  selectOpts: { count?: "exact"; head?: boolean } | null;
  filters: Filter[];
  orders: Order[];
  limitN: number | null;
  rangeVals: [number, number] | null;
  singleMode: "none" | "single" | "maybeSingle";
  insertRows: Record<string, unknown>[] | null;
  upsertRows: Record<string, unknown>[] | null;
  upsertOnConflict: string | null;
  upsertIgnore: boolean;
  updateSet: Record<string, unknown> | null;
  deleteOpts: { count?: "exact" } | null;
  returnCols: string | null;
}

export function newState(table: string): BuilderState {
  return {
    table,
    mode: "select",
    selectCols: null,
    selectOpts: null,
    filters: [],
    orders: [],
    limitN: null,
    rangeVals: null,
    singleMode: "none",
    insertRows: null,
    upsertRows: null,
    upsertOnConflict: null,
    upsertIgnore: false,
    updateSet: null,
    deleteOpts: null,
    returnCols: null,
  };
}

function isEmbeddedFilter(f: Filter): boolean {
  return f.column.includes(".");
}

// ============================================================
// Account scoping (RLS equivalent)
// ============================================================

const ROOT_TABLES = new Set<string>(Object.keys(TABLES));

function tableDef(table: string): TableDef | undefined {
  return TABLES[table];
}

/**
 * Returns the chain of tables from `table` up to its account-scoped
 * root. E.g. message_reactions -> messages -> conversations.
 */
function parentChain(table: string): string[] {
  const chain: string[] = [table];
  let current = table;
  const guard = new Set<string>();
  while (!guard.has(current)) {
    guard.add(current);
    const def = TABLES[current];
    if (!def || def.kind !== "child" || !def.parent) break;
    current = def.parent.table;
    chain.push(current);
  }
  return chain;
}

async function resolveAllowedParentIds(ctx: QueryContext, table: string): Promise<{
  column: string;
  ids: string[];
} | null> {
  const def = TABLES[table];
  if (!def || def.kind !== "child" || !def.parent) return null;
  // Walk up to the account root, collecting the id set at each level.
  let ids: string[] | null = null;
  let current = def.parent.table;
  // The child's fk column referencing `current`
  let fkColumn = def.parent.fk;
  let level = 1;
  for (;;) {
    const currentDef = TABLES[current];
    if (!currentDef) return null;
    if (currentDef.kind === "account") {
      const rows = (await collection(current)
        .find({ account_id: ctx.user!.account_id })
        .project({ _id: 0, id: 1 })
        .toArray()) as Array<{ id: string }>;
      const parentIds = rows.map((p) => p.id);
      return { column: fkColumn, ids: parentIds };
    }
    if (currentDef.kind === "child" && currentDef.parent) {
      const parent = currentDef.parent;
      const rows = (await collection(current)
        .find({ [fkColumn]: { $in: ids ?? [] } })
        .project({ _id: 0, id: 1 })
        .toArray()) as Array<{ id: string }>;
      const parentIds = rows.map((p) => p.id);
      // Descend one level: rows in the NEXT child table reference `current`
      // through `parent.fk` (the fk on the deeper child pointing at `current`).
      const nextChild = current;
      const deeperFk = parent.fk;
      const deeper = (await collection(nextChild)
        .find({ [deeperFk]: { $in: parentIds } })
        .project({ _id: 0, [parent.fk]: 1 })
        .toArray()) as Array<Record<string, unknown>>;
      const deeperIds = Array.from(
        new Set(deeper.map((d) => d[parent.fk]).filter(Boolean) as string[]),
      );
      if (level === 1) return { column: fkColumn, ids: deeperIds };
      ids = deeperIds;
    }
    level++;
    if (level > 6) return null;
  }
}

/**
 * Returns filters that implement RLS scoping for the user client, or
 * an error object for unauthorized writes.
 */
export async function scopeFilters(
  ctx: QueryContext,
  table: string,
  mode: BuilderState["mode"],
  state: BuilderState,
): Promise<{ filters: Filter[]; error?: PostgrestErrorLike }> {
  if (ctx.service || !ctx.user) return { filters: [] };
  const user = ctx.user;
  const def = tableDef(table);
  if (!def) return { filters: [] };

  const isWrite = mode !== "select";
  const accountId = user.account_id;

  // ---- account-scoped parent tables ---------------------------
  if (def.kind === "account") {
    const minRead = def.minReadRole ?? "viewer";
    if (!isWrite) {
      if (!roleAtLeast(user.account_role, minRead)) {
        return { filters: [], error: rlsError("Permission denied for read") };
      }
      if (!accountId) return { filters: [], error: rlsError("Not part of an account") };
      return { filters: [{ op: "eq", column: "account_id", value: accountId }] };
    }
    if (!roleAtLeast(user.account_role, def.minWriteRole ?? "viewer")) {
      return { filters: [], error: rlsError("Permission denied for write") };
    }
    if (!accountId) return { filters: [], error: rlsError("Not part of an account") };
    // Insert/upsert stamp account_id on the rows.
    if (mode === "insert" && state.insertRows) {
      for (const row of state.insertRows) row.account_id = accountId;
    }
    if (mode === "upsert" && state.upsertRows) {
      for (const row of state.upsertRows) row.account_id = accountId;
    }
    return {
      filters: [{ op: "eq", column: "account_id", value: accountId }],
    };
  }

  // ---- user-scoped (notifications) ---------------------------
  if (def.kind === "user") {
    if (mode === "insert") {
      for (const row of state.insertRows ?? []) row.user_id = user.id;
      return { filters: [{ op: "eq", column: "user_id", value: user.id }] };
    }
    if (isWrite && !roleAtLeast(user.account_role, def.minWriteRole ?? "viewer")) {
      return { filters: [], error: rlsError("Permission denied for write") };
    }
    return { filters: [{ op: "eq", column: "user_id", value: user.id }] };
  }

  // ---- child tables -------------------------------------------
  if (def.kind === "child" && def.parent) {
    const resolved = await resolveAllowedParentIds(ctx, table);
    if (!isWrite) {
      if (resolved) {
        return {
          filters: [{ op: "in", column: resolved.column, value: resolved.ids }],
        };
      }
      return { filters: [{ op: "in", column: def.parent.fk, value: [] }] };
    }
    if (!roleAtLeast(user.account_role, def.minWriteRole ?? "viewer")) {
      return { filters: [], error: rlsError("Permission denied for write") };
    }
    if (!resolved) {
      return { filters: [], error: rlsError("Permission denied for write") };
    }
    // The written rows must reference a parent inside the account.
    if (mode === "insert" || mode === "upsert") {
      const rows = mode === "insert" ? state.insertRows! : state.upsertRows!;
      for (const row of rows) {
        const fkVal = row[def.parent.fk];
        if (!resolved.ids.includes(String(fkVal))) {
          return {
            filters: [],
            error: rlsError("new row violates row-level security policy"),
          };
        }
      }
      return { filters: [{ op: "in", column: resolved.column, value: resolved.ids }] };
    }
    return { filters: [{ op: "in", column: resolved.column, value: resolved.ids }] };
  }

  // ---- profiles ----------------------------------------------
  if (def.kind === "profile") {
    if (mode === "insert") {
      for (const row of state.insertRows ?? []) row.user_id = user.id;
      return { filters: [{ op: "eq", column: "user_id", value: user.id }] };
    }
    if (isWrite) {
      return { filters: [{ op: "eq", column: "user_id", value: user.id }] };
    }
    // read: own row OR any row in my account
    const orFilter: Filter = {
      op: "or",
      column: "",
      value: `user_id.eq.${user.id}`,
    };
    if (accountId) {
      return {
        filters: [
          {
            op: "or",
            column: "",
            value: `user_id.eq.${user.id},account_id.eq.${accountId}`,
          },
        ],
      };
    }
    return { filters: [orFilter] };
  }

  // ---- accounts ----------------------------------------------
  if (def.kind === "accountRow") {
    if (!accountId) return { filters: [], error: rlsError("Not part of an account") };
    if (isWrite && !roleAtLeast(user.account_role, "admin")) {
      return { filters: [], error: rlsError("Permission denied for write") };
    }
    return { filters: [{ op: "eq", column: "id", value: accountId }] };
  }

  // ---- account_invitations -----------------------------------
  if (def.kind === "invitations") {
    if (!roleAtLeast(user.account_role, "admin")) {
      return { filters: [], error: rlsError("Permission denied") };
    }
    if (mode === "insert") {
      for (const row of state.insertRows ?? []) row.account_id = accountId;
    }
    return { filters: [{ op: "eq", column: "account_id", value: accountId }] };
  }

  return { filters: [] };
}

// ============================================================
// Embedded joins
// ============================================================

type Row = Record<string, unknown>;

function resolveRelation(parentTable: string, childTable: string, hint: string | null): {
  kind: "parentCol" | "childCol";
  parentCol: string;
  childCol: string;
} | null {
  if (hint && hint !== "inner") {
    const byHint = FK_HINTS[hint];
    if (byHint) return byHint;
  }
  const rel = RELATIONS[`${parentTable}.${childTable}`];
  if (rel) return rel;
  // reverse lookup
  const rel2 = RELATIONS[`${childTable}.${parentTable}`];
  if (rel2) {
    // Swap direction.
    if (rel2.kind === "parentCol") {
      return { kind: "childCol", parentCol: rel2.childCol, childCol: rel2.parentCol };
    }
    return { kind: "parentCol", parentCol: rel2.childCol, childCol: rel2.parentCol };
  }
  return null;
}

async function attachEmbeds(
  rows: Row[],
  embeds: EmbedSpec[],
  embeddedFilters: Filter[],
  ctx: QueryContext,
  parentTable: string,
): Promise<Row[]> {
  for (const embed of embeds) {
    const rel = resolveRelation(parentTable, embed.table, embed.hint);
    if (!rel) {
      // Unknown relationship: attach nothing rather than crash.
      continue;
    }
    const alias = embed.alias;
    const filterForEmbed = embeddedFilters.filter((f) => {
      const dot = f.column.indexOf(".");
      const prefix = f.column.slice(0, dot);
      return prefix === alias;
    });
    const embedFilterCols = new Set(
      filterForEmbed.map((f) => f.column.slice(f.column.indexOf(".") + 1)),
    );

    if (rel.kind === "parentCol") {
      // to-one: parent[parentCol] -> child.id
      const ids = Array.from(
        new Set(rows.map((r) => r[rel.parentCol]).filter(Boolean) as string[]),
      );
      if (ids.length === 0) {
        for (const r of rows) r[alias] = null;
        continue;
      }
      const childFilter: Record<string, unknown> = { [rel.childCol]: { $in: ids } };
      for (const f of filterForEmbed) {
        const col = f.column.slice(f.column.indexOf(".") + 1);
        Object.assign(childFilter, buildSingleFilter({ ...f, column: col }));
      }
      const projection = buildEmbedProjection(embed.columns);
      const children = await collection(embed.table)
        .find(childFilter)
        .project({ _id: 0, ...projection })
        .toArray();
      const byPk = new Map<string, Row>();
      for (const c of children) {
        byPk.set(String(c[rel.childCol]), c);
      }
      const nextRows: Row[] = [];
      for (const r of rows) {
        const pk = r[rel.parentCol] == null ? null : String(r[rel.parentCol]);
        const match = pk != null ? byPk.get(pk) : undefined;
        if (embed.inner && !match) continue; // inner join drops the parent
        const withNested = match
          ? await attachEmbeds([match], embed.embeds, filterForEmbed, ctx, embed.table)
          : [];
        r[alias] = withNested.length ? withNested[0] : null;
        nextRows.push(r);
      }
      rows = nextRows;
    } else {
      // to-many: child[childCol] -> parent.id
      const parentIds = rows.map((r) => r[rel.parentCol]).filter(Boolean) as string[];
      if (parentIds.length === 0) {
        for (const r of rows) r[alias] = [];
        continue;
      }
      const childFilter: Record<string, unknown> = { [rel.childCol]: { $in: parentIds } };
      for (const f of filterForEmbed) {
        const col = f.column.slice(f.column.indexOf(".") + 1);
        Object.assign(childFilter, buildSingleFilter({ ...f, column: col }));
      }
      const projection = buildEmbedProjection(embed.columns);
      const children = await collection(embed.table)
        .find(childFilter)
        .project({ _id: 0, ...projection })
        .toArray();
      const grouped = new Map<string, Row[]>();
      for (const c of children) {
        const key = String(c[rel.childCol]);
        const list = grouped.get(key) ?? [];
        list.push(c);
        grouped.set(key, list);
      }
      const nextRows: Row[] = [];
      for (const r of rows) {
        const list = grouped.get(String(r[rel.parentCol])) ?? [];
        const withNested = await attachEmbeds(list, embed.embeds, filterForEmbed, ctx, embed.table);
        if (embed.inner && withNested.length === 0) continue;
        r[alias] = withNested;
        nextRows.push(r);
      }
      rows = nextRows;
    }
  }
  return rows;
}

function buildEmbedProjection(columns: string[] | null): Record<string, 1> {
  if (!columns) return {};
  const out: Record<string, 1> = {};
  for (const c of columns) {
    const name = c.trim();
    if (!name || name === "*" || name.includes("(")) continue;
    out[name] = 1;
  }
  return out;
}

// ============================================================
// Postgres-compatible ordering
// ============================================================

function orderRows(rows: Row[], orders: Order[]): Row[] {
  if (orders.length === 0) return rows;
  const cmp = (a: unknown, b: unknown, asc: boolean, nullsFirst: boolean): number => {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return nullsFirst ? -1 : 1;
    if (bNull) return nullsFirst ? 1 : -1;
    if (typeof a === "number" && typeof b === "number") return asc ? a - b : b - a;
    const sa = String(a);
    const sb = String(b);
    const t = sa < sb ? -1 : sa > sb ? 1 : 0;
    return asc ? t : -t;
  };
  return [...rows].sort((x, y) => {
    for (const o of orders) {
      const c = cmp(x[o.column], y[o.column], o.ascending, o.nullsFirst);
      if (c !== 0) return c;
    }
    return 0;
  });
}

function mongoSortSpec(orders: Order[]): Record<string, 1 | -1> {
  const out: Record<string, 1 | -1> = {};
  for (const o of orders) {
    out[o.column] = o.ascending ? 1 : -1;
  }
  return out;
}

// ============================================================
// Execution
// ============================================================

function nowIso(): string {
  return new Date().toISOString();
}

function ensureId(row: Row): Row {
  if (!row.id) row.id = crypto.randomUUID();
  if (!row.created_at) row.created_at = nowIso();
  return row;
}

export async function executeQuery(
  state: BuilderState,
  ctx: QueryContext,
): Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }> {
  try {
    const { filters: scope, error } = await scopeFilters(ctx, state.table, state.mode, state);
    if (error) return { data: null, count: null, error };
    const allFilters = [...state.filters, ...scope];
    const embeddedFilters = allFilters.filter(isEmbeddedFilter);
    const topFilters = allFilters.filter((f) => !isEmbeddedFilter(f));

    switch (state.mode) {
      case "select":
        return execSelect(state, ctx, topFilters, embeddedFilters);
      case "insert":
        return execInsert(state, ctx, topFilters);
      case "update":
        return execUpdate(state, ctx, topFilters);
      case "delete":
        return execDelete(state, ctx, topFilters);
      case "upsert":
        return execUpsert(state, ctx, topFilters);
      default:
        return { data: null, count: null, error: makeError(new Error(`Unknown mode ${state.mode}`)) };
    }
  } catch (err) {
    return { data: null, count: null, error: makeError(err) };
  }
}

async function execSelect(
  state: BuilderState,
  ctx: QueryContext,
  topFilters: Filter[],
  embeddedFilters: Filter[],
): Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }> {
  const parsed = parseSelect(state.selectCols ?? "*");
  const mongoFilter = buildMongoFilter(topFilters);

  const { count: countOpt, head } = state.selectOpts ?? {};
  const coll = collection(state.table);

  let count: number | null = null;
  if (countOpt === "exact") {
    count = await coll.countDocuments(mongoFilter);
  }

  if (head) {
    return { data: null, count, error: null };
  }

  const projection: Record<string, 1 | 0> = {};
  if (parsed.columns) {
    for (const c of parsed.columns) {
      if (c !== "*") projection[c] = 1;
    }
  }

  const cursor = coll.find(mongoFilter);
  const hasSort = state.orders.length > 0;
  if (hasSort) cursor.sort(mongoSortSpec(state.orders));

  let rows = await cursor.project({ _id: 0, ...projection }).toArray();

  // Postgres-compatible null placement (asc -> nulls last, desc -> nulls first)
  if (hasSort && state.orders.some((o) => rows.some((r) => r[o.column] == null))) {
    rows = orderRows(rows, state.orders);
  } else if (hasSort) {
    rows = orderRows(rows, state.orders);
  }

  // Limit / range applied after ordering.
  let from = 0;
  let to = rows.length;
  if (state.limitN !== null) {
    to = Math.min(to, state.limitN);
  }
  if (state.rangeVals) {
    from = Math.min(from + state.rangeVals[0], rows.length);
    to = Math.min(state.rangeVals[1] + 1, rows.length);
  }
  let page = rows.slice(from, to);

  // Embedded joins
  if (parsed.embeds.length > 0) {
    page = await attachEmbeds(page, parsed.embeds, embeddedFilters, ctx, state.table);
  }

  if (state.singleMode === "single") {
    if (page.length === 0) {
      return {
        data: null,
        count,
        error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
      };
    }
    if (page.length > 1) {
      return {
        data: null,
        count,
        error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
      };
    }
    return { data: page[0], count, error: null };
  }
  if (state.singleMode === "maybeSingle") {
    return { data: page.length === 1 ? page[0] : null, count, error: null };
  }

  return { data: page, count, error: null };
}

async function execInsert(
  state: BuilderState,
  ctx: QueryContext,
  topFilters: Filter[],
): Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }> {
  const rows = (state.insertRows ?? []).map((r) => ensureId({ ...r }));
  const result = await collection(state.table).insertMany(rows, { ordered: false });
  for (const row of rows) {
    await recordChange(state.table, "INSERT", row, null);
  }
  return { data: rows, count: result.insertedCount, error: null };
}

async function execUpdate(
  state: BuilderState,
  ctx: QueryContext,
  topFilters: Filter[],
): Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }> {
  const mongoFilter = buildMongoFilter(topFilters);
  const set: Record<string, unknown> = { ...(state.updateSet ?? {}) };
  if (!set.updated_at) set.updated_at = nowIso();
  // Return the updated rows (PostgREST returns representation by default).
  const docs = await collection(state.table)
    .find(mongoFilter)
    .project({ _id: 0 })
    .toArray();
  const ids = docs.map((d) => d.id).filter(Boolean) as string[];
  if (ids.length > 0) {
    await collection(state.table).updateMany(
      { id: { $in: ids } },
      { $set: set },
    );
  }
  const updated = docs.map((d) => ({ ...d, ...set }));
  for (const d of docs) {
    await recordChange(state.table, "UPDATE", { ...d, ...set }, d);
  }
  return { data: updated, count: ids.length, error: null };
}

async function execDelete(
  state: BuilderState,
  ctx: QueryContext,
  topFilters: Filter[],
): Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }> {
  const mongoFilter = buildMongoFilter(topFilters);
  const docs = await collection(state.table)
    .find(mongoFilter)
    .project({ _id: 0 })
    .toArray();
  const ids = docs.map((d) => d.id).filter(Boolean) as string[];
  if (ids.length > 0) {
    await collection(state.table).deleteMany({ id: { $in: ids } });
  }
  for (const d of docs) {
    await recordChange(state.table, "DELETE", null, d);
  }
  return { data: docs, count: ids.length, error: null };
}

async function execUpsert(
  state: BuilderState,
  ctx: QueryContext,
  topFilters: Filter[],
): Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }> {
  const rows = state.upsertRows ?? [];
  const conflictCols = (state.upsertOnConflict ?? "id")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Row[] = [];
  const coll = collection(state.table);
  for (const raw of rows) {
    const row = ensureId({ ...raw });
    const conflictFilter: Record<string, unknown> = {};
    for (const col of conflictCols) {
      conflictFilter[col] = row[col];
    }
    if (state.upsertIgnore) {
      const existing = await coll.findOne(conflictFilter, { projection: { _id: 0 } });
      if (existing) {
        out.push(existing as Row);
        continue;
      }
    }
    const { _id, ...rest } = row;
    const result = await coll.findOneAndUpdate(
      conflictFilter,
      {
        $set: { ...rest, updated_at: rest.updated_at ?? nowIso() },
        $setOnInsert: { id: row.id, created_at: row.created_at },
      },
      { upsert: true, returnDocument: "after" },
    );
    const doc = result?.value as Row | undefined;
    const upserted = result?.lastErrorObject?.upserted ? true : false;
    if (doc) {
      out.push(doc);
      if (upserted) {
        await recordChange(state.table, "INSERT", doc, null);
      } else {
        await recordChange(state.table, "UPDATE", doc, raw as Row);
      }
    }
  }
  return { data: out, count: out.length, error: null };
}

// ============================================================
// Thenable builder
// ============================================================

export type BuilderExecutor = (
  state: BuilderState,
) => Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }>;

type QueryResultValue = { data: any; count: number | null; error: PostgrestErrorLike | null };

export class MongoQueryBuilder {
  state: BuilderState;
  executor: BuilderExecutor;

  constructor(table: string, executor: BuilderExecutor) {
    this.state = newState(table);
    this.executor = executor;
  }

  /** Server-side: execute directly against Mongo with a context. */
  static server(table: string, ctx: QueryContext): MongoQueryBuilder {
    return new MongoQueryBuilder(table, (state) => executeQuery(state, ctx));
  }

  select(columns?: string, opts?: { count?: "exact"; head?: boolean }): this {
    this.state.selectCols = columns ?? "*";
    this.state.selectOpts = opts ?? null;
    this.state.mode = "select";
    return this;
  }

  insert(rows: Record<string, any> | Record<string, any>[]): this {
    this.state.mode = "insert";
    this.state.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  update(set: Record<string, any>): this {
    this.state.mode = "update";
    this.state.updateSet = set;
    return this;
  }

  delete(opts?: { count?: "exact" }): this {
    this.state.mode = "delete";
    this.state.deleteOpts = opts ?? null;
    return this;
  }

  upsert(rows: Record<string, any> | Record<string, any>[], opts?: {
    onConflict?: string;
    ignoreDuplicates?: boolean;
  }): this {
    this.state.mode = "upsert";
    this.state.upsertRows = Array.isArray(rows) ? rows : [rows];
    this.state.upsertOnConflict = opts?.onConflict ?? null;
    this.state.upsertIgnore = opts?.ignoreDuplicates ?? false;
    return this;
  }

  set(values: Record<string, any>): this {
    this.state.updateSet = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.state.filters.push({ op: "eq", column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.state.filters.push({ op: "neq", column, value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.state.filters.push({ op: "gt", column, value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.state.filters.push({ op: "gte", column, value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.state.filters.push({ op: "lt", column, value });
    return this;
  }
  lte(column: string, value: unknown): this {
    this.state.filters.push({ op: "lte", column, value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.state.filters.push({ op: "in", column, value: values });
    return this;
  }
  is(column: string, value: unknown): this {
    this.state.filters.push({ op: "is", column, value });
    return this;
  }
  like(column: string, pattern: string): this {
    this.state.filters.push({ op: "like", column, value: pattern });
    return this;
  }
  ilike(column: string, pattern: string): this {
    this.state.filters.push({ op: "ilike", column, value: pattern });
    return this;
  }
  contains(column: string, value: unknown): this {
    this.state.filters.push({ op: "contains", column, value });
    return this;
  }
  match(obj: Record<string, unknown>): this {
    this.state.filters.push({ op: "match", column: "", value: obj });
    return this;
  }
  filter(column: string, operator: string, value: unknown): this {
    const op = operator as FilterOp;
    if (op === "ilike") return this.ilike(column, String(value));
    if (op === "like") return this.like(column, String(value));
    if (op === "eq") return this.eq(column, value);
    if (op === "neq") return this.neq(column, value);
    if (op === "gt") return this.gt(column, value);
    if (op === "gte") return this.gte(column, value);
    if (op === "lt") return this.lt(column, value);
    if (op === "lte") return this.lte(column, value);
    if (op === "in") return this.in(column, value as unknown[]);
    if (op === "is") return this.is(column, value);
    this.state.filters.push({ op, column, value });
    return this;
  }
  or(value: string): this {
    this.state.filters.push({ op: "or", column: "", value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }): this {
    this.state.orders.push({
      column,
      ascending: opts?.ascending ?? true,
      nullsFirst: opts?.nullsFirst ?? false,
    });
    return this;
  }
  limit(n: number): this {
    this.state.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.state.rangeVals = [from, to];
    return this;
  }
  single(): this {
    this.state.singleMode = "single";
    return this;
  }
  maybeSingle(): this {
    this.state.singleMode = "maybeSingle";
    return this;
  }
  abortSignal(): this {
    return this;
  }

  then<TResult1 = QueryResultValue, TResult2 = never>(
    onfulfilled?: ((value: QueryResultValue) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  run(): Promise<{ data: any; count: number | null; error: PostgrestErrorLike | null }> {
    return this.executor(this.state);
  }

  /** Serialize for the browser proxy. */
  toJSON(): { state: BuilderState } {
    return { state: this.state };
  }
}
