// ============================================================
// Solar sizing & cost math. Pure, deterministic, unit-testable.
//
// Sizing: an average on-grid system in India produces roughly
// `generationFactorPerKwPerDay` units per kW per day (default 4,
// ≈ 120 units/kW/month). Given the customer's monthly consumption we
// back out the kW that would cover ~100% of it, then round up to a
// standard kit size.
//
// Cost: `pricePerKw` is the fully-loaded installed ₹/kW (panels +
// inverter + balance of system + installation). GST is applied on
// top; the central + state subsidy is subtracted to give the net
// payable.
//
// Savings: the solar generation offsets grid units at the account's
// configured grid tariff. Payback = net payable ÷ monthly savings.
// ============================================================

import type { SolarConfig, SolarRecommendation, SolarInput } from './types'
import { nearestStandardSize } from './data'

export interface ComputeArgs {
  input: SolarInput
  config: SolarConfig
}

/** How many units per kW per month the system is assumed to generate. */
function unitsPerKwPerMonth(config: SolarConfig): number {
  return config.generationFactorPerKwPerDay * 30
}

/**
 * Estimate monthly consumption (units) from a bill amount and/or
 * explicit units. Bill amount wins when both are present (it's the
 * more reliable number customers actually read off their bill); a
 * raw units figure is used directly when the bill is missing.
 */
export function estimateMonthlyUnits(
  input: Pick<SolarInput, 'billAmount' | 'monthlyUnits'>,
  config: SolarConfig,
): number {
  if (input.monthlyUnits && input.monthlyUnits > 0) {
    return input.monthlyUnits
  }
  if (input.billAmount && input.billAmount > 0) {
    return input.billAmount / config.tariffPerUnit
  }
  return 0
}

/**
 * Required kW to cover the monthly consumption. Zero when we have no
 * consumption signal at all.
 */
export function requiredKwForUnits(unitsPerMonth: number, config: SolarConfig): number {
  if (unitsPerMonth <= 0) return 0
  return unitsPerMonth / unitsPerKwPerMonth(config)
}

/**
 * Monthly savings in ₹: the smaller of (units generated) and
 * (units consumed), times the grid tariff. The min() prevents us from
 * claiming savings on generation that the house doesn't actually use.
 */
export function monthlySavings(
  unitsPerMonth: number,
  recommendedKw: number,
  config: SolarConfig,
): number {
  const generated = recommendedKw * unitsPerKwPerMonth(config)
  const offsetUnits = Math.min(generated, unitsPerMonth)
  return offsetUnits * config.gridTariff
}

export function computeRecommendation(
  args: ComputeArgs,
  subsidy: { central: number; stateTopUp: number },
): SolarRecommendation {
  const { input, config } = args
  const monthlyUnits = estimateMonthlyUnits(input, config)
  const requiredKw = requiredKwForUnits(monthlyUnits, config)
  const recommendedKw = requiredKw > 0 ? nearestStandardSize(requiredKw) : 0
  const stateKnown = Boolean(input.state)

  const baseCost = recommendedKw * config.pricePerKw
  const gstAmount = (baseCost * config.gstRate) / 100
  const grossCost = baseCost + gstAmount
  const totalSubsidy = subsidy.central + subsidy.stateTopUp
  const netPayable = Math.max(0, grossCost - totalSubsidy)

  const savings = monthlySavings(monthlyUnits, recommendedKw, config)
  const paybackMonths =
    savings > 0 ? Math.round((netPayable / savings) * 10) / 10 : 0

  return {
    input,
    requiredKw: Math.round(requiredKw * 100) / 100,
    recommendedKw,
    monthlyUnits: Math.round(monthlyUnits),
    stateKnown,
    centralSubsidy: Math.round(subsidy.central),
    stateTopUp: Math.round(subsidy.stateTopUp),
    totalSubsidy: Math.round(totalSubsidy),
    baseCost: Math.round(baseCost),
    gstAmount: Math.round(gstAmount),
    grossCost: Math.round(grossCost),
    netPayable: Math.round(netPayable),
    monthlySavings: Math.round(savings),
    paybackMonths,
  }
}
