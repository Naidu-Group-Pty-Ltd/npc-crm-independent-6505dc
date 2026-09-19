-- ─────────────── ENUMS ───────────────
DO $$ BEGIN
  CREATE TYPE public.legal_document_category AS ENUM (
    'contract','title','plan','disclosure_statement','strata_report','building_pest',
    'identity_voi','transfer','stamp_duty','settlement_statement','discharge',
    'trust_receipt','correspondence','search_result','requisition','authority','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_document_status AS ENUM (
    'requested','uploaded','under_review','accepted','rejected','superseded','not_required'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_document_owner AS ENUM (
    'client','solicitor','npc','other_side','lender','builder','agent','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_search_type AS ENUM (
    'title_search','plan_search','council_certificate','water_certificate','land_tax_clearance',
    'strata_inspection','owners_corp','planning_certificate','sewer_diagram','company_search',
    'bankruptcy_search','asic_search','pexa_verification','rates_certificate','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_search_status AS ENUM (
    'not_ordered','ordered','received','reviewed','issue','not_required'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_requisition_direction AS ENUM ('sent','received');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_requisition_status AS ENUM (
    'draft','sent','received','answered','satisfied','disputed','withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_disbursement_status AS ENUM (
    'estimated','incurred','invoiced','paid','waived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────── DOCUMENTS ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  client_id uuid,
  firm_id uuid REFERENCES public.solicitor_firms(id) ON DELETE SET NULL,
  category public.legal_document_category NOT NULL DEFAULT 'other',
  label text NOT NULL,
  description text,
  status public.legal_document_status NOT NULL DEFAULT 'requested',
  owner public.legal_document_owner NOT NULL DEFAULT 'solicitor',
  due_date date,
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  version integer NOT NULL DEFAULT 1,
  supersedes_document_id uuid REFERENCES public.legal_matter_documents(id) ON DELETE SET NULL,
  visible_to_client boolean NOT NULL DEFAULT false,
  visible_to_npc boolean NOT NULL DEFAULT true,
  requested_at timestamptz,
  uploaded_at timestamptz,
  uploaded_by_type text,
  uploaded_by_solicitor_user_id uuid REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewed_by_solicitor_user_id uuid REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
  review_notes text,
  source text NOT NULL DEFAULT 'manual',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_documents_matter
  ON public.legal_matter_documents(legal_matter_id, category);
CREATE INDEX IF NOT EXISTS idx_legal_matter_documents_status
  ON public.legal_matter_documents(status, due_date);

GRANT ALL ON public.legal_matter_documents TO service_role;
ALTER TABLE public.legal_matter_documents ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "legal_matter_documents_service_role_only"
    ON public.legal_matter_documents FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_legal_matter_documents_updated_at ON public.legal_matter_documents;
CREATE TRIGGER trg_legal_matter_documents_updated_at
  BEFORE UPDATE ON public.legal_matter_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────── SEARCHES ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  search_type public.legal_search_type NOT NULL DEFAULT 'other',
  label text NOT NULL,
  provider text,
  reference text,
  status public.legal_search_status NOT NULL DEFAULT 'not_ordered',
  ordered_at date,
  received_at date,
  due_date date,
  cost_amount numeric(12,2),
  issue_flag boolean NOT NULL DEFAULT false,
  result_summary text,
  notes text,
  document_id uuid REFERENCES public.legal_matter_documents(id) ON DELETE SET NULL,
  visible_to_client boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_searches_matter
  ON public.legal_matter_searches(legal_matter_id, status);

GRANT ALL ON public.legal_matter_searches TO service_role;
ALTER TABLE public.legal_matter_searches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "legal_matter_searches_service_role_only"
    ON public.legal_matter_searches FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_legal_matter_searches_updated_at ON public.legal_matter_searches;
CREATE TRIGGER trg_legal_matter_searches_updated_at
  BEFORE UPDATE ON public.legal_matter_searches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────── REQUISITIONS ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  direction public.legal_requisition_direction NOT NULL DEFAULT 'sent',
  reference text,
  subject text NOT NULL,
  detail text,
  response text,
  status public.legal_requisition_status NOT NULL DEFAULT 'draft',
  raised_on date,
  response_due date,
  answered_at timestamptz,
  is_blocking boolean NOT NULL DEFAULT false,
  visible_to_client boolean NOT NULL DEFAULT false,
  document_id uuid REFERENCES public.legal_matter_documents(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_requisitions_matter
  ON public.legal_matter_requisitions(legal_matter_id, status);

GRANT ALL ON public.legal_matter_requisitions TO service_role;
ALTER TABLE public.legal_matter_requisitions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "legal_matter_requisitions_service_role_only"
    ON public.legal_matter_requisitions FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_legal_matter_requisitions_updated_at ON public.legal_matter_requisitions;
CREATE TRIGGER trg_legal_matter_requisitions_updated_at
  BEFORE UPDATE ON public.legal_matter_requisitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────── DISBURSEMENTS ───────────────
CREATE TABLE IF NOT EXISTS public.legal_matter_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_matter_id uuid NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  label text NOT NULL,
  category text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  payable_to text,
  status public.legal_disbursement_status NOT NULL DEFAULT 'estimated',
  incurred_on date,
  paid_on date,
  invoice_reference text,
  include_in_settlement boolean NOT NULL DEFAULT true,
  visible_to_client boolean NOT NULL DEFAULT false,
  search_id uuid REFERENCES public.legal_matter_searches(id) ON DELETE SET NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_matter_disbursements_matter
  ON public.legal_matter_disbursements(legal_matter_id, status);

GRANT ALL ON public.legal_matter_disbursements TO service_role;
ALTER TABLE public.legal_matter_disbursements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "legal_matter_disbursements_service_role_only"
    ON public.legal_matter_disbursements FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP TRIGGER IF EXISTS trg_legal_matter_disbursements_updated_at ON public.legal_matter_disbursements;
CREATE TRIGGER trg_legal_matter_disbursements_updated_at
  BEFORE UPDATE ON public.legal_matter_disbursements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────── REALTIME ───────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_documents;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_searches;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_requisitions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_disbursements;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;