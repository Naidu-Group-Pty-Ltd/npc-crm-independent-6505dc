ALTER TABLE aml.independent_assessments
  DROP CONSTRAINT IF EXISTS independent_assessments_status_check;
ALTER TABLE aml.independent_assessments
  ADD CONSTRAINT independent_assessments_status_check CHECK (status IN
    ('open', 'satisfied', 'not_satisfied', 'records_requested', 'independent_cdd_required'));

ALTER TABLE aml.independent_assessments
  ALTER COLUMN grant_id DROP NOT NULL,
  ALTER COLUMN agreement_id DROP NOT NULL,
  ALTER COLUMN based_on_attestation_sha256 DROP NOT NULL;

ALTER TABLE aml.independent_assessments
  ADD COLUMN IF NOT EXISTS partner_org_id uuid REFERENCES aml.partner_organisations(id),
  ADD COLUMN IF NOT EXISTS partner_case_link_id uuid REFERENCES aml.partner_case_links(id),
  ADD COLUMN IF NOT EXISTS assessor_user_source text
    CHECK (assessor_user_source IS NULL OR assessor_user_source IN
      ('finance_portal_users', 'builder_portal_users', 'solicitor_portal_users', 'external_token')),
  ADD COLUMN IF NOT EXISTS assessor_user_id uuid,
  ADD COLUMN IF NOT EXISTS membership_id uuid REFERENCES aml.partner_portal_memberships(id),
  ADD COLUMN IF NOT EXISTS responsibility_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS decision_basis text,
  ADD COLUMN IF NOT EXISTS conditions text;

ALTER TABLE aml.independent_assessments
  DROP CONSTRAINT IF EXISTS independent_assessment_hash_coherent;
ALTER TABLE aml.independent_assessments
  ADD CONSTRAINT independent_assessment_hash_coherent CHECK (
    status = 'independent_cdd_required' OR based_on_attestation_sha256 IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_aml_independent_assessments_link
  ON aml.independent_assessments (partner_case_link_id, created_at DESC)
  WHERE partner_case_link_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS aml.partner_records_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL DEFAULT 'default',
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  partner_case_link_id uuid NOT NULL REFERENCES aml.partner_case_links(id),
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  grant_id uuid REFERENCES aml.reliance_grants(id),
  attestation_id uuid REFERENCES aml.compliance_attestations(id),
  requested_record_codes text[] NOT NULL CHECK (array_length(requested_record_codes, 1) >= 1),
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) >= 10),
  scope_evaluation jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by_source text NOT NULL CHECK (requested_by_source IN
    ('finance_portal_users', 'builder_portal_users', 'solicitor_portal_users')),
  requested_by_id uuid NOT NULL,
  requested_by_label text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  due_at date,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN
    ('draft', 'submitted', 'under_review', 'approved', 'partly_approved',
     'denied', 'delivered', 'expired', 'cancelled')),
  approved_record_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  denied_record_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  origin_response_message text,
  reviewed_by uuid,
  reviewed_by_label text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_records_request_review_coherent CHECK (
    status IN ('draft', 'submitted', 'cancelled', 'expired')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_aml_partner_records_requests_link
  ON aml.partner_records_requests (partner_case_link_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_partner_records_requests_case_open
  ON aml.partner_records_requests (case_id)
  WHERE status IN ('submitted', 'under_review');

DROP TRIGGER IF EXISTS trg_aml_partner_records_requests_updated_at
  ON aml.partner_records_requests;
CREATE TRIGGER trg_aml_partner_records_requests_updated_at
  BEFORE UPDATE ON aml.partner_records_requests
  FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();

CREATE TABLE IF NOT EXISTS aml.partner_evidence_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES aml.partner_records_requests(id),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  partner_case_link_id uuid NOT NULL REFERENCES aml.partner_case_links(id),
  partner_org_id uuid NOT NULL REFERENCES aml.partner_organisations(id),
  record_code text NOT NULL,
  safe_label text NOT NULL,
  delivered_version integer NOT NULL DEFAULT 1,
  delivered_sha256 text,
  delivered_by uuid NOT NULL,
  delivered_by_label text,
  delivered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aml_partner_evidence_deliveries_link
  ON aml.partner_evidence_deliveries (partner_case_link_id, delivered_at DESC);

GRANT ALL ON aml.partner_records_requests, aml.partner_evidence_deliveries
  TO service_role;
ALTER TABLE aml.partner_records_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.partner_evidence_deliveries ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['partner_records_requests','partner_evidence_deliveries'] LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY "aml_%s_service_only" ON aml.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

INSERT INTO public.feature_flags (key, value, description)
VALUES
  ('aml_partner_compliance_workspace', 'false'::jsonb,
   'AML partner domain Phase 4: master switch for the session-authenticated partner compliance workspace operations on aml-reliance. Off = the operations answer 404 and nothing changes.'),
  ('aml_partner_workspace_finance', 'false'::jsonb,
   'AML partner domain Phase 5: mount the shared partner compliance workspace in the Finance Portal. Requires the master workspace flag.'),
  ('aml_partner_workspace_builder', 'false'::jsonb,
   'AML partner domain Phase 5: mount the shared partner compliance workspace in the Builder / Developer Portal surface. Requires the master workspace flag.'),
  ('aml_partner_workspace_developer', 'false'::jsonb,
   'AML partner domain Phase 5: reserved for a standalone Developer Portal. No such portal exists — developer-type organisations are served through the Builder surface under aml_partner_workspace_builder. This flag gates nothing until a Developer Portal foundation exists.'),
  ('aml_partner_workspace_solicitor', 'false'::jsonb,
   'AML partner domain Phase 5: mount the shared partner compliance workspace in the Solicitor/Conveyancer Portal. Requires the master workspace flag.')
ON CONFLICT (key) DO NOTHING;