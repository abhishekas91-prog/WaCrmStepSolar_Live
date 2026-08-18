// ============================================================
// Realtime replacement — polling-based change feed.
//
// Postgres Realtime pushed row events over a websocket; Mongo has no
// equivalent. Every write that goes through the query engine (or the
// RPC layer) records a row in the `realtime.changes` collection. A
// browser channel polls `/api/_db/realtime`, which returns changes
// newer than the client's cursor scoped to the caller's account.
//
// The `ts` is a monotonic-ish millisecond timestamp; clients pass back
// the highest they've seen as the next cursor. Rows are auto-expired
// after REALTIME_TTL_MS so the collection stays bounded.
// ============================================================

import { collection } from "./connection";
import { TABLES, type TableDef } from "./schema";
import type { SessionUser } from "./query-builder";

export const REALTIME_TTL_MS = 10 * 60 * 1000;

export type ChangeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface ChangeEvent {
  eventType: ChangeEventType;
  table: string;
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
  ts: number;
  account_id?: string | null;
  user_id?: string | null;
}

function nowMs(): number {
  return Date.now();
}

export function stripId(row: Record<string, unknown>): Record<string, unknown> {
  const { _id, ...rest } = row;
  return rest;
}

async function resolveRowAccountId(
  table: string,
  def: TableDef | undefined,
  row: Record<string, unknown>,
): Promise<string | null | undefined> {
  if (!def) return undefined;
  if (def.kind === "account") return (row.account_id as string) ?? undefined;
  if (def.kind === "user") return undefined;
  if (def.kind === "child" && def.parent) {
    const parent = await collection(def.parent.table).findOne(
      { id: row[def.parent.fk] },
      { projection: { _id: 0, account_id: 1 } },
    );
    return (parent?.account_id as string) ?? undefined;
  }
  if (def.kind === "profile") return (row.account_id as string) ?? undefined;
  if (def.kind === "accountRow") return (row.id as string) ?? undefined;
  return undefined;
}

export async function recordChange(
  table: string,
  eventType: ChangeEventType,
  newRow: Record<string, unknown> | null,
  oldRow: Record<string, unknown> | null,
): Promise<void> {
  try {
    const def = TABLES[table];
    const row = newRow ?? oldRow ?? {};
    const accountId = await resolveRowAccountId(table, def, row);
    const user_id = (row.user_id as string) ?? undefined;
    const doc: ChangeEvent = {
      eventType,
      table,
      new: newRow ? stripId(newRow) : null,
      old: oldRow ? stripId(oldRow) : null,
      ts: nowMs(),
      account_id: accountId,
      user_id,
    };
    await collection("realtime.changes").insertOne(doc as never);
  } catch {
    // Recording is best-effort — never let it break the underlying write.
  }
}

let ttlIndexEnsured = false;

async function ensureTtlIndex(): Promise<void> {
  if (ttlIndexEnsured) return;
  try {
    await collection("realtime.changes").createIndex({ ts: 1 }, { expireAfterSeconds: REALTIME_TTL_MS / 1000 });
    ttlIndexEnsured = true;
  } catch {
    // Index may already exist or the collection may be unavailable.
  }
}

export interface RealtimePollArgs {
  table: string;
  since: number | null;
}

export async function pollChanges(
  user: SessionUser | null,
  args: RealtimePollArgs,
): Promise<{ events: ChangeEvent[]; cursor: number | null }> {
  await ensureTtlIndex();
  const def = TABLES[args.table];
  const filter: Record<string, unknown> = {
    table: args.table,
    ts: { $gt: args.since ?? 0 },
  };
  if (!user) {
    return { events: [], cursor: args.since };
  }
  if (def?.kind === "user") {
    filter.user_id = user.id;
  } else {
    filter.account_id = user.account_id ?? "__none__";
  }
  const events = (await collection("realtime.changes")
    .find(filter)
    .sort({ ts: 1 })
    .toArray()) as unknown as ChangeEvent[];
  const cursor = events.length
    ? Math.max(...events.map((e) => e.ts), args.since ?? 0)
    : args.since;
  return { events, cursor };
}

/** Reuse a monotonic cursor per (user, table) without a session store. */
export function cursorFromClock(now: number): number {
  return now - REALTIME_TTL_MS;
}
