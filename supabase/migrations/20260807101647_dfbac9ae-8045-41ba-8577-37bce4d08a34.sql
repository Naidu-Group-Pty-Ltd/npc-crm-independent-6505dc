ALTER TABLE aml.compliance_attestations
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1
    CHECK (schema_version IN (1, 2)),
  ADD COLUMN IF NOT EXISTS material_input_hash text,
  ADD COLUMN IF NOT EXISTS service_gate_decision_id uuid
    REFERENCES aml.service_gate_decisions(id),
  ADD COLUMN IF NOT EXISTS issued_reason_code text
    CHECK (issued_reason_code IS NULL OR issued_reason_code IN
      ('initial_issue', 'material_change', 'scheduled_refresh', 'correction', 'other')),
  ADD COLUMN IF NOT EXISTS superseded_reason_code text
    CHECK (superseded_reason_code IS NULL OR superseded_reason_code IN
      ('new_version_issued', 'material_change', 'revoked', 'error_correction', 'other')),
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid
    REFERENCES aml.compliance_attestations(id);

CREATE TABLE IF NOT EXISTS aml.disclosure_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attestation_id uuid NOT NULL REFERENCES aml.compliance_attestations(id),
  grant_id uuid NOT NULL UNIQUE REFERENCES aml.reliance_grants(id),
  partner_org_id uuid REFERENCES aml.partner_organisations(id),
  partner_case_link_id uuid REFERENCES aml.partner_case_links(id),
  purpose text NOT NULL,
  consent_id uuid REFERENCES aml.consents(id),
  allowed_attribute_codes text[] NOT NULL,
  allowed_record_classes text[] NOT NULL DEFAULT ARRAY[]::text[],
  denied_classes text[] NOT NULL,
  version integer NOT NULL DEFAULT 1,
  manifest_sha256 text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aml_disclosure_manifests_attestation
  ON aml.disclosure_manifests (attestation_id, created_at DESC);

GRANT ALL ON aml.disclosure_manifests TO service_role;
ALTER TABLE aml.disclosure_manifests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_disclosure_manifests_service_only"
    ON aml.disclosure_manifests FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_attestation_v2', 'false'::jsonb,
   'AML partner domain Phase 3: issue schema-v2 attestations (explicit service-gate decision required, material-input hash, reason codes) and construct partner responses by intersecting the payload with a per-grant disclosure manifest. Off = v1 issuance and reading, unchanged.')
ON CONFLICT (key) DO NOTHING;