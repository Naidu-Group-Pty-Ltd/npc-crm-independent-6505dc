
CREATE TABLE IF NOT EXISTS aml.consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('client', 'staff')),
  actor_id uuid,
  actor_label text,
  ip_address text,
  user_agent text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON aml.consents TO service_role;
ALTER TABLE aml.consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_consents_service_only" ON aml.consents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_aml_consents_case ON aml.consents(case_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS aml.questionnaire_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  section text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at timestamptz,
  submitted_by_type text CHECK (submitted_by_type IN ('client','staff')),
  submitted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, section)
);
GRANT ALL ON aml.questionnaire_responses TO service_role;
ALTER TABLE aml.questionnaire_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_qr_service_only" ON aml.questionnaire_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS aml.submission_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','changes_requested','accepted','rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  submitted_by_type text NOT NULL CHECK (submitted_by_type IN ('client','staff')),
  submitted_by uuid,
  reviewer_id uuid,
  reviewer_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version_number)
);
GRANT ALL ON aml.submission_versions TO service_role;
ALTER TABLE aml.submission_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_sv_service_only" ON aml.submission_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_aml_sv_case ON aml.submission_versions(case_id, version_number DESC);

CREATE TABLE IF NOT EXISTS aml.document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  description text,
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','accepted','rejected','waived')),
  due_at timestamptz,
  assigned_to_party text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_type text NOT NULL DEFAULT 'system' CHECK (created_by_type IN ('client','staff','system')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON aml.document_requirements TO service_role;
ALTER TABLE aml.document_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_dr_service_only" ON aml.document_requirements FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_aml_dr_case ON aml.document_requirements(case_id, status);

CREATE TABLE IF NOT EXISTS aml.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  requirement_id uuid REFERENCES aml.document_requirements(id) ON DELETE SET NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  checksum text,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','accepted','rejected','superseded','deleted')),
  rejection_reason text,
  uploaded_by_type text NOT NULL CHECK (uploaded_by_type IN ('client','staff')),
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON aml.documents TO service_role;
ALTER TABLE aml.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_docs_service_only" ON aml.documents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_aml_docs_case ON aml.documents(case_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_docs_req ON aml.documents(requirement_id);

CREATE TABLE IF NOT EXISTS aml.document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES aml.documents(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text,
  size_bytes bigint,
  checksum text,
  uploaded_by_type text NOT NULL CHECK (uploaded_by_type IN ('client','staff')),
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);
GRANT ALL ON aml.document_versions TO service_role;
ALTER TABLE aml.document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_dv_service_only" ON aml.document_versions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS aml.client_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('additional_info','new_document','clarification','re_consent')),
  subject text NOT NULL,
  message text NOT NULL,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','responded','resolved','cancelled')),
  requested_by uuid,
  requested_by_label text,
  responded_at timestamptz,
  responded_by uuid,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON aml.client_requests TO service_role;
ALTER TABLE aml.client_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_cr_service_only" ON aml.client_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_aml_cr_case ON aml.client_requests(case_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION aml.touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['questionnaire_responses','document_requirements','documents','client_requests'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON aml.%1$s;', t);
    EXECUTE format('CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON aml.%1$s FOR EACH ROW EXECUTE FUNCTION aml.touch_updated_at();', t);
  END LOOP;
END$$;

DO $$
BEGIN
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE aml.document_requirements'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE aml.documents'; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE aml.client_requests'; EXCEPTION WHEN duplicate_object THEN NULL; END;
END$$;
