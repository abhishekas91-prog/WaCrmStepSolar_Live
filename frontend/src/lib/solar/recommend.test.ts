import { describe, it, expect } from 'vitest'
import { buildRecommendation } from './recommend'
import type { SolarContactProfile } from './types'

describe('buildRecommendation', () => {
  it('is complete when bill + state are known', () => {
    const r = buildRecommendation({
      customerMessages: ['mera bill 2400 hai', 'UP'],
    })
    expect(r.needsBill).toBe(false)
    expect(r.needsState).toBe(false)
    expect(r.complete).toBe(true)
    expect(r.recommendation).not.toBeNull()
    expect(r.recommendation!.input.state).toBe('Uttar Pradesh')
  })

  it('needs a bill when nothing is known', () => {
    const r = buildRecommendation({ customerMessages: ['solar kitne ka hai'] })
    expect(r.needsBill).toBe(true)
    expect(r.recommendation).toBeNull()
  })

  it('needs the state for subsidy but still sizes the system', () => {
    const r = buildRecommendation({ customerMessages: ['bill 3000 hai'] })
    expect(r.needsBill).toBe(false)
    expect(r.needsState).toBe(true)
    expect(r.complete).toBe(false)
    expect(r.recommendation).not.toBeNull()
    expect(r.recommendation!.recommendedKw).toBeGreaterThan(0)
  })

  it('fills gaps from the CRM contact profile', () => {
    const profile: SolarContactProfile = {
      contactId: 'c1',
      name: 'Ramesh',
      phone: '+919000000000',
      state: 'Rajasthan',
      avgBillAmount: 2600,
      avgMonthlyUnits: null,
      customFields: [],
    }
    const r = buildRecommendation({ customerMessages: [], profile })
    expect(r.needsBill).toBe(false)
    expect(r.needsState).toBe(false)
    expect(r.complete).toBe(true)
    expect(r.input.state).toBe('Rajasthan')
    expect(r.recommendation!.netPayable).toBeGreaterThan(0)
  })

  it('lets the conversation override the CRM profile', () => {
    const profile: SolarContactProfile = {
      contactId: 'c1',
      name: 'Ramesh',
      phone: '+919000000000',
      state: 'Rajasthan',
      avgBillAmount: 2600,
      avgMonthlyUnits: null,
      customFields: [],
    }
    const r = buildRecommendation({
      customerMessages: ['main Bihar se hu'],
      profile,
    })
    expect(r.input.state).toBe('Bihar')
  })
})
