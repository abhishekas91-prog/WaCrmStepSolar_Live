import { createServerCompatClient, serverUserContext } from "@/lib/mongo/compat";
import type { CompatClient } from "@/lib/mongo/compat";

export async function createClient(): Promise<CompatClient> {
  const ctx = await serverUserContext();
  return createServerCompatClient(ctx);
}
