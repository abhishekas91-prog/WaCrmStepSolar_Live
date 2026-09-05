// ============================================================
// CRM data access for the solar agent. Reads the contact's profile
// and custom-field values (e.g. State, Avg Bill) so the bot answers
// with the CRM's own data ("CRM se data leke"), and writes newly
// learned facts (state / bill) back onto the contact so agents see
// them in the inbox and later messages reuse them.
//
// All writes are best-effort and never throw into the webhook path.
// ============================================================

import type { CompatClient } from "@/lib/mongo/compat"
import type { SolarContactProfile, SolarInput } from './types'
import { normalizeState } from './subsidy'

const STATE_FIELD_RE = /(state|राज्य|city|district|शहर|जिला)/i
const BILL_FIELD_RE = /(bill|बिल|billy|avg.*bill|monthly.*bill)/i
const UNITS_FIELD_RE = /(unit|यूनिट|consumption|units)/i

interface ContactRow {
  id: string
  phone: string
  name: string | null
  email?: string | null
  company?: string | null
}

interface CustomFieldRow {
  id: string
  field_name: string
}

interface CustomValueRow {
  contact_id: string
  custom_field_id: string
  value: string | null
}

/** Load the contact + their custom-field values for the solar agent. */
export async function loadSolarContactProfile(
  db: CompatClient,
  accountId: string,
  contactId: string,
): Promise<SolarContactProfile | null> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone, name, email, company')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (contactErr || !contact) return null
  const c = contact as ContactRow

  const profile: SolarContactProfile = {
    contactId: c.id,
    name: c.name ?? null,
    phone: c.phone,
    state: null,
    avgBillAmount: null,
    avgMonthlyUnits: null,
    customFields: [],
  }

  try {
    const { data: fields } = await db
      .from('custom_fields')
      .select('id, field_name')
      .eq('account_id', accountId)
    const { data: values } = await db
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .eq('contact_id', contactId)

    const fieldByName = new Map<string, CustomFieldRow>()
    for (const f of (fields ?? []) as CustomFieldRow[]) fieldByName.set(f.id, f)

    for (const v of (values ?? []) as CustomValueRow[]) {
      if (!v.value) continue
      const field = fieldByName.get(v.custom_field_id)
      const label = field?.field_name ?? v.custom_field_id
      profile.customFields.push({ field: label, value: v.value })

      if (STATE_FIELD_RE.test(label)) {
        const norm = normalizeState(v.value)
        if (norm && !profile.state) profile.state = norm
      }
      const num = parseFloat(v.value.replace(/[,₹\s]/g, ''))
      if (Number.isFinite(num)) {
        if (BILL_FIELD_RE.test(label) && !profile.avgBillAmount) {
          profile.avgBillAmount = num
        }
        if (UNITS_FIELD_RE.test(label) && !profile.avgMonthlyUnits) {
          profile.avgMonthlyUnits = num
        }
      }
    }
  } catch (err) {
    console.error('[solar crm] custom-field read failed:', err)
  }

  return profile
}

/**
 * Persist newly learned facts onto the contact as custom-field values.
 * Creates the field definitions on first use (per account), then
 * upserts values. Best-effort — failures are logged and swallowed.
 */
export async function writeContactFacts(
  db: CompatClient,
  accountId: string,
  userId: string,
  contactId: string,
  facts: SolarInput,
): Promise<void> {
  const updates: Array<{ fieldName: string; value: string }> = []
  if (facts.state) updates.push({ fieldName: 'State', value: facts.state })
  if (facts.billAmount != null)
    updates.push({ fieldName: 'Avg Monthly Bill', value: String(facts.billAmount) })
  if (facts.monthlyUnits != null)
    updates.push({ fieldName: 'Monthly Units', value: String(facts.monthlyUnits) })
  if (updates.length === 0) return

  try {
    const { data: fields } = await db
      .from('custom_fields')
      .select('id, field_name')
      .eq('account_id', accountId)
    const existing = new Map<string, CustomFieldRow>()
    for (const f of (fields ?? []) as CustomFieldRow[]) {
      existing.set(f.field_name.toLowerCase(), f)
    }

    const { data: currentValues } = await db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contactId)
    const currentByField = new Map<string, string>()
    for (const v of (currentValues ?? []) as Array<{ custom_field_id: string; value: string | null }>) {
      if (v.value) currentByField.set(v.custom_field_id, v.value)
    }

    for (const update of updates) {
      const key = update.fieldName.toLowerCase()
      let field = existing.get(key)
      if (!field) {
        const { data: created, error: createErr } = await db
          .from('custom_fields')
          .insert({
            account_id: accountId,
            user_id: userId,
            field_name: update.fieldName,
            field_type: 'text',
          })
          .select('id, field_name')
        if (createErr || !created) continue
        field = (Array.isArray(created) ? created[0] : created) as CustomFieldRow
        existing.set(key, field)
      }
      if (currentByField.get(field.id) === update.value) continue
      await db.from('contact_custom_values').upsert(
        {
          contact_id: contactId,
          custom_field_id: field.id,
          value: update.value,
        },
        { onConflict: 'contact_id,custom_field_id' },
      )
    }
  } catch (err) {
    console.error('[solar crm] write facts failed:', err)
  }
}
