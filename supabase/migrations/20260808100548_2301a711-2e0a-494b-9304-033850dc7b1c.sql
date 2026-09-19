ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'approved_for_issue';
ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'partner_review';
ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'changes_requested';
ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'withdrawn';

ALTER TYPE public.partner_invoice_process ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE public.partner_commission_basis ADD VALUE IF NOT EXISTS 'other';

ALTER TABLE public.partner_agreements
  ADD COLUMN IF NOT EXISTS agreement_owner_id UUID,
  ADD COLUMN IF NOT EXISTS agreement_owner_label TEXT,
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS issued_version_id UUID,
  ADD COLUMN IF NOT EXISTS first_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS executed_pdf_storage_path TEXT;

COMMENT ON COLUMN public.partner_agreements.agreement_owner_id IS
  'Command Centre user responsible for moving this agreement forward. Display + reassignment only; permissions stay with the agreements module.';
COMMENT ON COLUMN public.partner_agreements.issued_version_id IS
  'The partner_agreement_versions row currently in front of the partner. NULL until first issue; survives as the executed version after execution.';
COMMENT ON COLUMN public.partner_agreements.executed_pdf_storage_path IS
  'The fully executed master copy in the partner-agreements bucket. Written once by the execution path; never replaced.';

CREATE TABLE IF NOT EXISTS public.partner_agreement_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.partner_agreements(id) ON DELETE CASCADE,
  version_label TEXT NOT NULL,
  issue_sequence INTEGER NOT NULL,
  template_key TEXT NOT NULL,
  template_content_hash TEXT NOT NULL,
  document_revision INTEGER NOT NULL DEFAULT 1,
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  brand_snapshot JSONB,
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'superseded', 'executed', 'withdrawn')),
  issued_by UUID,
  issued_by_label TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pdf_storage_path TEXT,
  executed_pdf_storage_path TEXT,
  executed_pdf_bytes INTEGER,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, version_label),
  UNIQUE (agreement_id, issue_sequence)
);

GRANT ALL ON public.partner_agreement_versions TO service_role;
ALTER TABLE public.partner_agreement_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_agreement_versions_service_role_only" ON public.partner_agreement_versions;
CREATE POLICY "partner_agreement_versions_service_role_only"
  ON public.partner_agreement_versions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_versions_agreement
  ON public.partner_agreement_versions(agreement_id, issue_sequence DESC);

CREATE TABLE IF NOT EXISTS public.partner_agreement_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.partner_agreements(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'returned')),
  reviewer_id UUID,
  reviewer_label TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_agreement_reviews TO service_role;
ALTER TABLE public.partner_agreement_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_agreement_reviews_service_role_only" ON public.partner_agreement_reviews;
CREATE POLICY "partner_agreement_reviews_service_role_only"
  ON public.partner_agreement_reviews FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_reviews_agreement
  ON public.partner_agreement_reviews(agreement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.partner_agreement_change_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.partner_agreements(id) ON DELETE CASCADE,
  version_id UUID REFERENCES public.partner_agreement_versions(id) ON DELETE SET NULL,
  section_key TEXT NOT NULL
    CHECK (section_key IN ('commercial_schedule', 'agreement_details', 'execution_details', 'other')),
  comment TEXT NOT NULL,
  requested_by_portal_user_id UUID,
  requested_by_label TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'declined')),
  resolved_in_version_id UUID REFERENCES public.partner_agreement_versions(id) ON DELETE SET NULL,
  resolved_by UUID,
  resolved_by_label TEXT,
  resolution_note TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.partner_agreement_change_requests TO service_role;
ALTER TABLE public.partner_agreement_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_agreement_change_requests_service_role_only" ON public.partner_agreement_change_requests;
CREATE POLICY "partner_agreement_change_requests_service_role_only"
  ON public.partner_agreement_change_requests FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_change_requests_agreement
  ON public.partner_agreement_change_requests(agreement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_agreement_change_requests_open
  ON public.partner_agreement_change_requests(agreement_id)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.partner_agreement_signatures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.partner_agreements(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.partner_agreement_versions(id) ON DELETE CASCADE,
  party_role TEXT NOT NULL CHECK (party_role IN ('partner', 'principal')),
  legal_entity TEXT,
  signatory_name TEXT NOT NULL,
  signatory_title TEXT,
  signature_typed TEXT NOT NULL,
  signature_method TEXT NOT NULL DEFAULT 'typed_electronic',
  portal_user_id UUID,
  staff_user_id UUID,
  ip_hash TEXT,
  user_agent_hash TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (version_id, party_role)
);

GRANT ALL ON public.partner_agreement_signatures TO service_role;
ALTER TABLE public.partner_agreement_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "partner_agreement_signatures_service_role_only" ON public.partner_agreement_signatures;
CREATE POLICY "partner_agreement_signatures_service_role_only"
  ON public.partner_agreement_signatures FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_signatures_agreement
  ON public.partner_agreement_signatures(agreement_id, signed_at DESC);