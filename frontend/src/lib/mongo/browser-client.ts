// ============================================================
// Browser client — serializes every call and proxies it through the
// `/api/_db/*` Next.js routes (a browser cannot reach Mongo itself).
//
// This module MUST NOT import any server-only module (mongodb,
// next/headers, connection, auth, rpc, storage, query-builder) — the
// browser bundle would pull the server driver and fail the build.
// Shared types come in via `import type` (erased at compile time) and
// the only runtime import is the pure `urls` helper.
// ============================================================

import { buildPublicUrl } from "./urls";
import { BrowserQueryBuilder, type BrowserQueryResult } from "./browser-builder";
import type { AuthUser, AuthSession } from "./auth";
import type { CompatChannel, CompatClient, CompatError } from "./compat";
import type { MongoQueryBuilder } from "./query-builder";

type QueryResult = BrowserQueryResult;

interface PostgresChangesFilter {
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema?: string;
  table?: string;
  filter?: string;
}

type RealtimePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: { [key: string]: any };
  old: { [key: string]: any };
};

interface ChangeEvent {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: { [key: string]: any } | null;
  old: { [key: string]: any } | null;
  ts: number;
}

const POLL_MS = 4000;

class PollingChannel implements CompatChannel {
  private handlers: Array<{ filter: PostgresChangesFilter; cb: (p: RealtimePayload) => void }> = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private cursors = new Map<string, number>();
  private stopped = false;

  constructor(private table: string) {}

  on(_event: string, filter: PostgresChangesFilter, cb: (p: RealtimePayload) => void): this {
    this.handlers.push({ filter, cb });
    return this;
  }

  subscribe(cb?: (status: string) => void): this {
    if (this.timer) return this;
    const run = async () => {
      if (this.stopped) return;
      const since = this.cursors.get(this.table) ?? null;
      try {
        const res = await fetch("/api/_db/realtime", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ table: this.table, since }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { events: ChangeEvent[]; cursor: number | null };
        this.cursors.set(this.table, body.cursor ?? since ?? 0);
        for (const ev of body.events) {
          for (const h of this.handlers) {
            const want = h.filter.event ?? "*";
            if (want !== "*" && want !== ev.eventType) continue;
            h.cb({
              eventType: ev.eventType,
              new: (ev.new ?? {}) as Record<string, unknown>,
              old: (ev.old ?? {}) as Record<string, unknown>,
            });
          }
        }
      } catch {
        // Network hiccup — the next poll tick will pick up the changes.
      }
    };
    cb?.("SUBSCRIBED");
    this.timer = setInterval(run, POLL_MS);
    void run();
    return this;
  }

  _stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const authListeners = new Set<(event: string, session: AuthSession | null) => void>();

function emitAuth(event: string, session: AuthSession | null): void {
  for (const cb of authListeners) cb(event, session);
}

async function authAction<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/_db/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return (await res.json()) as T;
}

function createBrowserAuth(): CompatClient["auth"] {
  return {
    async getSession() {
      return authAction<{ data: { session: AuthSession | null }; error: CompatError | null }>(
        "getSession",
      );
    },
    async getUser() {
      return authAction<{ data: { user: AuthUser | null }; error: CompatError | null }>(
        "getUser",
      );
    },
    async signInWithPassword(payload) {
      const r = await authAction<{
        data: { session: AuthSession | null; user: AuthUser | null };
        error: CompatError | null;
      }>("signInWithPassword", payload);
      if (!r.error && r.data.session) emitAuth("SIGNED_IN", r.data.session);
      return r;
    },
    async signUp(payload) {
      return authAction<{
        data: { user: AuthUser | null; session: AuthSession | null };
        error: CompatError | null;
      }>("signUp", payload);
    },
    async signOut() {
      const r = await authAction<{ error: CompatError | null }>("signOut");
      if (!r.error) emitAuth("SIGNED_OUT", null);
      return r;
    },
    async updateUser(attrs) {
      return authAction<{ data: { user: AuthUser | null }; error: CompatError | null }>(
        "updateUser",
        attrs,
      );
    },
    async resetPasswordForEmail(email, opts) {
      return authAction<{ error: CompatError | null }>("resetPasswordForEmail", {
        email,
        redirectTo: opts?.redirectTo,
      });
    },
    onAuthStateChange(cb) {
      authListeners.add(cb);
      void this.getSession().then(({ data }) => {
        emitAuth("INITIAL_SESSION", data.session);
      });
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              authListeners.delete(cb);
            },
          },
        },
      };
    },
  };
}

function createBrowserStorage(): CompatClient["storage"] {
  return {
    from(bucket: string) {
      return {
        async upload(path, file, opts) {
          const body = new FormData();
          body.append("bucket", bucket);
          body.append("path", path);
          body.append("contentType", opts?.contentType ?? "");
          body.append("upsert", String(opts?.upsert ?? false));
          body.append(
            "file",
            file instanceof File ? file : new File([file as Blob], path.split("/").pop() ?? "file"),
          );
          const res = await fetch("/api/_db/storage/upload", { method: "POST", body });
          return (await res.json()) as { data: { path: string } | null; error: CompatError | null };
        },
        getPublicUrl(path) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          return { data: { publicUrl: buildPublicUrl(bucket, path, origin) } };
        },
        async remove(paths) {
          const res = await fetch("/api/_db/storage/remove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bucket, paths }),
          });
          return (await res.json()) as { error: CompatError | null };
        },
      };
    },
  };
}

let browserClientSingleton: CompatClient | null = null;

export function createBrowserCompatClient(): CompatClient {
  if (browserClientSingleton) return browserClientSingleton;

  const client: CompatClient = {
    from(table: string) {
      return new BrowserQueryBuilder(table, async (state): Promise<QueryResult> => {
        const res = await fetch("/api/_db/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
        });
        if (!res.ok) {
          return { data: null, count: null, error: { message: `Query proxy failed (${res.status})` } };
        }
        const body = (await res.json()) as { data?: unknown; count?: number | null; error?: CompatError | null };
        return { data: body.data ?? null, count: body.count ?? null, error: body.error ?? null };
      }) as unknown as MongoQueryBuilder;
    },
    rpc: (name: string, args: Record<string, unknown>) =>
      authAction<{ data: unknown; error: CompatError | null }>("rpc", { name, args }),
    auth: createBrowserAuth(),
    storage: createBrowserStorage(),
    channel(name: string) {
      const byTable = new Map<string, PollingChannel>();
      const api: CompatChannel = {
        on(event, filter, cb) {
          if (!filter.table) return api;
          let ch = byTable.get(filter.table);
          if (!ch) {
            ch = new PollingChannel(filter.table);
            byTable.set(filter.table, ch);
          }
          ch.on(event, filter, cb);
          return api;
        },
        subscribe(cb) {
          for (const ch of byTable.values()) ch.subscribe();
          cb?.("SUBSCRIBED");
          return api;
        },
        _stop() {
          for (const ch of byTable.values()) ch._stop();
          byTable.clear();
          void name;
        },
      };
      void name;
      return api;
    },
    removeChannel(channel: CompatChannel) {
      channel._stop();
    },
  };

  browserClientSingleton = client;
  return client;
}
