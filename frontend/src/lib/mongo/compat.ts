// ============================================================
// Compat client facade — presents the Supabase API surface the app
// uses on top of MongoDB.
//
// - Server client: executes queries directly against Mongo, scoped by
//   the request session (user client) or bypassing scoping (service).
// - Browser client: lives in `browser-client.ts` (serializes every
//   call and proxies it through `/api/_db/*`). It is re-exported here
//   for convenience but is a separate module so the browser bundle
//   never pulls in the Mongo driver or `next/headers`.
// ============================================================

import { MongoQueryBuilder } from "./query-builder";
import type { BuilderState, QueryContext } from "./query-builder";
import * as authServer from "./auth";
import type { AuthUser, AuthSession } from "./auth";
import { runRpc, type RpcContext } from "./rpc";
import { uploadFile, removeFiles, buildPublicUrl, type StorageContext } from "./storage";
import { pollChanges, type ChangeEvent } from "./realtime";
import { collection } from "./connection";

export { createBrowserCompatClient } from "./browser-client";

export type { AuthUser, AuthSession } from "./auth";
export type { PostgrestErrorLike } from "./query-builder";

// ============================================================
// Types
// ============================================================

export interface CompatError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

type QueryResult = { data: any; count: number | null; error: CompatError | null };

interface PostgresChangesFilter {
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema?: string;
  table?: string;
  /** Postgres Realtime filter string (e.g. `account_id=eq.123`). Our
   *  polling feed scopes server-side by the caller's account, so this
   *  is accepted but not enforced. */
  filter?: string;
}

export type RealtimePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: { [key: string]: any };
  old: { [key: string]: any };
};

export interface CompatChannel {
  on(event: string, filter: PostgresChangesFilter, cb: (payload: RealtimePayload) => void): CompatChannel;
  subscribe(cb?: (status: string) => void): CompatChannel;
  _stop(): void;
}

export interface CompatStorageApi {
  upload(
    path: string,
    file: File | Blob | Buffer | Uint8Array,
    opts?: { cacheControl?: string; upsert?: boolean; contentType?: string },
  ): Promise<{ data: { path: string } | null; error: CompatError | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  remove(paths: string[]): Promise<{ error: CompatError | null }>;
}

export interface CompatAuthApi {
  getSession(): Promise<{ data: { session: AuthSession | null }; error: CompatError | null }>;
  getUser(): Promise<{ data: { user: AuthUser | null }; error: CompatError | null }>;
  signInWithPassword(payload: {
    email: string;
    password: string;
  }): Promise<{ data: { session: AuthSession | null; user: AuthUser | null }; error: CompatError | null }>;
  signUp(payload: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
  }): Promise<{ data: { user: AuthUser | null; session: AuthSession | null }; error: CompatError | null }>;
  signOut(): Promise<{ error: CompatError | null }>;
  updateUser(attrs: {
    email?: string;
    password?: string;
    data?: Record<string, unknown>;
  }): Promise<{ data: { user: AuthUser | null }; error: CompatError | null }>;
  resetPasswordForEmail(
    email: string,
    opts?: { redirectTo?: string },
  ): Promise<{ error: CompatError | null }>;
  onAuthStateChange(
    cb: (event: string, session: AuthSession | null) => void,
  ): { data: { subscription: { unsubscribe: () => void } } };
}

export interface CompatClient {
  from(table: string): MongoQueryBuilder;
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: any; error: CompatError | null }>;
  auth: CompatAuthApi;
  storage: { from(bucket: string): CompatStorageApi };
  channel(name: string): CompatChannel;
  removeChannel(channel: CompatChannel): void;
  [key: string]: unknown;
}

function toCompatError(e: { message: string; code?: string } | null): CompatError | null {
  if (!e) return null;
  return { message: e.message, code: e.code };
}

// ============================================================
// Server client
// ============================================================

