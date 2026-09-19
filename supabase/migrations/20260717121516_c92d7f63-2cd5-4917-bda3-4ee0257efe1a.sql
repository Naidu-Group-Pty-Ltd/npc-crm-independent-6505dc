ALTER TABLE aml.tenant_settings
  ADD COLUMN IF NOT EXISTS risk_program_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS straight_through_config jsonb NOT NULL DEFAULT
    '{"enabled": false, "max_mltf_score": 25, "require_completion_score": 70, "require_verification_score": 70, "disallow_holds": true}'::jsonb;

ALTER TABLE aml.risk_assessments
  ADD COLUMN IF NOT EXISTS program_version text,
  ADD COLUMN IF NOT EXISTS policy_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS straight_through boolean NOT NULL DEFAULT false;

ALTER TABLE aml.decisions
  ADD COLUMN IF NOT EXISTS program_version text,
  ADD COLUMN IF NOT EXISTS is_straight_through boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_risk_assessments_program_version ON aml.risk_assessments(program_version);
CREATE INDEX IF NOT EXISTS idx_decisions_program_version ON aml.decisions(program_version);