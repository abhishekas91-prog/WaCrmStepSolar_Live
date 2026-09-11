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
  estimated_days?: number | null
  duration_days?: number | null
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
    const payload = await res.json() as CrmLead | { lead?: CrmLead } | CrmLead[]
    const lead = Array.isArray(payload) ? payload[0] : 'lead' in payload ? payload.lead : payload
    return lead && typeof lead === 'object' ? lead : null
  } catch (err) {
    console.error('[crm-lookup] request failed:', err)
    return null
  }
}

export interface CreateLeadInput {
  full_name: string
  /** 10-digit Indian mobile number, no country code. */
  phone: string
  email: string
  state: string
  city: string
  pincode: string
  property_type: string
  monthly_bill: number
  roof_type: string
  timeline: string
  source?: string
}

/**
 * Creates a lead in StepSolar-CRM — called from the Flows engine's
 * `create_lead` node once a WhatsApp conversation has collected
 * enough details (see engine.ts).
 *
 * Hits the SAME public `POST /api/leads` the website enquiry form
 * posts to, so — unlike `lookupCrmLead` — no `X-Service-Key` header
 * is needed here. The backend applies its own validation (required
 * fields, phone format, 429 on a duplicate within its dedupe window)
 * — this function surfaces failures to the caller rather than
 * throwing, so a bad/duplicate submission doesn't crash the flow run.
 */
export async function createCrmLead(
  input: CreateLeadInput,
): Promise<{ id: string; code: string } | null> {
  try {
    const res = await fetch(`${CRM_BASE}/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, source: input.source ?? 'whatsapp_flow' }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[crm-lookup] create_lead failed', res.status, detail)
      return null
    }
    return (await res.json()) as { id: string; code: string }
  } catch (err) {
    console.error('[crm-lookup] create_lead request failed:', err)
    return null
  }
}

/** Plain-text WhatsApp reply summarising an existing lead's status. */
export function formatCrmStatusReply(lead: CrmLead): string {
  const current =
    lead.stages?.find((s) => !isCompletedStatus(s.status)) ??
    lead.stages?.[lead.stages.length - 1] ??
    null
  const phase = current?.label || 'Initial review'
  const status = current?.status || 'Pending'
  const estimatedDays = current?.estimated_days ?? current?.duration_days
  const timing = estimatedDays
    ? `Expected timeline: approximately ${estimatedDays} days for this phase.`
    : 'Our project coordinator will share the next update and expected timeline shortly.'
  const assigned = lead.assigned_name
    ? `Project coordinator: ${lead.assigned_name}.\n`
    : ''
  return (
    `Namaste ${lead.full_name} ji,\n\n` +
    `Your solar project enquiry is registered successfully.\n` +
    `Reference ID: *${lead.code}*\n` +
    `Current project stage: *${phase}* (${status})\n` +
    timing + '\n' +
    assigned +
    '\nOur team will contact you shortly regarding the next steps. Thank you for choosing StepSolar Energy.' +
    '\n\nNaya rooftop quotation lene ke liye *Quotation* likhkar bhejein.'
  )
}

function isCompletedStatus(status: string): boolean {
  return /^(completed|complete|done|closed)$/i.test(status.trim())
}
