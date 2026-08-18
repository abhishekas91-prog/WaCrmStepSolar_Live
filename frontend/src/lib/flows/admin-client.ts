import { createServerCompatClient, serviceContext } from '@/lib/mongo/compat'
import type { CompatClient } from '@/lib/mongo/compat'

// Lazy, shared service-role client for the Flows engine.
// Mirrors src/lib/automations/admin-client.ts — same shape so anyone
// reading either file picks up the convention immediately.
let _adminClient: CompatClient | null = null

export function supabaseAdmin(): CompatClient {
  if (!_adminClient) {
    _adminClient = createServerCompatClient(serviceContext())
  }
  return _adminClient
}
