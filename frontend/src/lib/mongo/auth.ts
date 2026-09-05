// ============================================================
// Mongo-backed auth — replaces Supabase Auth (users + sessions).
//
// - `users` collection stores profiles with bcrypt password hashes.
// - Sessions are JWTs (HS256 via `jose`) held in an httpOnly cookie.
// - The browser client proxies every auth action through
//   `/api/db/auth` (browsers can't reach Mongo directly); the server
//   client calls these functions directly.
// ============================================================

import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { collection } from "./connection";
import type { SessionUser } from "./query-builder";

export const AUTH_COOKIE = "wacrm-auth-token";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface AuthUser {
  id: string;
  email: string | null;
  aud: string;
  role: string;
  email_confirmed_at: string | null;
  confirmation_sent_at: string | null;
  recovery_sent_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: string;
  user: AuthUser;
}

export interface AuthError {
  message: string;
  status?: number;
  code?: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || "dev-only-change-me-wacrm-mongo-secret";
  return new TextEncoder().encode(secret);
}

export interface UserDoc {
  id: string;
  email: string;
  encrypted_password: string;
  user_metadata: Record<string, unknown>;
  app_metadata: Record<string, unknown>;
  email_confirmed_at: string | null;
  recovery_token_hash: string | null;
  recovery_expires_at: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function toAuthUser(doc: UserDoc): AuthUser {
  return {
    id: doc.id,
    email: doc.email,
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: doc.email_confirmed_at,
    confirmation_sent_at: doc.email_confirmed_at,
    recovery_sent_at: doc.recovery_token_hash ? doc.recovery_expires_at : null,
    last_sign_in_at: doc.last_sign_in_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    app_metadata: doc.app_metadata ?? {},
    user_metadata: doc.user_metadata ?? {},
    identities: [],
  };
}

async function createSessionForUser(doc: UserDoc): Promise<AuthSession> {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_DURATION_SECONDS;
  const accessToken = await new SignJWT({
    sub: doc.id,
    email: doc.email,
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    access_token: accessToken,
    refresh_token: "mongo-refresh-not-used",
    expires_in: SESSION_DURATION_SECONDS,
    expires_at: expiresAt,
    token_type: "bearer",
    user: toAuthUser(doc),
  };
}

async function findUserById(id: string): Promise<UserDoc | null> {
  const doc = await collection("users").findOne({ id });
  return (doc as unknown as UserDoc) ?? null;
}

async function findUserByEmail(email: string): Promise<UserDoc | null> {
  const normalized = email.trim().toLowerCase();
  const doc = await collection("users").findOne({ email: normalized });
  return (doc as unknown as UserDoc) ?? null;
}

async function findUserByRecoveryToken(tokenHash: string): Promise<UserDoc | null> {
  const doc = await collection("users").findOne({ recovery_token_hash: tokenHash });
  return (doc as unknown as UserDoc) ?? null;
}

/**
 * Decode the auth cookie without verifying against the DB. Used by the
 * middleware (fast path) and by the query engine when it only needs the
 * account context.
 */
export async function decodeAuthCookie(value: string | undefined): Promise<{
  session: AuthSession | null;
  error: AuthError | null;
}> {
  if (!value) return { session: null, error: null };
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed?.access_token) return { session: null, error: null };
    const secret = getSecret();
    const { payload } = await jwtVerify(parsed.access_token, secret);
    const userId = String(payload.sub ?? "");
    const doc = await findUserById(userId);
    if (!doc) return { session: null, error: { message: "User not found", status: 401 } };
    return { session: { ...parsed, user: toAuthUser(doc) }, error: null };
  } catch {
    return { session: null, error: { message: "Invalid session", status: 401 } };
  }
}

/** Load the session for the current request from the auth cookie. */
export async function getSession(): Promise<{
  data: { session: AuthSession | null };
  error: AuthError | null;
}> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_COOKIE)?.value;
  if (!raw) return { data: { session: null }, error: null };
  const { session, error } = await decodeAuthCookie(raw);
  return { data: { session }, error };
}

