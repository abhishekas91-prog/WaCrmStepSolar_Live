import { describe, it, expect } from 'vitest'
import {
  extractFromMessage,
  extractFromHistory,
  extractState,
  isSolarQuery,
  detectIntent,
} from './extract'

describe('extractFromMessage', () => {
  it('extracts a bill from Hinglish phrasing', () => {
    expect(extractFromMessage('mera monthly bill 2000 hai').billAmount).toBe(2000)
    expect(extractFromMessage('bill ₹3000').billAmount).toBe(3000)
    expect(extractFromMessage('electricity bill is rs. 4200').billAmount).toBe(4200)
  })

  it('extracts units with a unit keyword', () => {
    expect(extractFromMessage('mere 250 unit aate hain').monthlyUnits).toBe(250)
    expect(extractFromMessage('consumption 400 units').monthlyUnits).toBe(400)
  })

  it('takes the midpoint of a bill range', () => {
    expect(extractFromMessage('bill 2000-2500 hai').billAmount).toBe(2250)
  })

  it('ignores phone numbers', () => {
    const out = extractFromMessage('my number is 9876543210')
    expect(out.billAmount).toBeNull()
    expect(out.monthlyUnits).toBeNull()
  })

  it('does not treat a bare number as a bill without context', () => {
    expect(extractFromMessage('yes 2000 ok').billAmount).toBeNull()
  })
})

describe('extractState', () => {
  it('finds a state anywhere in the sentence', () => {
    expect(extractState('main UP me rehta hu')).toBe('Uttar Pradesh')
    expect(extractState('I live in Maharashtra')).toBe('Maharashtra')
    expect(extractState('hum बिहार से हैं')).toBe('Bihar')
  })

  it('prefers the longest alias match', () => {
    expect(extractState('Madhya Pradesh me')).toBe('Madhya Pradesh')
  })
})

describe('extractFromHistory', () => {
  it('folds facts across earlier customer messages', () => {
    const merged = extractFromHistory([
      { text: 'mera bill 2000 hai', fromCustomer: true },
      { text: 'UP', fromCustomer: true },
      { text: 'agent: bilkul', fromCustomer: false },
    ])
    expect(merged.billAmount).toBe(2000)
    expect(merged.state).toBe('Uttar Pradesh')
  })
})

describe('isSolarQuery / detectIntent', () => {
  it('detects solar keywords', () => {
    expect(isSolarQuery('solar panel kitne ka hai')).toBe(true)
    expect(isSolarQuery('subsidy kya hai')).toBe(true)
    expect(isSolarQuery('rooftop solar lagana hai')).toBe(true)
  })

  it('detects facts-driven intent', () => {
    expect(isSolarQuery('mera bill 2500 hai')).toBe(true)
  })

  it('leaves non-solar chat alone', () => {
    expect(isSolarQuery('hello kya hal hai')).toBe(false)
    expect(isSolarQuery('delivery kab aayegi')).toBe(false)
  })

  it('classifies intent', () => {
    expect(detectIntent('solar lagane ka process kya hai')).toBe('process')
    expect(detectIntent('subsidy kitni milegi')).toBe('subsidy')
    expect(detectIntent('3kw kitne ka padega')).toBe('cost')
    expect(detectIntent('mera bill 2000 hai')).toBe('bill_or_units')
    expect(detectIntent('hello')).toBe('none')
  })
})
