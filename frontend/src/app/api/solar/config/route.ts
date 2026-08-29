import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadSolarConfig, saveSolarConfig } from '@/lib/solar/config'
import { STATE_SUBSIDY_DATA, DEFAULT_SOLAR_CONFIG, STATE_NAMES } from '@/lib/solar/data'
import type { SolarConfig, StateSubsidyOverride } from '@/lib/solar/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function sanitizeConfig(config: SolarConfig) {
  return {
    enabled: config.enabled,
    auto_reply_enabled: config.autoReplyEnabled,
    price_per_kw: config.pricePerKw,
    tariff_per_unit: config.tariffPerUnit,
    generation_factor: config.generationFactorPerKwPerDay,
    gst_rate: config.gstRate,
    grid_tariff: config.gridTariff,
    subsidy_overrides: config.subsidyOverrides,
    process_steps: config.processSteps,
    company_name: config.companyName,
  }
}

/**
 * GET /api/solar/config
 *
 * Any member may read the solar config (the inbox/agents need to know
 * whether the bot is on). Also returns the built-in state dataset so
 * the admin editor can render defaults.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const config = await loadSolarConfig(supabase, accountId)

    return NextResponse.json({
      configured: true,
      config: sanitizeConfig(config),
      defaults: sanitizeConfig(DEFAULT_SOLAR_CONFIG),
      states: STATE_NAMES,
      builtin_subsidy: STATE_SUBSIDY_DATA as Record<string, StateSubsidyOverride>,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/solar/config  (admin+)
 *
 * Validate + persist the account's solar config. Accepts either the
 * full config object (all fields) or partial overrides — missing fields
 * are merged onto the current stored config so partial saves don't wipe
 * values.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`solar-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const current = await loadSolarConfig(supabase, accountId)

    const num = (v: unknown, fallback: number): number => {
      const n = Number(v)
      return Number.isFinite(n) && n >= 0 ? n : fallback
    }

    const pricePerKw = num(body.price_per_kw, current.pricePerKw)
    const tariffPerUnit = num(body.tariff_per_unit, current.tariffPerUnit)
    const generationFactor = num(body.generation_factor, current.generationFactorPerKwPerDay)
    const gstRate = num(body.gst_rate, current.gstRate)
    const gridTariff = num(body.grid_tariff, current.gridTariff)

    let subsidyOverrides = current.subsidyOverrides
    if (body.subsidy_overrides && typeof body.subsidy_overrides === 'object') {
      const next: Record<string, StateSubsidyOverride> = {}
      for (const [state, val] of Object.entries(body.subsidy_overrides as Record<string, unknown>)) {
        const v = val as { topUp?: unknown; note?: unknown }
        next[state] = {
          topUp: num(v?.topUp, 0),
          note: typeof v?.note === 'string' && v.note.trim() ? v.note.trim() : undefined,
        }
      }
      subsidyOverrides = next
    }

    const processSteps = Array.isArray(body.process_steps)
      ? (body.process_steps as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : current.processSteps

    const next: SolarConfig = {
      enabled: typeof body.enabled === 'boolean' ? body.enabled : current.enabled,
      autoReplyEnabled:
        typeof body.auto_reply_enabled === 'boolean'
          ? body.auto_reply_enabled
          : current.autoReplyEnabled,
      pricePerKw,
      tariffPerUnit,
      generationFactorPerKwPerDay: generationFactor,
      gstRate,
      gridTariff,
      subsidyOverrides,
      processSteps,
      companyName:
        typeof body.company_name === 'string' && body.company_name.trim()
          ? body.company_name.trim()
          : current.companyName,
    }

    const { error } = await saveSolarConfig(supabase, accountId, userId, next)
    if (error) {
      console.error('[solar/config POST] save error:', error)
      return NextResponse.json({ error: 'Failed to save solar config' }, { status: 500 })
    }

    return NextResponse.json({ success: true, config: sanitizeConfig(next) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
