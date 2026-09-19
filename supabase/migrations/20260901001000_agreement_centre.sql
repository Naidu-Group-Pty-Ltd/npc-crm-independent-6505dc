-- ─────────────────────────────────────────────────────────────────────────────
-- Agreement Centre — the partner-agreement register becomes a lifecycle engine.
--
-- `partner_agreements` already carries the parties, the commercial schedule and
-- a coarse status. What it never had is the part between "draft" and "signed":
-- an internal approval, an issue INTO the Finance Partner Portal, a partner-side
-- review with structured change requests, a native execution flow, and a frozen
-- record of exactly what was issued each time. This migration adds that spine.
--
-- Three rules the shape below enforces rather than documents:
--   * An issued version is a ROW, not a mutation. `partner_agreement_versions`
--     freezes the field values, the template content hash and the brand
--     snapshot at the moment of issue; the working row keeps moving, the
--     version row never does. Reissuing after a change request writes a new
--     version row — nothing externally visible is ever silently overwritten.
--   * Execution is a signature row per party per version, unique on
--     (version_id, party_role). "Fully executed" is derived from signatures
--     present, not asserted by a status flip alone.
--   * Everything here is service-role only, like every other partner_agreement_*
--     table: the browser reaches these rows through edge functions that resolve
--     a Command Centre session or a finance-portal session, never directly.
--
-- ALTER TYPE ... ADD VALUE is safe inside this transaction on the Postgres
-- versions Supabase runs, PROVIDED the new value is not used again inside the
-- same transaction — so this migration only declares values and never
-- references them in DDL or DML.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Lifecycle statuses the register was missing ──────────────────────────────
ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'approved_for_issue';
ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'partner_review';
ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'changes_requested';
ALTER TYPE public.partner_agreement_status ADD VALUE IF NOT EXISTS 'withdrawn';

-- The supplied templates offer "Other" on both of these; the enums predate them.
ALTER TYPE public.partner_invoice_process ADD VALUE IF NOT EXISTS 'other';
ALTER TYPE public.partner_commission_basis ADD VALUE IF NOT EXISTS 'other';

-- ── Working-row lifecycle columns ────────────────────────────────────────────
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

-- ── Frozen issued versions ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_agreement_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.partner_agreements(id) ON DELETE CASCADE,

  -- "1.0", "1.1" … within the working row's major `version`. Ordering key is
  -- issue_sequence; the label is what people read.
  version_label TEXT NOT NULL,
  issue_sequence INTEGER NOT NULL,

  -- Which locked template produced this document, and the hash of that locked
  -- content at issue time. The content lives in code
  -- (supabase/functions/_shared/agreements/); the hash is what lets an audit
  -- say "the wording the partner saw is the wording this build carries".
  template_key TEXT NOT NULL,
  template_content_hash TEXT NOT NULL,
  document_revision INTEGER NOT NULL DEFAULT 1,

  -- Everything dynamic about the document, frozen: the bound field values and
  -- the tenant brand snapshot the render used. A version row plus the locked
  -- template reproduces the issued document byte-for-byte in meaning.
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  brand_snapshot JSONB,
  -- [{ field, label, previous, updated }] against the previously issued
  -- version. UI metadata only — the legal wording around a field never changes.
  changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,

  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'superseded', 'executed', 'withdrawn')),

  issued_by UUID,
  issued_by_label TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The as-issued rendering (unsigned) and, on the final version only, the
  -- executed master. Written once each; a re-render is a new object, never a
  -- replacement.
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
CREATE POLICY "partner_agreement_versions_service_role_only"
  ON public.partner_agreement_versions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_versions_agreement
  ON public.partner_agreement_versions(agreement_id, issue_sequence DESC);

-- ── Internal review decisions ────────────────────────────────────────────────
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
CREATE POLICY "partner_agreement_reviews_service_role_only"
  ON public.partner_agreement_reviews FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_reviews_agreement
  ON public.partner_agreement_reviews(agreement_id, created_at DESC);

-- ── Structured partner change requests ───────────────────────────────────────
-- The partner never edits the document. They name a section, say what they
-- need, and the Command Centre answers with a revision. The original issued
-- version row is untouched throughout.
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
CREATE POLICY "partner_agreement_change_requests_service_role_only"
  ON public.partner_agreement_change_requests FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_change_requests_agreement
  ON public.partner_agreement_change_requests(agreement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_agreement_change_requests_open
  ON public.partner_agreement_change_requests(agreement_id)
  WHERE status = 'open';

-- ── Execution signatures ─────────────────────────────────────────────────────
-- One row per party per issued version. The unique constraint is the guard
-- against a double-sign; "partially executed" and "fully executed" are read off
-- which of the two roles have rows for the version in front of the partner.
CREATE TABLE IF NOT EXISTS public.partner_agreement_signatures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.partner_agreements(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.partner_agreement_versions(id) ON DELETE CASCADE,
  party_role TEXT NOT NULL CHECK (party_role IN ('partner', 'principal')),
  legal_entity TEXT,
  signatory_name TEXT NOT NULL,
  signatory_title TEXT,
  -- The typed signature exactly as entered. Typed electronic execution, the
  -- same mechanism partner_consent_requests already uses; a dedicated
  -- e-signature provider slots in later as a new signature_method without a
  -- schema change.
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
CREATE POLICY "partner_agreement_signatures_service_role_only"
  ON public.partner_agreement_signatures FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_partner_agreement_signatures_agreement
  ON public.partner_agreement_signatures(agreement_id, signed_at DESC);
