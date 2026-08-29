// ============================================================
// Extract structured solar facts (bill amount, monthly units, state)
// from a WhatsApp message or a short conversation window. Tolerant of
// Hinglish + Hindi phrasing so a customer's "bill 2000 hai", "250
// unit", "मेरा बिल ₹3000" or "UP me rahta hu" all parse cleanly.
// ============================================================

import type { SolarInput, SolarIntent } from './types'
import { STATE_ALIASES, normalizeState } from './subsidy'

const CURRENCY_MARKERS = /(?:₹|rs\.?|rupees?|rupaye|रु|रुपये|rs\s)/i
const BILL_CONTEXT = /(?:bill|बिल|billy|bijli bill|electricity|monthly)/i
const UNITS_CONTEXT = /(?:unit|यूनिट|units?|kwh|किलोवाट)/i
const RANGE_RE = /(\d{2,7})\s*[-–]\s*(\d{2,7})/
const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?)/g

const SOLAR_KEYWORDS = /(?:solar|सौर|surya|सूर्य|panel|पैनल|rooftop|रूफटॉप|roof|on.?grid|off.?grid|inverter|इन्वर्टर|battery|बैटरी|plant|lgana|लगाना|instal|subsidy|सब्सिडी|subsid|cost|price|कीमत|kitna|कितना|kw|किलोवाट|kilowatt|watt)/i

const PROCESS_KEYWORDS = /(?:process|प्रोसेस|procedure|kaise|कैसे|steps|steps?|install process|process kya)/i
const SUBSIDY_KEYWORDS = /(?:subsidy|सब्सिडी|subsid|grant|sarkari|सरकारी|free money|subsidi)/i
const COST_KEYWORDS = /(?:cost|price|कीमत|kitna lagega|kitne ka|kitna ka|कितना लगेगा|कितने का|expense|rate|quote|quotation|rate)/i

function stripCommas(s: string): string {
  return s.replace(/,/g, '')
}

/** Pull a number out of a token like "rs2000" / "₹3000". */
function currencyPrefixed(s: string): number | null {
  const m = s.match(/(?:₹|rs\.?|rupees?|rupaye|रु|रुपये)\s*(\d[\d,]*(?:\.\d+)?)/i)
  if (m) return parseFloat(stripCommas(m[1]))
  return null
}

/**
 * Detect a state mention anywhere in the text using the subsidy
 * alias table. Longest alias wins (so "Madhya Pradesh" beats "Pradesh").
 * Two-letter aliases ("UP", "MP") are only trusted when written in
 * capitals or next to a location phrase ("me rehta", "se hu", ...) so a
 * stray preposition "up" or "in" doesn't set a false state.
 */
