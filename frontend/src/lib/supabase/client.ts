import { createBrowserCompatClient } from "@/lib/mongo/browser-client";
import type { CompatClient } from "@/lib/mongo/compat";

// Singleton instance — one client shared across the whole browser session.
let browserClient: CompatClient | undefined;

export function createClient() {
  if (browserClient) return browserClient;

  browserClient = createBrowserCompatClient();

  return browserClient;
}
