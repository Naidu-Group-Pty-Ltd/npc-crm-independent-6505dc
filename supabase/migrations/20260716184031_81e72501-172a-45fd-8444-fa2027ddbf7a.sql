
-- Enums
DO $$ BEGIN
  CREATE TYPE aml.finance_source AS ENUM ('finance_portal','client_portal','manual_entry','ingested_doc');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aml.discrepancy_severity AS ENUM ('info','low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aml.discrepancy_status AS ENUM ('open','under_review','resolved','waived','escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Finance comparisons: point-in-time snapshot for a case
CREATE TABLE IF NOT EXISTS aml.finance_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  purchase_file_id uuid,
  source aml.finance_source NOT NULL DEFAULT 'finance_portal',
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by uuid,
  purchase_price numeric(14,2),
  loan_amount numeric(14,2),
  lender text,
  lvr numeric(6,3),
  borrower_contribution numeric(14,2),
  refi_equity numeric(14,2),
  gift_amount numeric(14,2),
  gift_source text,
  smsf_lrba boolean NOT NULL DEFAULT false,
  smsf_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  loan_purpose text,
  funding_notes text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_comparisons_case_idx ON aml.finance_comparisons(case_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS finance_comparisons_pf_idx ON aml.finance_comparisons(purchase_file_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON aml.finance_comparisons TO authenticated;
GRANT ALL ON aml.finance_comparisons TO service_role;

ALTER TABLE aml.finance_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml finance comparisons read" ON aml.finance_comparisons FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml finance comparisons write" ON aml.finance_comparisons FOR ALL TO authenticated
  USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- Discrepancies
CREATE TABLE IF NOT EXISTS aml.finance_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  comparison_id uuid REFERENCES aml.finance_comparisons(id) ON DELETE SET NULL,
  kind text NOT NULL,
  severity aml.discrepancy_severity NOT NULL DEFAULT 'medium',
  status aml.discrepancy_status NOT NULL DEFAULT 'open',
  detected_by text NOT NULL DEFAULT 'system',
  expected_value jsonb,
  observed_value jsonb,
  summary text NOT NULL,
  detail text,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS finance_discrepancies_case_idx ON aml.finance_discrepancies(case_id, status, severity);
CREATE INDEX IF NOT EXISTS finance_discrepancies_status_idx ON aml.finance_discrepancies(status, severity);

GRANT SELECT, INSERT, UPDATE, DELETE ON aml.finance_discrepancies TO authenticated;
GRANT ALL ON aml.finance_discrepancies TO service_role;

ALTER TABLE aml.finance_discrepancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml finance discrepancies read" ON aml.finance_discrepancies FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml finance discrepancies write" ON aml.finance_discrepancies FOR ALL TO authenticated
  USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- Evidence references: pointers back to finance-portal artefacts
CREATE TABLE IF NOT EXISTS aml.evidence_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  comparison_id uuid REFERENCES aml.finance_comparisons(id) ON DELETE SET NULL,
  reference_type text NOT NULL, -- e.g. 'finance_document','finance_decision','valuation','manual_note'
  reference_id uuid,
  external_url text,
  label text NOT NULL,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidence_references_case_idx ON aml.evidence_references(case_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON aml.evidence_references TO authenticated;
GRANT ALL ON aml.evidence_references TO service_role;

ALTER TABLE aml.evidence_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml evidence refs read" ON aml.evidence_references FOR SELECT TO authenticated
  USING (public.has_any_aml_role(auth.uid()));
CREATE POLICY "aml evidence refs write" ON aml.evidence_references FOR ALL TO authenticated
  USING (public.has_aml_write_role(auth.uid())) WITH CHECK (public.has_aml_write_role(auth.uid()));

-- updated_at triggers
CREATE OR REPLACE FUNCTION aml.tg_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS finance_comparisons_touch ON aml.finance_comparisons;
CREATE TRIGGER finance_comparisons_touch BEFORE UPDATE ON aml.finance_comparisons
  FOR EACH ROW EXECUTE FUNCTION aml.tg_touch_updated_at();

DROP TRIGGER IF EXISTS finance_discrepancies_touch ON aml.finance_discrepancies;
CREATE TRIGGER finance_discrepancies_touch BEFORE UPDATE ON aml.finance_discrepancies
  FOR EACH ROW EXECUTE FUNCTION aml.tg_touch_updated_at();
