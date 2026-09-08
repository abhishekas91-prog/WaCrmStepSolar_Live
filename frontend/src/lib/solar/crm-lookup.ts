/**
 * StepSolar-CRM lookup — service-to-service call from the WA bot.
 *
 * The Flows/Automations builder can create a lead in the CRM (via a
 * `send_webhook` automation step, POST /api/leads) but has no node
 * type yet that can GET a URL and branch on the response. So this one
 * piece — "does a lead already exist for this phone number?" — is
 * plain code, called directly from the webhook handler for returning
 * contacts who aren't mid-flow. See whatsapp/webhook/route.ts.
 *
 * Auth: shared secret in X-Service-Key, not the JWT/CurrentUser scheme
 * the rest of StepSolar-CRM uses — this bot has no human login.
 */

const CRM_BASE =
  process.env.STEPSOLAR_CRM_BASE_URL ?? 'https://stepsolar-backend.onrender.com/api'
const SERVICE_KEY = process.env.STEPSOLAR_CRM_SERVICE_KEY ?? ''

export interface CrmLeadStage {
  key: string
  label: string
  status: string
}

export interface CrmLead {
  id: string
  code: string
  full_name: string
  stages: CrmLeadStage[]
  assigned_name: string | null
  created_at: string
}

/**
 * Looks up the most recent lead for a 10-digit Indian mobile number
 * (no country code — strip it before calling, e.g. `phone.slice(-10)`).
 * Returns null both when no lead exists (404) and when the lookup is
 * unreachable/misconfigured — callers should treat both the same way:
 * fall through to the normal flow instead of blocking the reply.
 */
export async function lookupCrmLead(phone10: string): Promise<CrmLead | null> {
  if (!SERVICE_KEY) {
    console.warn('[crm-lookup] STEPSOLAR_CRM_SERVICE_KEY not set — skipping lookup')
    return null
  }
  try {
    const res = await fetch(`${CRM_BASE}/leads/lookup?phone=${encodeURIComponent(phone10)}`, {
      headers: { 'X-Service-Key': SERVICE_KEY },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404) return null
    if (!res.ok) {
      console.error('[crm-lookup] unexpected status', res.status)
      return null
    }
    return (await res.json()) as CrmLead
  } catch (err) {
    console.error('[crm-lookup] request failed:', err)
    return null
  }
}

/** Plain-text WhatsApp reply summarising an existing lead's status. */
export function formatCrmStatusReply(lead: CrmLead): string {
  const current =
    lead.stages.find((s) => s.status !== 'Completed') ?? lead.stages[lead.stages.length - 1]
  return (
    `Namaste ${lead.full_name}! Aapka lead already register hai (Code: ${lead.code}).\n` +
    `Current stage: *${current.label}* (${current.status}).\n` +
    `Hamari team jald contact karegi.`
  )
}
