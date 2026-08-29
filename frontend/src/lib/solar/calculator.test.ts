import { describe, it, expect } from 'vitest'
import {
  estimateMonthlyUnits,
  requiredKwForUnits,
  monthlySavings,
  computeRecommendation,
} from './calculator'
import { DEFAULT_SOLAR_CONFIG } from './data'
import type { SolarInput } from './types'

const config = { ...DEFAULT_SOLAR_CONFIG }

describe('estimateMonthlyUnits', () => {
  it('prefers explicit units over a bill-derived estimate', () => {
    expect(estimateMonthlyUnits({ billAmount: 3000, monthlyUnits: 400 }, config)).toBe(400)
  })

  it('derives units from a bill amount using the tariff divisor', () => {
    expect(estimateMonthlyUnits({ billAmount: 3000, monthlyUnits: null }, config)).toBe(400)
  })

  it('returns 0 with no signal', () => {
    expect(estimateMonthlyUnits({ billAmount: null, monthlyUnits: null }, config)).toBe(0)
  })
})

describe('requiredKwForUnits', () => {
  it('sizes ~4 units/kW/day → 120 units/kW/month', () => {
    expect(requiredKwForUnits(600, config)).toBeCloseTo(5, 1)
  })

  it('returns 0 for zero/negative consumption', () => {
    expect(requiredKwForUnits(0, config)).toBe(0)
  })
})

describe('monthlySavings', () => {
  it('never claims savings beyond the household consumption', () => {
    // 1 kW generates ~120 units; consumption only 50 → savings = 50 × tariff.
    expect(monthlySavings(50, 1, config)).toBeCloseTo(50 * config.gridTariff, 1)
  })

  it('savings cap at generated units', () => {
    expect(monthlySavings(1000, 1, config)).toBeCloseTo(120 * config.gridTariff, 1)
  })
})

describe('computeRecommendation', () => {
  it('builds a full recommendation from a bill + state', () => {
    const input: SolarInput = { billAmount: 3000, monthlyUnits: null, state: 'Uttar Pradesh' }
    const rec = computeRecommendation(
      { input, config },
      { central: 60000, stateTopUp: 0 },
    )
    expect(rec.monthlyUnits).toBe(400)
    expect(rec.recommendedKw).toBe(5) // 400 / 120 ≈ 3.33 → rounds to 5
    expect(rec.baseCost).toBe(5 * config.pricePerKw)
    expect(rec.grossCost).toBe(rec.baseCost + rec.gstAmount)
    expect(rec.netPayable).toBe(rec.grossCost - rec.totalSubsidy)
    expect(rec.totalSubsidy).toBe(60000)
    expect(rec.stateKnown).toBe(true)
  })

  it('reports stateUnknown when no state is supplied', () => {
    const input: SolarInput = { billAmount: 1500, monthlyUnits: null, state: null }
    const rec = computeRecommendation({ input, config }, { central: 0, stateTopUp: 0 })
    expect(rec.stateKnown).toBe(false)
    // 1500 / 7.5 = 200 units → 200 / 120 ≈ 1.67 kW → rounds up to 2 kW.
    expect(rec.recommendedKw).toBe(2)
  })
})
