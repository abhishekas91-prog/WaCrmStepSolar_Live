// ============================================================
// Solar context for the LLM. The generic AI auto-reply / draft path
// uses this to ground its answer in *authoritative* computed numbers
// when the customer asks a solar question the deterministic bot
// didn't fully handle. The LLM formats these figures — it never
// recomputes them.
// ============================================================

import type { CompatClient } from "@/lib/mongo/compat"
import type { SolarConfig } from './types'
import { loadSolarConfig } from './config'
import { buildRecommendation } from './recommend'
import { isSolarQuery } from './extract'
import { loadSolarContactProfile } from './crm'
import { inr } from './format'

export interface SolarContextArgs {
  db: CompatClient
  accountId: string
  contactId: string
  conversationId: string
  /** The customer's latest message. */
  messageText: string
}

/** Compact, authoritative solar facts block for the system prompt. */
export function solarContextBlock(
  config: SolarConfig,
  rec: {
    stateKnown: boolean
    monthlyUnits: number
    recommendedKw: number
    baseCost: number
    gstAmount: number
    grossCost: number
    totalSubsidy: number
    netPayable: number
    monthlySavings: number
    paybackMonths: number
    state: string | null
  },
): string {
  const lines = [
    'SOLAR CONSULTANT DATA (authoritative — quote these exact figures, do NOT recompute):',
    `- Recommended system: ${rec.recommendedKw} kW on-grid`,
    `- Estimated monthly consumption: ~${rec.monthlyUnits} units`,
    `- System + installation: ${inr(rec.baseCost)}; GST (${config.gstRate}%): ${inr(rec.gstAmount)}; total: ${inr(rec.grossCost)}`,
    `- Total subsidy: ${inr(rec.totalSubsidy)} (central PM Surya Ghar${rec.state ? ` + ${rec.state} top-up` : ''})`,
    `- Net payable: ${inr(rec.netPayable)}`,
    `- Est. monthly bill savings: ${inr(rec.monthlySavings)}`,
  ]
  if (rec.paybackMonths > 0) {
    lines.push(`- Payback period: ~${rec.paybackMonths} months`)
  }
  if (!rec.stateKnown) {
    lines.push(
      '- Customer state is unknown — ask which state they live in before quoting subsidy.',
    )
  }
  lines.push(
    `- Process (share if asked): ${(config.processSteps.length > 0 ? config.processSteps : ['survey → quotation → install → inspection → subsidy']).join(' → ')}`,
  )
  return lines.join('\n')
}

/**
 * Build a solar context string for the LLM, or null when the message
 * isn't solar-related (so callers don't pay extra queries for nothing).
 * Best-effort — never throws.
 */
export async function buildSolarContext(
  args: SolarContextArgs,
): Promise<string | null> {
  const { db, accountId, contactId, conversationId, messageText } = args
  try {
    if (!isSolarQuery(messageText)) return null

    const config = await loadSolarConfig(db, accountId)
    if (!config.enabled) return null

    const profile = await loadSolarContactProfile(db, accountId, contactId)

    const { data } = await db
      .from('messages')
      .select('sender_type, content_text')
      .eq('conversation_id', conversationId)
      .eq('content_type', 'text')
      .order('created_at', { ascending: false })
      .limit(15)
    const rows = ((data ?? []) as Array<{ sender_type: string; content_text: string | null }>).reverse()
    const customerTexts = rows
      .filter((r) => r.sender_type === 'customer' && r.content_text)
      .map((r) => r.content_text as string)
    customerTexts.push(messageText)

    const result = buildRecommendation({ customerMessages: customerTexts, profile, config })

    if (!result.recommendation) {
      const guidance = result.needsBill
        ? 'Customer has NOT shared a bill/units figure yet — ask them for their monthly electricity bill amount or units, and their state.'
        : 'Customer has not shared their state yet — ask which state they live in before quoting subsidy.'
      return `SOLAR CONSULTANT DATA (authoritative):\n${guidance}`
    }

    return solarContextBlock(config, {
      stateKnown: !result.needsState,
      monthlyUnits: result.recommendation.monthlyUnits,
      recommendedKw: result.recommendation.recommendedKw,
      baseCost: result.recommendation.baseCost,
      gstAmount: result.recommendation.gstAmount,
      grossCost: result.recommendation.grossCost,
      totalSubsidy: result.recommendation.totalSubsidy,
      netPayable: result.recommendation.netPayable,
      monthlySavings: result.recommendation.monthlySavings,
      paybackMonths: result.recommendation.paybackMonths,
      state: result.input.state ?? null,
    })
  } catch (err) {
    console.error('[solar context] build failed:', err)
    return null
  }
}
