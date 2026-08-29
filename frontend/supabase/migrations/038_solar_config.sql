-- ============================================================
-- 038_solar_config.sql — Solar Assistant (sizing / cost / subsidy)
--
-- Adds two account-scoped tables:
--   - `solar_config`          one row per account — pricing, tariff,
--                             subsidy overrides, process steps. Mirrors
--                             the ai_configs settings-class shape.
--   - `solar_recommendations` append-only log of every quote the bot
--                             computes, so agents can see (and re-send)
--                             what the WhatsApp bot promised a customer.
--
-- The bot's math runs in app code (src/lib/solar/*) using the
-- built-in PM Surya Ghar slab + per-state dataset, with the
-- account's `subsidy_overrides` (JSONB { "State": { "topUp": n } })
-- taking precedence. This table only stores the config/overrides.
--
-- RLS mirrors ai_configs: any member may read (the inbox/agent needs
-- to know the bot is on), admin+ may write. The webhook engine runs
-- under the service-role client and bypasses RLS.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS solar_config (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT true,
  price_per_kw       numeric NOT NULL DEFAULT 55000,
  tariff_per_unit    numeric NOT NULL DEFAULT 7.5,
  generation_factor  numeric NOT NULL DEFAULT 4.0,
  gst_rate           numeric NOT NULL DEFAULT 5,
  grid_tariff        numeric NOT NULL DEFAULT 7.5,
  subsidy_overrides  jsonb NOT NULL DEFAULT '{}'::jsonb,
  process_steps      jsonb,
  company_name       text,
  auto_reply_enabled boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE solar_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS solar_config_select ON solar_config;
CREATE POLICY solar_config_select ON solar_config FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS solar_config_insert ON solar_config;
CREATE POLICY solar_config_insert ON solar_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS solar_config_update ON solar_config;
CREATE POLICY solar_config_update ON solar_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS solar_config_delete ON solar_config;
CREATE POLICY solar_config_delete ON solar_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_solar_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solar_config_updated_at ON solar_config;
CREATE TRIGGER solar_config_updated_at
  BEFORE UPDATE ON solar_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_solar_config_updated_at();

-- ============================================================
-- Recommendation log.
-- ============================================================
CREATE TABLE IF NOT EXISTS solar_recommendations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  state             text,
  recommended_kw    numeric,
  input_payload     jsonb,
  recommendation    jsonb,
  config_snapshot   jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE solar_recommendations ENABLE ROW LEVEL SECURITY;

-- Any member of the account can read the recommendation log.
DROP POLICY IF EXISTS solar_recommendations_select ON solar_recommendations;
CREATE POLICY solar_recommendations_select ON solar_recommendations FOR SELECT
  USING (is_account_member(account_id));

-- Written by the webhook bot under the service-role client (no
-- auth.uid()); members may also insert for manual logging.
DROP POLICY IF EXISTS solar_recommendations_insert ON solar_recommendations;
CREATE POLICY solar_recommendations_insert ON solar_recommendations FOR INSERT
  WITH CHECK (is_account_member(account_id));

CREATE INDEX IF NOT EXISTS idx_solar_recommendations_account_created
  ON solar_recommendations (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_solar_recommendations_contact
  ON solar_recommendations (contact_id);
