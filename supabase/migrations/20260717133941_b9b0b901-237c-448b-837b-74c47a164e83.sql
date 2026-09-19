
CREATE TABLE IF NOT EXISTS aml.launch_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','revoked')),
  attested_by uuid NOT NULL,
  attested_by_label text,
  attestation text NOT NULL,
  release_gate_id uuid,
  release_gate_status text,
  rollout_stage text,
  scenario_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  revoked_by uuid,
  revoked_by_label text,
  revoked_reason text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aml_launch_certifications_tenant
  ON aml.launch_certifications (tenant_id, created_at DESC);

GRANT ALL ON aml.launch_certifications TO service_role;
