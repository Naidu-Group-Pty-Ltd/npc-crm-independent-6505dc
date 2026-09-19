
-- Phase 12: AML White-Label & Multi-Tenant Commercialisation
CREATE SCHEMA IF NOT EXISTS aml;

-- Small helper (idempotent) to check AML role membership from inside RLS.
CREATE OR REPLACE FUNCTION aml.has_aml_role(_user_id uuid, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = aml, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM aml.role_assignments
    WHERE user_id = _user_id AND role::text = _role AND revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION aml.has_any_aml_role(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = aml, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM aml.role_assignments
    WHERE user_id = _user_id AND revoked_at IS NULL
  );
$$;

-- =========================================================================
-- 1. plan_tiers (global catalog, MLRO managed)
-- =========================================================================
CREATE TABLE IF NOT EXISTS aml.plan_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  monthly_price_cents integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON aml.plan_tiers TO authenticated;
GRANT ALL ON aml.plan_tiers TO service_role;
ALTER TABLE aml.plan_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_tiers_read ON aml.plan_tiers FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
CREATE POLICY plan_tiers_mlro_write ON aml.plan_tiers FOR ALL TO authenticated
  USING (aml.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (aml.has_aml_role(auth.uid(), 'mlro'));

-- Seed plans
INSERT INTO aml.plan_tiers (key, label, description, monthly_price_cents, sort_order, entitlements) VALUES
  ('starter', 'Starter', 'Individual practitioners & pilots', 0, 10, jsonb_build_object(
    'max_active_cases', 25, 'max_users', 3, 'idv_checks_per_month', 100,
    'pep_screens_per_month', 200, 'features', jsonb_build_array('cases','verification','screening','risk','records')
  )),
  ('professional', 'Professional', 'Growing brokerages & advisory firms', 49900, 20, jsonb_build_object(
    'max_active_cases', 250, 'max_users', 15, 'idv_checks_per_month', 1000,
    'pep_screens_per_month', 3000, 'features', jsonb_build_array('cases','verification','screening','risk','records','monitoring','investigations','austrac','finance','transactions')
  )),
  ('enterprise', 'Enterprise', 'AUSTRAC reporting entities & networks', 249900, 30, jsonb_build_object(
    'max_active_cases', -1, 'max_users', -1, 'idv_checks_per_month', -1,
    'pep_screens_per_month', -1, 'features', jsonb_build_array('cases','verification','screening','risk','records','monitoring','investigations','austrac','finance','transactions','counterparty','governance','white_label','api_access')
  ))
ON CONFLICT (key) DO NOTHING;

-- =========================================================================
-- 2. tenant_settings (single row for single-tenant projects; keyed by tenant_id text)
-- =========================================================================
CREATE TABLE IF NOT EXISTS aml.tenant_settings (
  tenant_id text PRIMARY KEY DEFAULT 'default',
  display_name text NOT NULL DEFAULT 'AML/CTF Command Centre',
  brand_kit_id uuid,
  plan_tier_key text NOT NULL DEFAULT 'starter' REFERENCES aml.plan_tiers(key),
  terminology_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_email text,
  mlro_contact_name text,
  mlro_contact_email text,
  locale text NOT NULL DEFAULT 'en-AU',
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  disposal_grace_days integer NOT NULL DEFAULT 7,
  support_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON aml.tenant_settings TO authenticated;
GRANT ALL ON aml.tenant_settings TO service_role;
ALTER TABLE aml.tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_read ON aml.tenant_settings FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
CREATE POLICY tenant_settings_mlro_write ON aml.tenant_settings FOR ALL TO authenticated
  USING (aml.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (aml.has_aml_role(auth.uid(), 'mlro'));

INSERT INTO aml.tenant_settings (tenant_id) VALUES ('default') ON CONFLICT (tenant_id) DO NOTHING;

-- =========================================================================
-- 3. tenant_entitlement_overrides
-- =========================================================================
CREATE TABLE IF NOT EXISTS aml.tenant_entitlement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default' REFERENCES aml.tenant_settings(tenant_id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  value jsonb NOT NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entitlement_key)
);
GRANT SELECT ON aml.tenant_entitlement_overrides TO authenticated;
GRANT ALL ON aml.tenant_entitlement_overrides TO service_role;
ALTER TABLE aml.tenant_entitlement_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_ent_read ON aml.tenant_entitlement_overrides FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
CREATE POLICY tenant_ent_mlro_write ON aml.tenant_entitlement_overrides FOR ALL TO authenticated
  USING (aml.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (aml.has_aml_role(auth.uid(), 'mlro'));

-- =========================================================================
-- 4. provider_configs
-- =========================================================================
CREATE TABLE IF NOT EXISTS aml.provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default' REFERENCES aml.tenant_settings(tenant_id) ON DELETE CASCADE,
  capability text NOT NULL, -- idv | pep_sanctions | adverse_media | transaction_monitoring | austrac_lodgement
  provider_key text NOT NULL, -- greenid | frankieone | dowjones | worldcheck | comply_advantage | austrac_online | ...
  display_label text,
  priority integer NOT NULL DEFAULT 1,
  cost_per_unit_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'AUD',
  active boolean NOT NULL DEFAULT true,
  secret_ref text, -- name of secret in Supabase secrets (never store raw credentials here)
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_health_at timestamptz,
  last_health_status text, -- ok | degraded | failing | unknown
  last_health_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, capability, provider_key)
);
CREATE INDEX IF NOT EXISTS provider_configs_capability_idx ON aml.provider_configs(tenant_id, capability, priority);
GRANT SELECT ON aml.provider_configs TO authenticated;
GRANT ALL ON aml.provider_configs TO service_role;
ALTER TABLE aml.provider_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_configs_read ON aml.provider_configs FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
CREATE POLICY provider_configs_mlro_write ON aml.provider_configs FOR ALL TO authenticated
  USING (aml.has_aml_role(auth.uid(), 'mlro'))
  WITH CHECK (aml.has_aml_role(auth.uid(), 'mlro'));

-- =========================================================================
-- 5. provider_metrics_daily
-- =========================================================================
CREATE TABLE IF NOT EXISTS aml.provider_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  capability text NOT NULL,
  provider_key text NOT NULL,
  metric_date date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  call_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  latency_ms_sum bigint NOT NULL DEFAULT 0,
  cost_cents_sum bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, capability, provider_key, metric_date)
);
CREATE INDEX IF NOT EXISTS provider_metrics_recent_idx ON aml.provider_metrics_daily(tenant_id, metric_date DESC);
GRANT SELECT ON aml.provider_metrics_daily TO authenticated;
GRANT ALL ON aml.provider_metrics_daily TO service_role;
ALTER TABLE aml.provider_metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_metrics_read ON aml.provider_metrics_daily FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
-- writes are service_role only (no user-facing policy).

-- =========================================================================
-- updated_at trigger
-- =========================================================================
CREATE OR REPLACE FUNCTION aml.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'plan_tiers_updated_at') THEN
    CREATE TRIGGER plan_tiers_updated_at BEFORE UPDATE ON aml.plan_tiers
      FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tenant_settings_updated_at') THEN
    CREATE TRIGGER tenant_settings_updated_at BEFORE UPDATE ON aml.tenant_settings
      FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tenant_ent_updated_at') THEN
    CREATE TRIGGER tenant_ent_updated_at BEFORE UPDATE ON aml.tenant_entitlement_overrides
      FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'provider_configs_updated_at') THEN
    CREATE TRIGGER provider_configs_updated_at BEFORE UPDATE ON aml.provider_configs
      FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'provider_metrics_updated_at') THEN
    CREATE TRIGGER provider_metrics_updated_at BEFORE UPDATE ON aml.provider_metrics_daily
      FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at();
  END IF;
END $$;