export async function getUser(): Promise<{
  data: { user: AuthUser | null };
  error: AuthError | null;
}> {
  const { data } = await getSession();
  return { data: { user: data.session?.user ?? null }, error: null };
}

/** Resolve the session user + account context for the query engine. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const { data } = await getSession();
  const user = data.session?.user;
  if (!user) return null;
  const profile = await collection("profiles").findOne({ user_id: user.id });
  return {
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata,
    account_id: (profile?.account_id as string) ?? null,
    account_role: (profile?.account_role as SessionUser["account_role"]) ?? null,
  };
}

async function writeSessionCookie(session: AuthSession): Promise<void> {
  const cookieStore = await cookies();
  // Only the access token lives in the cookie. Storing the full session
  // JSON (user metadata, identities, etc.) can push the cookie past the
  // ~4 KB browser/edge limit and the session silently stops persisting
  // (login page looks stuck). The user is rehydrated from Mongo by
  // `decodeAuthCookie` on every read.
  const value = Buffer.from(
    JSON.stringify({ access_token: session.access_token }),
    "utf8",
  ).toString("base64url");
  const isProd = process.env.NODE_ENV === "production";
  cookieStore.set(AUTH_COOKIE, value, {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  const isProd = process.env.NODE_ENV === "production";
  cookieStore.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
    maxAge: 0,
  });
}

// ============================================================
// Public auth actions (server side)
// ============================================================

export async function signInWithPassword(payload: {
  email: string;
  password: string;
}): Promise<{ data: { session: AuthSession | null; user: AuthUser | null }; error: AuthError | null }> {
  try {
    const doc = await findUserByEmail(payload.email);
    if (!doc) {
      return {
        data: { session: null, user: null },
        error: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" },
      };
    }
    const ok = await bcrypt.compare(payload.password, doc.encrypted_password);
    if (!ok) {
      return {
        data: { session: null, user: null },
        error: { message: "Invalid login credentials", status: 400, code: "invalid_credentials" },
      };
    }
    await collection("users").updateOne(
      { id: doc.id },
      { $set: { last_sign_in_at: nowIso(), updated_at: nowIso() } },
    );
    const session = await createSessionForUser(doc);
    await writeSessionCookie(session);
    return { data: { session, user: session.user }, error: null };
  } catch (err) {
    return {
      data: { session: null, user: null },
      error: { message: String((err as Error).message ?? err), status: 500 },
    };
  }
}

/**
 * Create a user + their personal account + owner profile (mirrors the
 * `handle_new_user` trigger). Does NOT open a session — the UI expects
 * a "check your email" hand-off, and the invite flow re-logins via
 * /login?invite=<token> before redeeming.
 */
export async function signUp(payload: {
  email: string;
  password: string;
  options?: { data?: Record<string, unknown> };
}): Promise<{ data: { user: AuthUser | null; session: AuthSession | null }; error: AuthError | null }> {
  try {
    const normalized = payload.email.trim().toLowerCase();
    const existing = await findUserByEmail(normalized);
    if (existing) {
      return {
        data: { user: null, session: null },
        error: { message: "User already registered", status: 400, code: "user_exists" },
      };
    }
    const id = crypto.randomUUID();
    const fullName = String(payload.options?.data?.full_name ?? "");
    const now = nowIso();
    const hash = await bcrypt.hash(payload.password, 10);
    const doc: UserDoc = {
      id,
      email: normalized,
      encrypted_password: hash,
      user_metadata: payload.options?.data ?? {},
      app_metadata: {},
      email_confirmed_at: now,
      recovery_token_hash: null,
      recovery_expires_at: null,
      created_at: now,
      updated_at: now,
      last_sign_in_at: null,
    };
    await collection("users").insertOne(doc as never);

    // Mirror handle_new_user: personal account + owner profile.
    const accountId = crypto.randomUUID();
    await collection("accounts").insertOne({
      id: accountId,
      name: fullName || normalized || "My account",
      owner_user_id: id,
      created_at: now,
      updated_at: now,
    } as never);
    await collection("profiles").insertOne({
      id: crypto.randomUUID(),
      user_id: id,
      full_name: fullName,
      email: normalized,
      avatar_url: null,
      role: null,
      beta_features: [],
      account_id: accountId,
      account_role: "owner",
      created_at: now,
      updated_at: now,
    } as never);

    return { data: { user: toAuthUser(doc), session: null }, error: null };
  } catch (err) {
    return {
      data: { user: null, session: null },
      error: { message: String((err as Error).message ?? err), status: 500 },
    };
  }
}

