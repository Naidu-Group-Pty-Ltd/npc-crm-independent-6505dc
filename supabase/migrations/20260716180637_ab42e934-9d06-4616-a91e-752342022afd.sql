
-- Phase 5 — AML Risk Engine, Mandatory Holds, Decisions, Approvals, Conditions

CREATE TABLE IF NOT EXISTS aml.risk_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  weight numeric NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  description text,
  scoring jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE aml.risk_factors ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aml.mandatory_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'block',
  rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE aml.mandatory_triggers ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aml.risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  completion_score numeric NOT NULL DEFAULT 0,
  verification_score numeric NOT NULL DEFAULT 0,
  mltf_score numeric NOT NULL DEFAULT 0,
  risk_rating text,
  triggered_holds jsonb NOT NULL DEFAULT '[]'::jsonb,
  factor_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_risk_assessments_case ON aml.risk_assessments(case_id, created_at DESC);
ALTER TABLE aml.risk_assessments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aml.risk_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES aml.risk_assessments(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL,
  requested_reason text NOT NULL,
  requested_rating text,
  status text NOT NULL DEFAULT 'pending',
  reviewer_id uuid,
  reviewer_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_risk_overrides_case ON aml.risk_overrides(case_id, created_at DESC);
ALTER TABLE aml.risk_overrides ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aml.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES aml.risk_assessments(id) ON DELETE SET NULL,
  outcome text NOT NULL,
  rationale text,
  snapshot jsonb NOT NULL,
  snapshot_hash text NOT NULL,
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_decisions_case ON aml.decisions(case_id, decided_at DESC);
ALTER TABLE aml.decisions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aml.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES aml.decisions(id) ON DELETE SET NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL,
  approver_id uuid,
  note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_aml_approvals_case ON aml.approvals(case_id, requested_at DESC);
ALTER TABLE aml.approvals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS aml.case_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  label text NOT NULL,
  detail text,
  status text NOT NULL DEFAULT 'open',
  created_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_case_conditions_case ON aml.case_conditions(case_id, created_at DESC);
ALTER TABLE aml.case_conditions ENABLE ROW LEVEL SECURITY;

-- Grants (schema aml is not exposed to anon; edge fns use service_role)
GRANT USAGE ON SCHEMA aml TO authenticated, service_role;
GRANT SELECT ON aml.risk_factors, aml.mandatory_triggers, aml.risk_assessments,
  aml.risk_overrides, aml.decisions, aml.approvals, aml.case_conditions TO authenticated;
GRANT ALL ON aml.risk_factors, aml.mandatory_triggers, aml.risk_assessments,
  aml.risk_overrides, aml.decisions, aml.approvals, aml.case_conditions TO service_role;

-- RLS: any AML role may read; writes go through edge fns (service_role)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['risk_factors','mandatory_triggers','risk_assessments','risk_overrides','decisions','approvals','case_conditions']
  LOOP
    EXECUTE format($p$
      DROP POLICY IF EXISTS "aml_read_%1$s" ON aml.%1$I;
      CREATE POLICY "aml_read_%1$s" ON aml.%1$I FOR SELECT TO authenticated
        USING (public.has_any_aml_role(auth.uid()));
    $p$, t);
  END LOOP;
END$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION aml.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['risk_factors','mandatory_triggers','case_conditions']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON aml.%1$I;', t);
    EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON aml.%1$I FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();', t);
  END LOOP;
END$$;

-- Purchase-ready gate feature flag (off by default; soft gate)
INSERT INTO public.feature_flags(key, value, description)
VALUES ('aml_purchase_ready_gate', '{"enabled": false}'::jsonb, 'When enabled, purchase-ready workflows check AML decision + open holds. Additive/soft gate.')
ON CONFLICT (key) DO NOTHING;

-- Seed default factors and mandatory triggers (idempotent)
INSERT INTO aml.risk_factors(key, label, category, weight, scoring, description) VALUES
  ('geography', 'Geographic risk', 'mltf', 2.0, '{"low":10,"medium":40,"high":80}'::jsonb, 'Country/region risk exposure'),
  ('pep', 'PEP exposure', 'mltf', 3.0, '{"none":0,"associate":50,"direct":90}'::jsonb, 'Politically exposed person status'),
  ('funding_source', 'Source of funds complexity', 'mltf', 2.0, '{"salary":10,"savings":25,"gift":45,"crypto":70,"unclear":90}'::jsonb, 'Complexity/opacity of funding'),
  ('structure', 'Entity/structure complexity', 'mltf', 1.5, '{"individual":10,"company":30,"trust":45,"smsf":50,"nested":80}'::jsonb, 'Purchasing structure risk'),
  ('id_completeness', 'Identity document completeness', 'completion', 1.0, '{"complete":0,"partial":40,"missing":90}'::jsonb, 'How much of the KYC dossier is present'),
  ('verification_strength', 'Verification strength', 'verification', 1.0, '{"strong":0,"moderate":40,"weak":80}'::jsonb, 'IDV + screening evidence strength')
ON CONFLICT (key) DO NOTHING;

INSERT INTO aml.mandatory_triggers(key, label, description, severity, rule) VALUES
  ('sanctions_hit', 'Confirmed sanctions match', 'Any confirmed sanctions match forces block regardless of numeric score', 'block', '{"screening":{"confirmed_match":true}}'::jsonb),
  ('pep_direct_no_edd', 'Direct PEP without EDD complete', 'Direct PEP requires enhanced due diligence', 'hold', '{"pep":"direct","edd_complete":false}'::jsonb),
  ('idv_failed', 'Identity verification failed', 'IDV negative result blocks purchase-ready state', 'block', '{"idv":"failed"}'::jsonb),
  ('funding_unclear', 'Source of funds unclear', 'Manual EDD required before proceeding', 'hold', '{"funding_source":"unclear"}'::jsonb),
  ('prohibited_jurisdiction', 'Prohibited jurisdiction', 'Client tied to prohibited jurisdiction', 'block', '{"geography":"prohibited"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
