
-- Phase 9: Ongoing CDD, Monitoring, EDD & Existing-Client Remediation

-- ─── Monitoring Rules ────────────────────────────────────────────────
CREATE TABLE aml.monitoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  trigger_kind text NOT NULL,      -- 'transaction_amount', 'velocity', 'stale_verification', 'rescreen_due', 'high_risk_geo', 'sanctions_delta', 'custom'
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'medium', -- info|low|medium|high|critical
  is_enabled boolean NOT NULL DEFAULT true,
  cooldown_minutes int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.monitoring_rules TO authenticated;
GRANT ALL ON aml.monitoring_rules TO service_role;
ALTER TABLE aml.monitoring_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rules_read" ON aml.monitoring_rules FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_rules_write" ON aml.monitoring_rules FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- ─── Monitoring Events ───────────────────────────────────────────────
CREATE TABLE aml.monitoring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES aml.cases(id) ON DELETE CASCADE,
  source text NOT NULL,              -- 'transaction', 'finance', 'verification', 'screening', 'system'
  event_kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_monitoring_events_case_idx ON aml.monitoring_events(case_id, observed_at DESC);
CREATE INDEX aml_monitoring_events_unprocessed_idx ON aml.monitoring_events(processed_at) WHERE processed_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.monitoring_events TO authenticated;
GRANT ALL ON aml.monitoring_events TO service_role;
ALTER TABLE aml.monitoring_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_events_read" ON aml.monitoring_events FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_events_write" ON aml.monitoring_events FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- ─── Alerts ──────────────────────────────────────────────────────────
CREATE TABLE aml.alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES aml.cases(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES aml.monitoring_rules(id) ON DELETE SET NULL,
  event_id uuid REFERENCES aml.monitoring_events(id) ON DELETE SET NULL,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open', -- open|investigating|escalated|closed|false_positive
  title text NOT NULL,
  summary text,
  assigned_to uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_alerts_case_idx ON aml.alerts(case_id, status);
CREATE INDEX aml_alerts_status_idx ON aml.alerts(status, severity, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.alerts TO authenticated;
GRANT ALL ON aml.alerts TO service_role;
ALTER TABLE aml.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_alerts_read" ON aml.alerts FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_alerts_write" ON aml.alerts FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- ─── EDD Cases ───────────────────────────────────────────────────────
CREATE TABLE aml.edd_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  reason text NOT NULL,             -- 'high_risk', 'pep_hit', 'adverse_media', 'sanctions_hit', 'transaction_alert', 'periodic_review', 'other'
  status text NOT NULL DEFAULT 'open', -- open|in_progress|awaiting_client|awaiting_mlro|completed|abandoned
  narrative text,
  assigned_to uuid,
  opened_by uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  mlro_decision text,               -- 'approved', 'reject', 'exit'
  mlro_decision_by uuid,
  mlro_decision_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_edd_cases_case_idx ON aml.edd_cases(case_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.edd_cases TO authenticated;
GRANT ALL ON aml.edd_cases TO service_role;
ALTER TABLE aml.edd_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_edd_read" ON aml.edd_cases FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_edd_write" ON aml.edd_cases FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- ─── Source of Funds ─────────────────────────────────────────────────
CREATE TABLE aml.source_of_funds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edd_case_id uuid REFERENCES aml.edd_cases(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  source_type text NOT NULL,        -- 'salary', 'business_income', 'sale_of_property', 'inheritance', 'gift', 'investment', 'loan', 'other'
  description text,
  amount numeric,
  currency text DEFAULT 'AUD',
  evidence_path text,
  evidence_provider text,
  verified boolean NOT NULL DEFAULT false,
  verified_by uuid,
  verified_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_sof_case_idx ON aml.source_of_funds(case_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.source_of_funds TO authenticated;
GRANT ALL ON aml.source_of_funds TO service_role;
ALTER TABLE aml.source_of_funds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_sof_read" ON aml.source_of_funds FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_sof_write" ON aml.source_of_funds FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- ─── Source of Wealth ────────────────────────────────────────────────
CREATE TABLE aml.source_of_wealth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edd_case_id uuid REFERENCES aml.edd_cases(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  wealth_type text NOT NULL,        -- 'business_ownership', 'investments', 'property_portfolio', 'inheritance', 'employment_history', 'other'
  description text,
  estimated_value numeric,
  currency text DEFAULT 'AUD',
  evidence_path text,
  verified boolean NOT NULL DEFAULT false,
  verified_by uuid,
  verified_at timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_sow_case_idx ON aml.source_of_wealth(case_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.source_of_wealth TO authenticated;
GRANT ALL ON aml.source_of_wealth TO service_role;
ALTER TABLE aml.source_of_wealth ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_sow_read" ON aml.source_of_wealth FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_sow_write" ON aml.source_of_wealth FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- ─── Existing Customer Reviews (Pre-Commencement Remediation) ────────
CREATE TABLE aml.existing_customer_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES aml.cases(id) ON DELETE CASCADE,
  client_id uuid,
  classification text NOT NULL DEFAULT 'pre_commencement', -- 'pre_commencement', 'periodic', 'trigger_based'
  status text NOT NULL DEFAULT 'queued', -- queued|in_progress|remediation_required|complete|exited
  priority text NOT NULL DEFAULT 'normal', -- low|normal|high|urgent
  due_at timestamptz,
  assigned_to uuid,
  reviewer_notes text,
  outcome text,                      -- 'no_change', 'refresh_required', 'edd_opened', 'exited', 'reported'
  outcome_at timestamptz,
  outcome_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aml_ecr_status_idx ON aml.existing_customer_reviews(status, due_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.existing_customer_reviews TO authenticated;
GRANT ALL ON aml.existing_customer_reviews TO service_role;
ALTER TABLE aml.existing_customer_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_ecr_read" ON aml.existing_customer_reviews FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_ecr_write" ON aml.existing_customer_reviews FOR ALL TO authenticated USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- ─── updated_at triggers ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION aml.tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_aml_rules_updated BEFORE UPDATE ON aml.monitoring_rules FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
CREATE TRIGGER trg_aml_alerts_updated BEFORE UPDATE ON aml.alerts FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
CREATE TRIGGER trg_aml_edd_updated BEFORE UPDATE ON aml.edd_cases FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
CREATE TRIGGER trg_aml_sof_updated BEFORE UPDATE ON aml.source_of_funds FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
CREATE TRIGGER trg_aml_sow_updated BEFORE UPDATE ON aml.source_of_wealth FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
CREATE TRIGGER trg_aml_ecr_updated BEFORE UPDATE ON aml.existing_customer_reviews FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();

-- ─── Seed default monitoring rules ───────────────────────────────────
INSERT INTO aml.monitoring_rules (name, description, trigger_kind, criteria, severity) VALUES
  ('Large cash transaction ≥ AUD 10,000', 'AUSTRAC threshold transaction detection (TTR precursor).', 'transaction_amount', '{"amount_gte": 10000, "currency": "AUD", "channel": "cash"}'::jsonb, 'high'),
  ('Rescreening due (12 months)', 'Sanctions/PEP re-screening cadence.', 'rescreen_due', '{"interval_days": 365}'::jsonb, 'medium'),
  ('Stale identity verification (24 months)', 'IDV refresh required.', 'stale_verification', '{"interval_days": 730}'::jsonb, 'medium'),
  ('High-risk jurisdiction touch', 'Party or funds source in a high-risk geography.', 'high_risk_geo', '{"list_key": "fatf_call_for_action"}'::jsonb, 'high');