function createServerAuth(): CompatAuthApi {
  return {
    getSession: () => authServer.getSession(),
    getUser: () => authServer.getUser(),
    signInWithPassword: (p) => authServer.signInWithPassword(p),
    signUp: (p) => authServer.signUp(p),
    signOut: () => authServer.signOut(),
    updateUser: (a) => authServer.updateUser(a),
    resetPasswordForEmail: (email, opts) => authServer.resetPasswordForEmail(email, opts),
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
  };
}

function createServerStorage(user: QueryContext["user"]): CompatClient["storage"] {
  const storageCtx: StorageContext = { user, service: !!user ? false : true };
  return {
    from(bucket: string): CompatStorageApi {
      return {
        async upload(path, file, opts) {
          const data = file instanceof Uint8Array
            ? Buffer.from(file)
            : Buffer.from(await (file as Blob).arrayBuffer());
          const result = await uploadFile(storageCtx, bucket, path, data, {
            contentType: opts?.contentType,
            upsert: opts?.upsert,
          });
          return { data: result.data, error: toCompatError(result.error) };
        },
        getPublicUrl(path) {
          const origin = process.env.NEXT_PUBLIC_APP_URL ?? "";
          return { data: { publicUrl: buildPublicUrl(bucket, path, origin) } };
        },
        async remove(paths) {
          const result = await removeFiles(storageCtx, bucket, paths);
          return { error: toCompatError(result.error) };
        },
      };
    },
  };
}

function serverChannel(): CompatChannel {
  return {
    on() {
      return this as unknown as CompatChannel;
    },
    subscribe(cb) {
      cb?.("SUBSCRIBED");
      return this as unknown as CompatChannel;
    },
    _stop() {},
  };
}

export function createServerCompatClient(ctx: QueryContext): CompatClient {
  const client: CompatClient = {
    from(table: string) {
      return MongoQueryBuilder.server(table, ctx);
    },
    async rpc(name, args) {
      const rpcCtx: RpcContext = { user: ctx.user, service: !!ctx.service };
      const result = await runRpc(rpcCtx, name, args);
      return { data: result.data, error: toCompatError(result.error) };
    },
    auth: createServerAuth(),
    storage: createServerStorage(ctx.user),
    channel: serverChannel,
    removeChannel() {},
  };
  return client;
}

/** Build the server user-client context from the request session. */
export async function serverUserContext(): Promise<QueryContext> {
  const user = await authServer.getSessionUser();
  if (!user) return {};
  return { user };
}

/** Build a service-role context (bypasses scoping). */
export function serviceContext(): QueryContext {
  return { service: true };
}

// ============================================================
// Server auth helpers used by the /api/_db/auth proxy.
// ============================================================

export async function proxyAuthAction(
  action: string,
  payload: Record<string, unknown>,
): Promise<{ data?: unknown; error?: CompatError | null }> {
  switch (action) {
    case "getSession":
      return authServer.getSession();
    case "getUser":
      return authServer.getUser();
    case "signInWithPassword":
      return authServer.signInWithPassword(payload as never);
    case "signUp":
      return authServer.signUp(payload as never);
    case "signOut":
      return authServer.signOut();
    case "updateUser":
      return authServer.updateUser(payload as never);
    case "resetPasswordForEmail":
      return authServer.resetPasswordForEmail(String(payload.email ?? ""), {
        redirectTo: payload.redirectTo ? String(payload.redirectTo) : undefined,
      });
    case "rpc": {
      const user = await authServer.getSessionUser();
      const rpcCtx: RpcContext = { user, service: false };
      const result = await runRpc(rpcCtx, String(payload.name), (payload.args ?? {}) as never);
      return { data: result.data, error: toCompatError(result.error) };
    }
    default:
      return { error: { message: `Unknown auth action: ${action}` } };
  }
}

export { authServer, collection };

// Re-exported for server code that wants the change-feed poll directly.
export { pollChanges, type ChangeEvent };