export async function signOut(): Promise<{ error: AuthError | null }> {
  await clearSessionCookie();
  return { error: null };
}

export async function updateUser(attrs: {
  email?: string;
  password?: string;
  data?: Record<string, unknown>;
}): Promise<{ data: { user: AuthUser | null }; error: AuthError | null }> {
  try {
    const { data } = await getUser();
    const current = data.user;
    if (!current) {
      return { data: { user: null }, error: { message: "No session", status: 401 } };
    }
    const set: Record<string, unknown> = { updated_at: nowIso() };
    if (attrs.password) {
      set.encrypted_password = await bcrypt.hash(attrs.password, 10);
    }
    if (attrs.email) {
      set.email = attrs.email.trim().toLowerCase();
    }
    if (attrs.data) {
      set.user_metadata = { ...current.user_metadata, ...attrs.data };
    }
    await collection("users").updateOne({ id: current.id }, { $set: set });
    const doc = await findUserById(current.id);
    if (!doc) return { data: { user: null }, error: { message: "User not found", status: 401 } };
    return { data: { user: toAuthUser(doc) }, error: null };
  } catch (err) {
    return {
      data: { user: null },
      error: { message: String((err as Error).message ?? err), status: 500 },
    };
  }
}

/**
 * Password reset without an SMTP provider. Generates a recovery token,
 * stores its hash + expiry on the user, and logs the clickable link to
 * the server console so a self-hosted admin can copy it to the user.
 * Also accepts a custom `onLink` (used by tests).
 */
export async function resetPasswordForEmail(
  email: string,
  opts?: { redirectTo?: string },
): Promise<{ error: AuthError | null; link?: string }> {
  try {
    const doc = await findUserByEmail(email);
    if (!doc) {
      // Do not reveal whether the email exists.
      return { error: null };
    }
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    const now = Date.now();
    const recoveryExpiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    await collection("users").updateOne(
      { id: doc.id },
      { $set: { recovery_token_hash: hash, recovery_expires_at: recoveryExpiresAt } },
    );
    const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectTo =
      opts?.redirectTo || `${base}/auth/callback?next=/reset-password`;
    const link = `${base}/auth/confirm-recovery?token=${token}`;
    console.log(
      `[auth] password-reset link for ${email}: ${link} (redirect: ${redirectTo})`,
    );
    return { error: null, link };
  } catch (err) {
    return { error: { message: String((err as Error).message ?? err), status: 500 } };
  }
}

/** Redeem a recovery token from a clicked reset link and open a session. */
export async function confirmRecovery(token: string): Promise<{
  data: { user: AuthUser | null };
  error: AuthError | null;
}> {
  try {
    const hash = createHash("sha256").update(token).digest("hex");
    const doc = await findUserByRecoveryToken(hash);
    if (!doc || !doc.recovery_expires_at || doc.recovery_expires_at < nowIso()) {
      return { data: { user: null }, error: { message: "Invalid or expired recovery link", status: 400 } };
    }
    await collection("users").updateOne(
      { id: doc.id },
      { $set: { recovery_token_hash: null, recovery_expires_at: null } },
    );
    const session = await createSessionForUser(doc);
    await writeSessionCookie(session);
    return { data: { user: session.user }, error: null };
  } catch (err) {
    return {
      data: { user: null },
      error: { message: String((err as Error).message ?? err), status: 500 },
    };
  }
}

export { writeSessionCookie, clearSessionCookie };
