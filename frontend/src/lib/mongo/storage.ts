// ============================================================
// MongoDB storage — replaces Supabase Storage buckets (avatars,
// flow-media, chat-media). Files are stored as documents in a
// `storage.files` collection (GridFS-style single document) and
// served through /api/db/storage.
//
// Bucket RLS model (migrations 008/016/020/023):
//   - avatars:    user-scoped writes (`avatars/<uid>/...`), public read
//   - flow-media: account-scoped writes (`account-<id>/...`), public read
//   - chat-media: account-scoped writes (`account-<id>/...`), public read
// ============================================================

import { Binary } from "mongodb";
import { collection } from "./connection";
import type { SessionUser } from "./query-builder";
export { buildPublicUrl } from "./urls";

export type StorageContext = {
  user?: SessionUser;
  service?: boolean;
};

export interface StorageFile {
  bucket: string;
  path: string;
  size: number;
  content_type: string;
  owner_user_id: string | null;
  account_id: string | null;
  data: Binary;
  created_at: string;
}

export function storageError(message: string, code = "42501"): {
  message: string;
  code: string;
} {
  return { message, code };
}

function accountPrefix(accountId: string): string {
  return `account-${accountId}/`;
}

function isAllowedPath(bucket: string, ctx: StorageContext, path: string): boolean {
  if (ctx.service) return true;
  const user = ctx.user;
  if (!user) return false;
  if (bucket === "avatars") {
    return path.startsWith(`${user.id}/`);
  }
  if (user.account_id) {
    return path.startsWith(accountPrefix(user.account_id));
  }
  return false;
}

export async function uploadFile(
  ctx: StorageContext,
  bucket: string,
  path: string,
  data: Buffer,
  opts: { contentType?: string; upsert?: boolean },
): Promise<{ data: { path: string } | null; error: { message: string; code: string } | null }> {
  if (!isAllowedPath(bucket, ctx, path)) {
    return { data: null, error: storageError("Upload permission denied") };
  }
  try {
    const doc: StorageFile = {
      bucket,
      path,
      size: data.byteLength,
      content_type: opts.contentType || "application/octet-stream",
      owner_user_id: ctx.user?.id ?? null,
      account_id: ctx.user?.account_id ?? null,
      data: new Binary(data),
      created_at: new Date().toISOString(),
    };
    await collection("storage.files").findOneAndUpdate(
      { bucket, path },
      { $set: doc },
      { upsert: true, includeResultMetadata: false },
    );
    return { data: { path }, error: null };
  } catch (err) {
    return {
      data: null,
      error: storageError(String((err as Error).message ?? err), "500"),
    };
  }
}

export async function removeFiles(
  ctx: StorageContext,
  bucket: string,
  paths: string[],
): Promise<{ error: { message: string; code: string } | null }> {
  for (const path of paths) {
    if (!isAllowedPath(bucket, ctx, path)) {
      return { error: storageError("Delete permission denied") };
    }
  }
  try {
    await collection("storage.files").deleteMany({
      bucket,
      path: { $in: paths },
    });
    return { error: null };
  } catch (err) {
    return { error: storageError(String((err as Error).message ?? err), "500") };
  }
}

export async function readFile(
  bucket: string,
  path: string,
): Promise<{ file: StorageFile } | null> {
  const doc = await collection("storage.files").findOne({ bucket, path });
  if (!doc) return null;
  return { file: doc as unknown as StorageFile };
}

export async function removeUserFiles(userId: string): Promise<void> {
  await collection("storage.files").deleteMany({ owner_user_id: userId });
}
