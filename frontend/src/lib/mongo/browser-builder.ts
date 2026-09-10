// ============================================================
// Browser query builder — a chainable PostgREST-style builder that
// serializes its state and POSTs it to `/api/db/query`. This module
// has NO server-only imports (no mongodb / next/headers), so it is
// safe to bundle for the browser.
//
// The serialized `BuilderState` must match the shape the server-side
// `executeQuery` in query-builder.ts expects.
// ============================================================

export type FilterOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "like"
  | "ilike" | "contains" | "match" | "or" | "not";

export interface Filter {
  op: FilterOp;
  column: string;
  value: unknown;
  subOp?: string;
}

export interface Order {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

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

export interface QueryError {
  message: string;
  code?: string;
}

export type BrowserQueryResult = { data: any; count: number | null; error: QueryError | null };

function newState(table: string): BuilderState {
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

export class BrowserQueryBuilder {
  state: BuilderState;

  constructor(
    table: string,
    private executor: (state: BuilderState) => Promise<BrowserQueryResult>,
  ) {
    this.state = newState(table);
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

  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.state.mode = "upsert";
    this.state.upsertRows = Array.isArray(rows) ? rows : [rows];
    this.state.upsertOnConflict = opts?.onConflict ?? null;
    this.state.upsertIgnore = opts?.ignoreDuplicates ?? false;
    return this;
  }

  set(values: Record<string, unknown>): this {
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
  not(column: string, operator: string, value: unknown): this {
    this.state.filters.push({ op: "not", column, value, subOp: operator });
    return this;
  }
  filter(column: string, operator: string, value: unknown): this {
    if (operator.startsWith("not.")) {
      const subOp = operator.slice(4);
      return this.not(column, subOp, value);
    }
    this.state.filters.push({ op: operator as FilterOp, column, value });
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

  then<TResult1 = BrowserQueryResult, TResult2 = never>(
    onfulfilled?: ((value: BrowserQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.executor(this.state).then(onfulfilled, onrejected);
  }

  run(): Promise<BrowserQueryResult> {
    return this.executor(this.state);
  }

  toJSON(): { state: BuilderState } {
    return { state: this.state };
  }
}
