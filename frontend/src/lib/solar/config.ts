// ============================================================
// Solar config persistence. Loads the account's `solar_config` row
// (Mongo via CompatClient, mirrored in the Postgres migration) and
// merges it over the built-in defaults so the bot always has a valid
// config. Also exposes `saveSolarConfig` for the admin settings API.
// ============================================================

import type { CompatClient } from "@/lib/mongo/compat"
import type { SolarConfig, StateSubsidyOverride } from './types'
import { DEFAULT_SOLAR_CONFIG } from './data'

export interface SolarConfigRow {
  id: string
  enabled: boolean
  price_per_kw: number
  tariff_per_unit: number
  generation_factor: number
  gst_rate: number
  grid_tariff: number
  subsidy_overrides: Record<string, StateSubsidyOverride>
  process_steps: string[]
  company_name: string
  auto_reply_enabled: boolean
}

export const SOLAR_CONFIG_COLUMNS =
  'id, enabled, price_per_kw, tariff_per_unit, generation_factor, gst_rate, grid_tariff, subsidy_overrides, process_steps, company_name, auto_reply_enabled'

export function solarConfigFromRow(row: Partial<SolarConfigRow>): SolarConfig {
  return {
    enabled: row.enabled ?? DEFAULT_SOLAR_CONFIG.enabled,
    pricePerKw: row.price_per_kw ?? DEFAULT_SOLAR_CONFIG.pricePerKw,
    tariffPerUnit: row.tariff_per_unit ?? DEFAULT_SOLAR_CONFIG.tariffPerUnit,
    generationFactorPerKwPerDay:
      row.generation_factor ?? DEFAULT_SOLAR_CONFIG.generationFactorPerKwPerDay,
    gstRate: row.gst_rate ?? DEFAULT_SOLAR_CONFIG.gstRate,
    gridTariff: row.grid_tariff ?? DEFAULT_SOLAR_CONFIG.gridTariff,
    subsidyOverrides: row.subsidy_overrides ?? DEFAULT_SOLAR_CONFIG.subsidyOverrides,
    processSteps: row.process_steps?.length
      ? row.process_steps
      : DEFAULT_SOLAR_CONFIG.processSteps,
    companyName: row.company_name || DEFAULT_SOLAR_CONFIG.companyName,
    autoReplyEnabled:
      row.auto_reply_enabled ?? DEFAULT_SOLAR_CONFIG.autoReplyEnabled,
  }
}

/** Solar config → DB row shape (for save). */
export function solarConfigToRow(config: SolarConfig): Partial<SolarConfigRow> {
  return {
    enabled: config.enabled,
    price_per_kw: config.pricePerKw,
    tariff_per_unit: config.tariffPerUnit,
    generation_factor: config.generationFactorPerKwPerDay,
    gst_rate: config.gstRate,
    grid_tariff: config.gridTariff,
    subsidy_overrides: config.subsidyOverrides,
    process_steps: config.processSteps,
    company_name: config.companyName,
    auto_reply_enabled: config.autoReplyEnabled,
  }
}

/**
 * Load the account's solar config. Never returns null — missing row
 * yields the built-in defaults. Works with any client (service-role
 * from the webhook, RLS-scoped from the settings route).
 */
export async function loadSolarConfig(
  db: CompatClient,
  accountId: string,
): Promise<SolarConfig> {
  const { data, error } = await db
    .from('solar_config')
    .select(SOLAR_CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[solar config] load error:', error)
    return { ...DEFAULT_SOLAR_CONFIG }
  }
  if (!data) return { ...DEFAULT_SOLAR_CONFIG }
  return solarConfigFromRow(data as Partial<SolarConfigRow>)
}

/**
 * Upsert the account's solar config. Requires a client with write
 * access (service-role admin, or the RLS-scoped SSR client from the
 * admin-only settings route). Returns `{ error }` on failure.
 */
export async function saveSolarConfig(
  db: CompatClient,
  accountId: string,
  userId: string,
  config: SolarConfig,
): Promise<{ error: string | null }> {
  const row = solarConfigToRow(config)
  const { data: existing } = await db
    .from('solar_config')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()

  if (existing) {
    const { error } = await db
      .from('solar_config')
      .update(row)
      .eq('account_id', accountId)
    return { error: error ? error.message : null }
  }

  const { error } = await db.from('solar_config').insert({
    account_id: accountId,
    user_id: userId,
    ...row,
  })
  return { error: error ? error.message : null }
}
