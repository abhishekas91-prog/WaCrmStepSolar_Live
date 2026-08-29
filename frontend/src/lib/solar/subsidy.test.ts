import { describe, it, expect } from 'vitest'
import { centralSubsidy, normalizeState, stateTopUpFor, computeSubsidy } from './subsidy'
import { DEFAULT_SOLAR_CONFIG } from './data'
import type { SolarConfig } from './types'

describe('centralSubsidy (PM Surya Ghar slab)', () => {
  it('₹30,000/kW up to 2 kW', () => {
    expect(centralSubsidy(0)).toBe(0)
    expect(centralSubsidy(1)).toBe(30000)
    expect(centralSubsidy(2)).toBe(60000)
  })

  it('₹18,000/kW for the 3rd kW', () => {
    expect(centralSubsidy(3)).toBe(78000)
  })

  it('caps at ₹78,000 for larger systems', () => {
    expect(centralSubsidy(5)).toBe(78000)
    expect(centralSubsidy(10)).toBe(78000)
  })
})

describe('normalizeState', () => {
  it('resolves aliases', () => {
    expect(normalizeState('UP')).toBe('Uttar Pradesh')
    expect(normalizeState('up')).toBe('Uttar Pradesh')
    expect(normalizeState('uttar pradesh')).toBe('Uttar Pradesh')
    expect(normalizeState('यूपी')).toBe('Uttar Pradesh')
    expect(normalizeState('madhya pradesh')).toBe('Madhya Pradesh')
    expect(normalizeState('tamilnadu')).toBe('Tamil Nadu')
    expect(normalizeState('west bengal')).toBe('West Bengal')
  })

  it('returns null for unknown input', () => {
    expect(normalizeState('atlantis')).toBeNull()
    expect(normalizeState('')).toBeNull()
    expect(normalizeState(null)).toBeNull()
  })
})

describe('stateTopUpFor', () => {
  it('falls back to the built-in dataset', () => {
    expect(stateTopUpFor('Uttar Pradesh', DEFAULT_SOLAR_CONFIG).topUp).toBe(0)
  })

  it('respects an admin override', () => {
    const config: SolarConfig = {
      ...DEFAULT_SOLAR_CONFIG,
      subsidyOverrides: { Rajasthan: { topUp: 30000 } },
    }
    expect(stateTopUpFor('Rajasthan', config).topUp).toBe(30000)
  })
})

describe('computeSubsidy', () => {
  it('returns only central when state is unknown', () => {
    const { central, stateTopUp } = computeSubsidy(null, 3, DEFAULT_SOLAR_CONFIG)
    expect(central).toBe(78000)
    expect(stateTopUp).toBe(0)
  })

  it('adds state top-up when known and overridden', () => {
    const config: SolarConfig = {
      ...DEFAULT_SOLAR_CONFIG,
      subsidyOverrides: { Gujarat: { topUp: 12000 } },
    }
    const { central, stateTopUp } = computeSubsidy('Gujarat', 3, config)
    expect(central).toBe(78000)
    expect(stateTopUp).toBe(12000)
  })
})
