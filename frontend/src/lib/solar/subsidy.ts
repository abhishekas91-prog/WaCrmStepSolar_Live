// ============================================================
// Subsidy calculation: central PM Surya Ghar slab + per-state top-up
// with admin overrides. State names are normalized so a customer's
// "UP", "उत्तर प्रदेश" or "Uttar Pradesh" all resolve to the same row.
// ============================================================

import type { SolarConfig, StateSubsidyOverride } from './types'
import { CENTRAL_SUBSIDY, STATE_SUBSIDY_DATA } from './data'

/**
 * Central PM Surya Ghar residential subsidy:
 *   - ₹30,000/kW for the first 2 kW (max ₹60,000)
 *   - ₹18,000/kW for the 3rd kW → ₹78,000 at 3 kW
 *   - capped at ₹78,000; applies to the first 3 kW only
 */
export function centralSubsidy(kw: number): number {
  const eligible = Math.min(Math.max(kw, 0), CENTRAL_SUBSIDY.eligibleKwCap)
  const firstTwo = Math.min(eligible, 2) * CENTRAL_SUBSIDY.perKwFirstTwo
  const third = Math.max(0, eligible - 2) * CENTRAL_SUBSIDY.perKwThird
  return Math.min(firstTwo + third, CENTRAL_SUBSIDY.cap)
}

export const STATE_ALIASES: Record<string, string> = {
  up: 'Uttar Pradesh',
  'uttar pradesh': 'Uttar Pradesh',
  'उत्तर प्रदेश': 'Uttar Pradesh',
  'यूपी': 'Uttar Pradesh',
  'u.p': 'Uttar Pradesh',
  maharashtra: 'Maharashtra',
  'महाराष्ट्र': 'Maharashtra',
  gujarat: 'Gujarat',
  'गुजरात': 'Gujarat',
  rajasthan: 'Rajasthan',
  'राजस्थान': 'Rajasthan',
  'madhyapradesh': 'Madhya Pradesh',
  'madhya pradesh': 'Madhya Pradesh',
  'मध्य प्रदेश': 'Madhya Pradesh',
  mp: 'Madhya Pradesh',
  bihar: 'Bihar',
  'बिहार': 'Bihar',
  jharkhand: 'Jharkhand',
  'झारखंड': 'Jharkhand',
  'westbengal': 'West Bengal',
  'west bengal': 'West Bengal',
  'पश्चिम बंगाल': 'West Bengal',
  karnataka: 'Karnataka',
  'कर्नाटक': 'Karnataka',
  'tamilnadu': 'Tamil Nadu',
  'tamil nadu': 'Tamil Nadu',
  'तमिलनाडु': 'Tamil Nadu',
  andhra: 'AndhraPradesh',
  'andhrapradesh': 'AndhraPradesh',
  'andhra pradesh': 'AndhraPradesh',
  'आंध्र प्रदेश': 'AndhraPradesh',
  telangana: 'Telangana',
  'तेलंगाना': 'Telangana',
  kerala: 'Kerala',
  'केरल': 'Kerala',
  delhi: 'Delhi',
  'दिल्ली': 'Delhi',
  haryana: 'Haryana',
  'हरियाणा': 'Haryana',
  punjab: 'Punjab',
  'पंजाब': 'Punjab',
  odisha: 'Odisha',
  'ओडिशा': 'Odisha',
  orissa: 'Odisha',
  uttarakhand: 'Uttarakhand',
  'उत्तराखंड': 'Uttarakhand',
  assam: 'Assam',
  'असम': 'Assam',
  goa: 'Goa',
  'गोवा': 'Goa',
  chandigarh: 'Chandigarh',
  'चंडीगढ़': 'Chandigarh',
}

/**
 * Normalize a raw state mention to the canonical name, or null when
 * it can't be recognized. Tolerates whitespace / casing noise.
 */
export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (STATE_ALIASES[key]) return STATE_ALIASES[key]
  // Direct hit against canonical names.
  for (const name of Object.keys(STATE_SUBSIDY_DATA)) {
    if (name.toLowerCase() === key) return name
  }
  return null
}

/**
 * State top-up from the built-in dataset, overridden by the account's
 * `subsidy_overrides` when present.
 */
export function stateTopUpFor(
  state: string,
  config: SolarConfig,
): StateSubsidyOverride {
  const override = config.subsidyOverrides[state]
  if (override) return override
  return STATE_SUBSIDY_DATA[state] ?? { topUp: 0 }
}

/** Full subsidy split for a sized system. */
export function computeSubsidy(
  state: string | null,
  kw: number,
  config: SolarConfig,
): { central: number; stateTopUp: number } {
  const central = centralSubsidy(kw)
  let stateTopUp = 0
  if (state) {
    stateTopUp = stateTopUpFor(state, config).topUp ?? 0
  }
  return { central, stateTopUp }
}
