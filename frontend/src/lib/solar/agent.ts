// ============================================================
// Solar WhatsApp agent — the deterministic consultation bot.
//
// On a solar-related inbound message it:
//   1. reads the account's solar config + the contact's CRM profile,
//   2. extracts facts (bill amount / units / state) from the thread,
//   3. computes a sized recommendation (kW / cost / subsidy / savings),
//   4. replies in friendly Hinglish, asking for whatever's missing,
//   5. logs the recommendation and writes the learned facts back to
//      the contact in the CRM.
//
// It NEVER throws into the webhook path: failures log and return
// `{ handled: false }` so the generic AI auto-reply (or silence) can
// take over. Deterministic math — the LLM never computes prices.
// ============================================================

import type { SolarConfig, SolarRecommendation, SolarInput } from './types'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadSolarConfig } from './config'
import { buildRecommendation } from './recommend'
import { isSolarQuery, detectIntent, extractFromHistory } from './extract'
import { loadSolarContactProfile, writeContactFacts } from './crm'
import {
  formatQuote,
  formatSizingOnly,
  formatProcess,
  formatSubsidy,
  askForBill,
} from './format'
import { engineSendText } from '@/lib/flows/meta-send'

export interface SolarDispatchArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  /** The customer's latest inbound text. */
  message: string
}

export interface SolarDispatchResult {
  /** True when the solar bot owns this message (it replied, or decided
   *  to stay silent because nothing new was said). Callers should then
   *  suppress the generic AI auto-reply. */
  handled: boolean
}

const SOLAR_THREAD_MARKERS = /(?:solar|सौर|surya|panel|रूफटॉप|rooftop|bill|बिल|unit|यूनिट|subsidy|सब्सिडी|kW|किलोवाट|kw|battery|इन्वर्टर|inverter)/i

interface ThreadRow {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
}

/** Fetch the recent thread so the bot can use earlier facts. */
async function recentThread(db: ReturnType<typeof supabaseAdmin>, conversationId: string): Promise<ThreadRow[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return ((data ?? []) as ThreadRow[]).reverse()
}

/** Was the thread already in a solar consultation? Looks at the last
 *  few bot messages — prevents a stray "2000" from triggering the bot
 *  in a completely unrelated chat. */
function isSolarThread(rows: ThreadRow[]): boolean {
  const recent = rows.slice(-6)
  return recent.some(
    (r) => r.sender_type === 'bot' && !!r.content_text && SOLAR_THREAD_MARKERS.test(r.content_text),
  )
}

/** Latest logged recommendation for this conversation, if any. */
async function lastRecommendation(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  conversationId: string,
): Promise<SolarRecommendation | null> {
  const { data, error } = await db
    .from('solar_recommendations')
    .select('recommendation')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error || !data || data.length === 0) return null
  return (data[0] as { recommendation: SolarRecommendation }).recommendation ?? null
}

function sameRecommendation(a: SolarRecommendation | null, b: SolarRecommendation): boolean {
  if (!a) return false
  return (
    a.recommendedKw === b.recommendedKw &&
    a.input?.state === b.input?.state &&
    a.monthlyUnits === b.monthlyUnits
  )
}

async function logRecommendation(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  conversationId: string,
  input: SolarInput,
  rec: SolarRecommendation,
  config: SolarConfig,
): Promise<void> {
  try {
    await db.from('solar_recommendations').insert({
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      state: input.state ?? null,
      recommended_kw: rec.recommendedKw,
      input_payload: input,
      recommendation: rec,
      config_snapshot: {
        pricePerKw: config.pricePerKw,
        tariffPerUnit: config.tariffPerUnit,
        gstRate: config.gstRate,
        gridTariff: config.gridTariff,
      },
    })
  } catch (err) {
    console.error('[solar agent] recommendation log failed:', err)
  }
}

export async function dispatchInboundToSolar(
  args: SolarDispatchArgs,
): Promise<SolarDispatchResult> {
  const { accountId, userId, conversationId, contactId, message } = args

  try {
    const db = supabaseAdmin()

    const config = await loadSolarConfig(db, accountId)
    if (!config.enabled || !config.autoReplyEnabled) return { handled: false }

    const trimmed = (message ?? '').trim()
    if (!trimmed) return { handled: false }

    const thread = await recentThread(db, conversationId)
    const parsedNow = extractFromHistory([{ text: trimmed, fromCustomer: true }])
    const hasFacts = parsedNow.billAmount != null || parsedNow.monthlyUnits != null || parsedNow.state != null
    const inSolarThread = isSolarThread(thread)
    const isSolar = isSolarQuery(trimmed)

    // Only engage when the message is solar-related OR we're mid-flow
    // and the customer just answered (e.g. replied "UP" or "2000").
    if (!isSolar && !(hasFacts && inSolarThread)) return { handled: false }

    const profile = await loadSolarContactProfile(db, accountId, contactId)

    // Combine the thread's customer messages (CRM profile fills gaps).
    const customerTexts = thread
      .filter((r) => r.sender_type === 'customer' && r.content_text)
      .map((r) => r.content_text as string)
    customerTexts.push(trimmed)

    const result = buildRecommendation({
      customerMessages: customerTexts,
      profile,
      config,
    })

    // Write any newly learned facts back to the CRM contact.
    if (result.input.billAmount != null || result.input.monthlyUnits != null || result.input.state) {
      await writeContactFacts(db, accountId, userId, contactId, result.input)
    }

    const intent = detectIntent(trimmed)

    // Process / general questions don't need full data.
    if (intent === 'process') {
      await engineSendText({
        accountId,
        userId,
        conversationId,
        contactId,
        text: formatProcess(config),
      })
      return { handled: true }
    }

    if (intent === 'subsidy' && result.recommendation) {
      await engineSendText({
        accountId,
        userId,
        conversationId,
        contactId,
        text: formatSubsidy(result.recommendation, profile?.name),
      })
      return { handled: true }
    }

    if (result.needsBill) {
      // No consumption data yet → ask for the bill (+ state).
      await engineSendText({
        accountId,
        userId,
        conversationId,
        contactId,
        text: askForBill(),
      })
      return { handled: true }
    }

    if (!result.recommendation) return { handled: false }

    // Duplicate-quote guard: the customer repeated the same info with
    // nothing new — don't re-text the identical quote.
    const prev = await lastRecommendation(db, accountId, conversationId)
    if (sameRecommendation(prev, result.recommendation)) {
      return { handled: true }
    }

    await logRecommendation(db, accountId, contactId, conversationId, result.input, result.recommendation, config)

    const text = result.needsState
      ? formatSizingOnly(result.recommendation, config, profile?.name)
      : formatQuote(result.recommendation, config, profile?.name)

    await engineSendText({
      accountId,
      userId,
      conversationId,
      contactId,
      text,
    })

    return { handled: true }
  } catch (err) {
    console.error('[solar agent] dispatch failed:', err)
    return { handled: false }
  }
}
