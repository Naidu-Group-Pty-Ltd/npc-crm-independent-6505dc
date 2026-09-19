
-- Phase 13 — Security, Resilience, AI Boundaries & Governance

-- ============ step_up_challenges ============
CREATE TABLE aml.step_up_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  capability TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON aml.step_up_challenges(user_id, capability, created_at DESC);
GRANT SELECT ON aml.step_up_challenges TO authenticated;
GRANT ALL ON aml.step_up_challenges TO service_role;
ALTER TABLE aml.step_up_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_suc_read_own" ON aml.step_up_challenges FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.has_any_aml_role(auth.uid()));

-- ============ step_up_sessions ============
CREATE TABLE aml.step_up_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  capability TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON aml.step_up_sessions(user_id, capability, expires_at DESC);
GRANT SELECT ON aml.step_up_sessions TO authenticated;
GRANT ALL ON aml.step_up_sessions TO service_role;
ALTER TABLE aml.step_up_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_sus_read_own" ON aml.step_up_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.has_any_aml_role(auth.uid()));

-- ============ ai_action_approvals ============
CREATE TABLE aml.ai_action_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,
  action_summary TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposer TEXT NOT NULL DEFAULT 'aurixa_agent',
  proposer_context JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','expired')),
  decided_by UUID,
  decided_by_label TEXT,
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  execution_result JSONB,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON aml.ai_action_approvals(status, created_at DESC);
GRANT SELECT ON aml.ai_action_approvals TO authenticated;
GRANT ALL ON aml.ai_action_approvals TO service_role;
ALTER TABLE aml.ai_action_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_aia_read" ON aml.ai_action_approvals FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));

-- ============ release_gates ============
CREATE TABLE aml.release_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_name TEXT NOT NULL,
  version_tag TEXT,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','warn','running')),
  checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  triggered_by UUID,
  triggered_by_label TEXT,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INT
);
CREATE INDEX ON aml.release_gates(ran_at DESC);
GRANT SELECT ON aml.release_gates TO authenticated;
GRANT ALL ON aml.release_gates TO service_role;
ALTER TABLE aml.release_gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rg_read" ON aml.release_gates FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));

-- ============ resilience_drills ============
CREATE TABLE aml.resilience_drills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('backup_restore','provider_outage','secret_rotation','tabletop','other')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','failed','cancelled')),
  scheduled_for TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  executed_by UUID,
  executed_by_label TEXT,
  scope JSONB,
  findings TEXT,
  action_items JSONB DEFAULT '[]'::jsonb,
  next_review_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON aml.resilience_drills(kind, executed_at DESC NULLS LAST);
GRANT SELECT ON aml.resilience_drills TO authenticated;
GRANT ALL ON aml.resilience_drills TO service_role;
ALTER TABLE aml.resilience_drills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_rd_read" ON aml.resilience_drills FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));

-- Reusable updated_at trigger for the two mutable tables
CREATE OR REPLACE FUNCTION aml.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = aml, public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER aml_aia_updated BEFORE UPDATE ON aml.ai_action_approvals
FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
CREATE TRIGGER aml_rd_updated BEFORE UPDATE ON aml.resilience_drills
FOR EACH ROW EXECUTE FUNCTION aml.tg_set_updated_at();
