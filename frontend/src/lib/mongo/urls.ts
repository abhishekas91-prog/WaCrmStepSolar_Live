// ============================================================
// Pure URL helpers shared by server storage and the browser client.
// No server-only imports — safe to bundle for the browser.
// ============================================================

/** Build a public serving URL for a stored object. */
export function buildPublicUrl(
  bucket: string,
  path: string,
  origin?: string,
): string {
  const base = origin ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  const params = new URLSearchParams({ bucket, path });
  return `${base}/api/db/storage?${params.toString()}`;
}
