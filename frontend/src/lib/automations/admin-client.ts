import { createServerCompatClient, serviceContext } from '@/lib/mongo/compat'
import type { CompatClient } from '@/lib/mongo/compat'

// Lazy, shared service-role client for automation engine work.
// Mirrors the pattern used by the webhook handler
// (src/app/api/whatsapp/webhook/route.ts).
let _adminClient: CompatClient | null = null

export function supabaseAdmin(): CompatClient {
  if (!_adminClient) {
    _adminClient = createServerCompatClient(serviceContext())
  }
  return _adminClient
}