const SHORT_ALIAS_CONTEXT = /(?:rehta|rehti|rahata|rahti|rhta|se |hu|hoon|hai|hain|main|me |from|in |में|रहता|रहती|से |हूँ|हैं|मैं)/i

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function extractState(text: string): string | null {
  const original = ' ' + text + ' '
  const lower = original.toLowerCase()
  let best: { name: string; len: number } | null = null
  for (const alias of Object.keys(STATE_ALIASES)) {
    if (alias.length < 2) continue
    const needle = alias.toLowerCase()
    const regex = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(needle)}(?![\\p{L}\\p{N}])`, 'iu')
    const m = regex.exec(lower)
    if (!m) continue
    if (alias.length === 2) {
      const start = m.index + 1 // compensate for the leading space we added
      const upper = /[A-Z]{2}/.test(original.slice(start - 1, start + needle.length + 1))
      const near = lower.slice(Math.max(0, start - 10), start + needle.length + 14)
      if (!upper && !SHORT_ALIAS_CONTEXT.test(near)) continue
    }
    const canon = normalizeState(alias)
    if (!canon) continue
    if (!best || alias.length > best.len) best = { name: canon, len: alias.length }
  }
  return best?.name ?? null
}

/**
 * Extract { billAmount, monthlyUnits, state } from a single message.
 * A number is treated as a *bill* when it has a currency marker or a
 * bill/बिल keyword nearby; as *units* when a units/kWh keyword is
 * nearby. Ranges (2000-2500) take the midpoint. Phone numbers (10+
 * digits) are ignored.
 */
export function extractFromMessage(text: string): SolarInput {
  const out: SolarInput = { billAmount: null, monthlyUnits: null, state: null }

  const cleaned = stripCommas(text)
  out.state = extractState(text)

  const hasBillCtx = BILL_CONTEXT.test(text)
  const hasUnitsCtx = UNITS_CONTEXT.test(text)

  // Range like "2000-2500" (often a bill) → midpoint.
  const range = cleaned.match(RANGE_RE)
  if (range) {
    const lo = parseFloat(range[1])
    const hi = parseFloat(range[2])
    const mid = Math.round((lo + hi) / 2)
    if (hasBillCtx || !hasUnitsCtx) out.billAmount = mid
    else out.monthlyUnits = mid
  }

  const tokens = text.split(/\s+/)
  for (const token of tokens) {
    if (token.length < 2) continue
    const cur = currencyPrefixed(token)
    if (cur !== null && cur <= 100_000) {
      // A currency marker alone is enough to call it a bill.
      if (!out.billAmount) out.billAmount = Math.round(cur)
      continue
    }
  }

  // Fallback: scan numbers with context keywords on the same token
  // (e.g. "2000rs", "250unit").
  const numbers = [...cleaned.matchAll(NUMBER_RE)].map((m) => ({
    value: parseFloat(stripCommas(m[1])),
    index: m.index ?? 0,
  }))

  for (const n of numbers) {
    if (n.value < 10 || n.value > 100_000) continue
    const windowStart = Math.max(0, n.index - 12)
    const windowEnd = Math.min(cleaned.length, n.index + String(n.value).length + 12)
    const ctx = cleaned.slice(windowStart, windowEnd)
    const isBill = CURRENCY_MARKERS.test(ctx) || BILL_CONTEXT.test(ctx)
    const isUnits = UNITS_CONTEXT.test(ctx)
    if (isUnits && !isBill) {
      if (!out.monthlyUnits && n.value <= 10_000) out.monthlyUnits = Math.round(n.value)
    } else if (isBill) {
      if (!out.billAmount) out.billAmount = Math.round(n.value)
    }
  }

  return out
}

/**
 * Fold facts across the last few customer messages (oldest first) plus
 * the current one, so the bot can use what was said earlier in the
 * thread ("bill 2000" followed by "UP" → both captured).
 */
export function extractFromHistory(messages: Array<{ text: string; fromCustomer: boolean }>): SolarInput {
  const merged: SolarInput = { billAmount: null, monthlyUnits: null, state: null }
  for (const m of messages) {
    if (!m.fromCustomer) continue
    const part = extractFromMessage(m.text)
    if (part.billAmount != null && merged.billAmount == null) merged.billAmount = part.billAmount
    if (part.monthlyUnits != null && merged.monthlyUnits == null) merged.monthlyUnits = part.monthlyUnits
    if (part.state && !merged.state) merged.state = part.state
  }
  return merged
}

/** Does this message look like a solar-related query at all? */
export function isSolarQuery(text: string): boolean {
  if (!text) return false
  if (SOLAR_KEYWORDS.test(text)) return true
  // A bare bill/units figure with context is also solar intent.
  const parsed = extractFromMessage(text)
  if (parsed.billAmount != null || parsed.monthlyUnits != null || parsed.state) return true
  return false
}

export function detectIntent(text: string): SolarIntent {
  if (!text) return 'none'
  if (PROCESS_KEYWORDS.test(text) && SOLAR_KEYWORDS.test(text)) return 'process'
  if (SUBSIDY_KEYWORDS.test(text)) return 'subsidy'
  if (COST_KEYWORDS.test(text)) return 'cost'
  const parsed = extractFromMessage(text)
  if (parsed.billAmount != null || parsed.monthlyUnits != null) return 'bill_or_units'
  if (parsed.state) return 'state'
  if (SOLAR_KEYWORDS.test(text)) return 'solar_query'
  return 'none'
}
