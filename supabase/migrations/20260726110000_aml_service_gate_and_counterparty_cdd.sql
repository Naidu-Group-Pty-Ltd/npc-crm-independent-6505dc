-- Phases 8 + 9 (risk/decision/service-gate + transaction/counterparty) —
-- explicit service-gate decision records (directive Appendix C.4), analyst
-- recommendations (§12.8), risk-override evidence hardening (§12.8), and the
-- delayed-CDD / uncooperative-counterparty record (§12.5).
--
-- Additive and reversible. The service gate remains a separate workflow
-- dimension (§16): it is only ever changed by an explicit, audited gate
-- decision — never inferred from case stage or risk rating.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS aml.service_gate_decisions;
--   DROP TABLE IF EXISTS aml.analyst_recommendations;
--   ALTER TABLE aml.risk_overrides
--     DROP COLUMN IF EXISTS evidence_note,
--     DROP COLUMN IF EXISTS program_version;
--   ALTER TABLE aml.counterparty_cases
--     DROP COLUMN IF EXISTS delayed_cdd_deadline,
--     DROP COLUMN IF EXISTS delayed_cdd_justification,
--     DROP COLUMN IF EXISTS uncooperative,
--     DROP COLUMN IF EXISTS uncooperative_marked_at,
--     DROP COLUMN IF EXISTS uncooperative_reason;

-- 1) Service-gate decisions (Appendix C.4) --------------------------------
CREATE TABLE IF NOT EXISTS aml.service_gate_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'cdd_incomplete', 'information_outstanding', 'under_review',
    'conditions_outstanding', 'approved_with_controls', 'approved',
    'locked', 'terminated')),
  effective_at timestamptz NOT NULL DEFAULT now(),
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_id uuid REFERENCES aml.decisions(id),
  approved_by uuid NOT NULL,
  policy_version text,
  reason text NOT NULL,
  audit_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_sgd_case ON aml.service_gate_decisions(case_id, created_at DESC);

-- Read for AML roles; writes only through the SECURITY DEFINER edge function
-- so approval preconditions and audit cannot be bypassed from the browser.
ALTER TABLE aml.service_gate_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_sgd_read" ON aml.service_gate_decisions
  FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
GRANT SELECT ON aml.service_gate_decisions TO authenticated;
GRANT ALL ON aml.service_gate_decisions TO service_role;

-- 2) Analyst recommendations (§12.8) --------------------------------------
CREATE TABLE IF NOT EXISTS aml.analyst_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES aml.risk_assessments(id),
  recommended_outcome text NOT NULL CHECK (recommended_outcome IN (
    'cleared', 'cleared_with_conditions', 'edd_required', 'escalated', 'blocked')),
  rationale text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'superseded', 'actioned')),
  actioned_decision_id uuid REFERENCES aml.decisions(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_rec_case ON aml.analyst_recommendations(case_id, created_at DESC);

ALTER TABLE aml.analyst_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rec_read" ON aml.analyst_recommendations
  FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
GRANT SELECT ON aml.analyst_recommendations TO authenticated;
GRANT ALL ON aml.analyst_recommendations TO service_role;

-- 3) Override hardening (§12.8: no rating override without reason,
--    evidence, decision-maker, policy version and audit event) -------------
ALTER TABLE aml.risk_overrides
  ADD COLUMN IF NOT EXISTS evidence_note text,
  ADD COLUMN IF NOT EXISTS program_version text;

-- 4) Delayed CDD + uncooperative-counterparty record (§12.5) ---------------
ALTER TABLE aml.counterparty_cases
  ADD COLUMN IF NOT EXISTS delayed_cdd_deadline date,
  ADD COLUMN IF NOT EXISTS delayed_cdd_justification text,
  ADD COLUMN IF NOT EXISTS uncooperative boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS uncooperative_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS uncooperative_reason text;
