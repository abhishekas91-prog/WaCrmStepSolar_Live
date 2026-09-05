// ============================================================
// Orchestrator: given a conversation window (customer messages) and a
// contact profile, compute the full solar recommendation the bot will
// reply with. Also answers "do we still need the state?" so the agent
// knows when to ask for more info.
// ============================================================

import type { SolarConfig, SolarInput, SolarRecommendation, SolarContactProfile } from './types'
import { extractFromHistory } from './extract'
import { computeRecommendation } from './calculator'
import { computeSubsidy } from './subsidy'
import { DEFAULT_SOLAR_CONFIG } from './data'

export interface RecommendArgs {
  /** Customer messages in the conversation, oldest first (customer turns only). */
  customerMessages: string[]
  /** CRM-known facts about the contact (state / avg bill), if any. */
  profile?: SolarContactProfile | null
  config?: SolarConfig
}

export interface RecommendResult {
  /** Combined facts: conversation + CRM profile (CRM fills gaps). */
  input: SolarInput
  recommendation: SolarRecommendation | null
  /** True when we still need the customer's state to give subsidy numbers. */
  needsState: boolean
  /** True when we need a bill/units figure to size the system. */
  needsBill: boolean
  /** Ready to send a full quote (bill/units AND state known). */
  complete: boolean
}

/**
 * Merge CRM-known facts with what's in the conversation. The
 * conversation wins (the customer just told us), the CRM fills gaps.
 */
function mergeInput(history: SolarInput, profile?: SolarContactProfile | null): SolarInput {
  return {
    billAmount: history.billAmount ?? profile?.avgBillAmount ?? null,
    monthlyUnits: history.monthlyUnits ?? profile?.avgMonthlyUnits ?? null,
    state: history.state ?? profile?.state ?? null,
  }
}

export function buildRecommendation(args: RecommendArgs): RecommendResult {
  const config = args.config ?? DEFAULT_SOLAR_CONFIG
  const historyInput = extractFromHistory(
    args.customerMessages.map((text) => ({ text, fromCustomer: true })),
  )
  const input = mergeInput(historyInput, args.profile)

  const needsBill = input.billAmount == null && input.monthlyUnits == null
  const needsState = input.state == null
  const complete = !needsBill && !needsState

  let recommendation: SolarRecommendation | null = null
  if (!needsBill) {
    const subsidy = computeSubsidy(input.state, 0, config)
    // First pass to discover the sized kW, then recompute subsidy with it.
    const sized = computeRecommendation({ input, config }, subsidy)
    const subsidySized = computeSubsidy(input.state, sized.recommendedKw, config)
    recommendation = computeRecommendation({ input, config }, subsidySized)
  }

  return { input, recommendation, needsState, needsBill, complete }
}
