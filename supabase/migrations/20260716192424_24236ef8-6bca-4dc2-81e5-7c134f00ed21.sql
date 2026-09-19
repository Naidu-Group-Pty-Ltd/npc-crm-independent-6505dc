
-- Phase 10 — AUSTRAC Reporting & Submissions Hub

CREATE TABLE IF NOT EXISTS aml.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('smr','ttr','ifti','compliance','annual')),
  case_id UUID NULL REFERENCES aml.cases(id) ON DELETE SET NULL,
  reference_code TEXT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','in_review','awaiting_mlro','approved','submitted','acknowledged','rejected','withdrawn')),
  narrative TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reporting_period_start TIMESTAMPTZ NULL,
  reporting_period_end TIMESTAMPTZ NULL,
  drafted_by UUID NULL,
  mlro_signed_by UUID NULL,
  mlro_signed_at TIMESTAMPTZ NULL,
  submitted_at TIMESTAMPTZ NULL,
  submitted_by UUID NULL,
  acknowledged_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON aml.reports TO authenticated;
GRANT ALL ON aml.reports TO service_role;
ALTER TABLE aml.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_reports_role_read" ON aml.reports
  FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_reports_service_write" ON aml.reports
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS aml_reports_status_idx ON aml.reports(status);
CREATE INDEX IF NOT EXISTS aml_reports_kind_idx ON aml.reports(kind);
CREATE INDEX IF NOT EXISTS aml_reports_case_idx ON aml.reports(case_id);

CREATE TABLE IF NOT EXISTS aml.report_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES aml.reports(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  narrative TEXT NULL,
  author_id UUID NULL,
  author_label TEXT NULL,
  change_note TEXT NULL,
  content_hash TEXT NULL,
  prev_hash TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, version)
);
GRANT SELECT, INSERT ON aml.report_versions TO authenticated;
GRANT ALL ON aml.report_versions TO service_role;
ALTER TABLE aml.report_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_report_versions_role_read" ON aml.report_versions
  FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_report_versions_service_write" ON aml.report_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS aml_report_versions_report_idx ON aml.report_versions(report_id, version DESC);

CREATE TABLE IF NOT EXISTS aml.report_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES aml.reports(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('austrac_online','manual_upload','api','email','other')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','acknowledged','rejected','failed')),
  external_reference TEXT NULL,
  submitted_by UUID NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  export_bundle_path TEXT NULL,
  content_hash TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON aml.report_submissions TO authenticated;
GRANT ALL ON aml.report_submissions TO service_role;
ALTER TABLE aml.report_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_report_submissions_role_read" ON aml.report_submissions
  FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_report_submissions_service_write" ON aml.report_submissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS aml_report_submissions_report_idx ON aml.report_submissions(report_id);

CREATE TABLE IF NOT EXISTS aml.report_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES aml.report_submissions(id) ON DELETE CASCADE,
  receipt_reference TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'acknowledged'
    CHECK (status IN ('acknowledged','queried','rejected','withdrawn','other')),
  receipt_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  captured_by UUID NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON aml.report_receipts TO authenticated;
GRANT ALL ON aml.report_receipts TO service_role;
ALTER TABLE aml.report_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_report_receipts_role_read" ON aml.report_receipts
  FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml_report_receipts_service_write" ON aml.report_receipts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS aml_report_receipts_submission_idx ON aml.report_receipts(submission_id);

-- updated_at triggers (reuse existing helper if present)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'aml_touch_updated_at') THEN
    CREATE FUNCTION aml.aml_touch_updated_at() RETURNS TRIGGER AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $f$ LANGUAGE plpgsql SET search_path = public, aml;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_aml_reports_touch ON aml.reports;
CREATE TRIGGER trg_aml_reports_touch BEFORE UPDATE ON aml.reports
  FOR EACH ROW EXECUTE FUNCTION aml.aml_touch_updated_at();

DROP TRIGGER IF EXISTS trg_aml_report_submissions_touch ON aml.report_submissions;
CREATE TRIGGER trg_aml_report_submissions_touch BEFORE UPDATE ON aml.report_submissions
  FOR EACH ROW EXECUTE FUNCTION aml.aml_touch_updated_at();
