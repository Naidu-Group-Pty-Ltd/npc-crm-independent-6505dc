
-- Phase 14: Launch, Operations & Change Management
-- 1. Rollout stage on tenant_settings + audit log
ALTER TABLE aml.tenant_settings
  ADD COLUMN IF NOT EXISTS rollout_stage text NOT NULL DEFAULT 'internal_dev_only'
    CHECK (rollout_stage IN ('internal_dev_only','admin_limited','controlled_team_rollout','broad_production')),
  ADD COLUMN IF NOT EXISTS rollout_stage_since timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS rollout_notes text;

CREATE TABLE IF NOT EXISTS aml.rollout_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default' REFERENCES aml.tenant_settings(tenant_id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid,
  changed_by_label text,
  reason text,
  gate_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON aml.rollout_stage_history TO authenticated;
GRANT ALL ON aml.rollout_stage_history TO service_role;
ALTER TABLE aml.rollout_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY rollout_stage_history_read ON aml.rollout_stage_history FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
CREATE POLICY rollout_stage_history_service ON aml.rollout_stage_history FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS rollout_stage_history_tenant_idx
  ON aml.rollout_stage_history(tenant_id, created_at DESC);

-- 2. Acceptance scenarios (report §22) + traceability
CREATE TABLE IF NOT EXISTS aml.acceptance_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default' REFERENCES aml.tenant_settings(tenant_id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  phase text,
  category text,
  requirement_refs text[] NOT NULL DEFAULT '{}',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_status text NOT NULL DEFAULT 'not_run'
    CHECK (last_status IN ('not_run','passed','failed','blocked','waived')),
  last_run_at timestamptz,
  last_run_by uuid,
  last_run_by_label text,
  last_run_notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
GRANT SELECT ON aml.acceptance_scenarios TO authenticated;
GRANT ALL ON aml.acceptance_scenarios TO service_role;
ALTER TABLE aml.acceptance_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY acceptance_scenarios_read ON aml.acceptance_scenarios FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
CREATE POLICY acceptance_scenarios_mlro_write ON aml.acceptance_scenarios FOR ALL TO authenticated
  USING (aml.has_aml_role(auth.uid(),'mlro'))
  WITH CHECK (aml.has_aml_role(auth.uid(),'mlro'));

-- 3. Risk register (report §23)
CREATE TABLE IF NOT EXISTS aml.risk_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default' REFERENCES aml.tenant_settings(tenant_id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  category text,
  likelihood text NOT NULL DEFAULT 'medium' CHECK (likelihood IN ('low','medium','high')),
  impact text NOT NULL DEFAULT 'medium' CHECK (impact IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','mitigated','accepted','retired')),
  owner_label text,
  mitigation text,
  next_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
GRANT SELECT ON aml.risk_register TO authenticated;
GRANT ALL ON aml.risk_register TO service_role;
ALTER TABLE aml.risk_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY risk_register_read ON aml.risk_register FOR SELECT TO authenticated
  USING (aml.has_any_aml_role(auth.uid()));
CREATE POLICY risk_register_mlro_write ON aml.risk_register FOR ALL TO authenticated
  USING (aml.has_aml_role(auth.uid(),'mlro'))
  WITH CHECK (aml.has_aml_role(auth.uid(),'mlro'));

-- updated_at triggers reuse existing helper if present
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'aml'::regnamespace) THEN
    EXECUTE 'CREATE TRIGGER acceptance_scenarios_touch BEFORE UPDATE ON aml.acceptance_scenarios FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at()';
    EXECUTE 'CREATE TRIGGER risk_register_touch BEFORE UPDATE ON aml.risk_register FOR EACH ROW EXECUTE FUNCTION aml.set_updated_at()';
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
