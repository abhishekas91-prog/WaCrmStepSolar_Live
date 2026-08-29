// ============================================================
// Built-in solar domain data: central subsidy slab (PM Surya Ghar),
// per-state top-up dataset, default pricing/process constants.
//
// IMPORTANT: subsidy rates change. The values below are the widely
// published PM Surya Ghar residential slabs plus a curated set of
// state top-ups. They are safe *defaults* only — the admin overrides
// any state (and the pricing) in Settings → Solar Assistant, so a
// business can keep this accurate without a code change.
// ============================================================

import type { SolarConfig, StateSubsidyOverride } from './types'

/** Central PM Surya Ghar subsidy constants (residential rooftop). */
export const CENTRAL_SUBSIDY = {
  /** ₹/kW for the first 2 kW. */
  perKwFirstTwo: 30_000,
  /** ₹/kW for the 3rd kW (2–3 kW slab). */
  perKwThird: 18_000,
  /** Maximum central subsidy (₹78,000 at 3 kW). */
  cap: 78_000,
  /** Subsidy only applies to the first 3 kW. */
  eligibleKwCap: 3,
} as const

/**
 * Built-in state → top-up (₹, on top of the central slab). An admin
 * override in `solar_config.subsidy_overrides` wins for that state.
 */
export const STATE_SUBSIDY_DATA: Record<string, StateSubsidyOverride> = {
  'Uttar Pradesh': { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Maharashtra: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Gujarat: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Rajasthan: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  'Madhya Pradesh': { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Bihar: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Jharkhand: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  'West Bengal': { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Karnataka: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  'Tamil Nadu': { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  AndhraPradesh: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Telangana: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Kerala: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Delhi: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Haryana: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Punjab: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Odisha: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Uttarakhand: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Assam: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Goa: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
  Chandigarh: { topUp: 0, note: 'Central PM Surya Ghar slab applies.' },
}

/** Canonical list of state names (for extraction normalization). */
export const STATE_NAMES = Object.keys(STATE_SUBSIDY_DATA)

/** Default process steps (editable per account). */
export const DEFAULT_PROCESS_STEPS = [
  '1. Free site survey & bill verification (15 min call or visit)',
  '2. Custom quotation + subsidy calculation, shared on WhatsApp',
  '3. You approve → we start documentation & DISCOM subsidy registration',
  '4. Installation, net meter & DISCOM inspection (7–15 days)',
  '5. System commissioning + subsidy directly credited to your bank',
]

export const DEFAULT_SOLAR_CONFIG: SolarConfig = {
  enabled: true,
  pricePerKw: 55_000,
  tariffPerUnit: 7.5,
  generationFactorPerKwPerDay: 4.0,
  gstRate: 5,
  gridTariff: 7.5,
  subsidyOverrides: {},
  processSteps: [...DEFAULT_PROCESS_STEPS],
  companyName: 'StepSolar Energy',
  autoReplyEnabled: true,
}

/** Round a raw kW requirement up to the nearest standard size. */
export function nearestStandardSize(kw: number): number {
  const sizes = [1, 2, 3, 5, 7.5, 10, 15, 20, 25]
  for (const size of sizes) {
    if (kw <= size + 1e-9) return size
  }
  return Math.ceil(kw / 5) * 5
}
