// ============================================================
// Shared types for the Solar Assistant — the deterministic
// sizing/cost/subsidy engine that powers both the WhatsApp solar
// bot and the AI auto-reply context enrichment.
// ============================================================

/** A single standard system size, in kW. */
export const STANDARD_SIZES_KW = [1, 2, 3, 5, 7.5, 10, 15, 20] as const

/** State subsidy data as stored in `solar_config.subsidy_overrides`. */
export interface StateSubsidyOverride {
  /** Additional ₹ on top of the central PM Surya Ghar subsidy. */
  topUp: number
  /** Optional note shown to the customer / agent. */
  note?: string
}

/**
 * The per-account solar configuration. Everything has a sensible
 * default so the bot works out of the box; admins override via
 * Settings → Solar Assistant. `subsidyOverrides` is a partial map —
 * any state absent falls back to the built-in dataset + central slab.
 */
export interface SolarConfig {
  enabled: boolean
  /** Fully-loaded on-grid installed cost ₹/kW (panels + inverter + BOS + installation). */
  pricePerKw: number
  /** Residential tariff assumed when only the bill amount is given (₹/unit). */
  tariffPerUnit: number
  /** Solar generation factor — units (kWh) generated per kW per day. */
  generationFactorPerKwPerDay: number
  /** GST rate applied on top of the base system price (%). */
  gstRate: number
  /** Default ₹/unit the customer pays — used to estimate monthly savings. */
  gridTariff: number
  /** State name → top-up override. Overrides the built-in dataset. */
  subsidyOverrides: Record<string, StateSubsidyOverride>
  /** Install-to-subsidy process steps shown to customers. */
  processSteps: string[]
  /** Sales/company display name used in replies. */
  companyName: string
  /** Whether the solar bot is allowed to auto-send on WhatsApp. */
  autoReplyEnabled: boolean
}

/** Contact facts the bot collects and reuses from the CRM. */
export interface SolarContactProfile {
  contactId: string
  name: string | null
  phone: string
  /** Normalized state name, when known from CRM custom fields. */
  state: string | null
  /** Average monthly bill (₹) or units, when known from CRM. */
  avgBillAmount: number | null
  avgMonthlyUnits: number | null
  /** Arbitrary extra CRM context (tags / notes) rendered for the agent. */
  customFields: Array<{ field: string; value: string }>
}

/** Everything the bot was able to extract from a message / conversation. */
export interface SolarInput {
  billAmount: number | null
  monthlyUnits: number | null
  state: string | null
}

/** The sized recommendation, before any formatting. */
export interface SolarRecommendation {
  input: SolarInput
  /** Raw (unrounded) required system size in kW. */
  requiredKw: number
  /** Rounded-up standard system size in kW. */
  recommendedKw: number
  /** Estimated monthly consumption in units used for sizing. */
  monthlyUnits: number
  /** Whether the customer supplied their state (needed for subsidy). */
  stateKnown: boolean
  /** Central PM Surya Ghar subsidy in ₹. */
  centralSubsidy: number
  /** State top-up subsidy in ₹ (0 when state unknown / no top-up). */
  stateTopUp: number
  /** Total subsidy (central + state) in ₹. */
  totalSubsidy: number
  /** Base system cost in ₹ (kW × pricePerKw). */
  baseCost: number
  /** GST amount in ₹. */
  gstAmount: number
  /** Gross cost (base + GST) in ₹. */
  grossCost: number
  /** Net payable after subsidy in ₹. */
  netPayable: number
  /** Estimated monthly bill savings in ₹. */
  monthlySavings: number
  /** Simple payback period in months. */
  paybackMonths: number
}

export type SolarIntent =
  | 'solar_query' // general solar / panel / rooftop question
  | 'bill_or_units' // customer shared a bill amount or units
  | 'state' // customer shared their state
  | 'process' // customer asked about the install process
  | 'subsidy' // customer asked about subsidy
  | 'cost' // customer asked about cost
  | 'none'
