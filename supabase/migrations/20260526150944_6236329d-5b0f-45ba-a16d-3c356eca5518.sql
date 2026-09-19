
-- Chunk 1: Shared Finance Deal Data Layer — gap-close migration.
-- Adds the cross-entity FKs the three-portal sync contract requires, plus
-- visibility flags on the activity log (also serves Chunk 15).

-- ============================================================
-- 1. finance_portal_documents: tie uploads to a specific deal/PF
-- ============================================================
ALTER TABLE public.finance_portal_documents
  ADD COLUMN IF NOT EXISTS purchase_file_id uuid
    REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_deal_id uuid
    REFERENCES public.client_deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_finance_portal_documents_purchase_file
  ON public.finance_portal_documents(purchase_file_id)
  WHERE purchase_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_portal_documents_client_deal
  ON public.finance_portal_documents(client_deal_id)
  WHERE client_deal_id IS NOT NULL;

-- ============================================================
-- 2. lender_submissions: tie to PF and to the finance partner
-- ============================================================
ALTER TABLE public.lender_submissions
  ADD COLUMN IF NOT EXISTS purchase_file_id uuid
    REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finance_user_id uuid
    REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_preferred_pathway boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lender_submissions_purchase_file
  ON public.lender_submissions(purchase_file_id)
  WHERE purchase_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lender_submissions_finance_user
  ON public.lender_submissions(finance_user_id)
  WHERE finance_user_id IS NOT NULL;

-- Only one preferred lender per purchase file at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_lender_submissions_preferred_per_pf
  ON public.lender_submissions(purchase_file_id)
  WHERE is_preferred_pathway = true AND purchase_file_id IS NOT NULL;

-- ============================================================
-- 3. purchase_file_valuations: link to the originating lender submission
-- ============================================================
ALTER TABLE public.purchase_file_valuations
  ADD COLUMN IF NOT EXISTS lender_submission_id uuid
    REFERENCES public.lender_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pf_valuations_lender_submission
  ON public.purchase_file_valuations(lender_submission_id)
  WHERE lender_submission_id IS NOT NULL;

-- ============================================================
-- 4. finance_portal_activity_log: add deal scope + tri-portal visibility flags
--    (also satisfies Chunk 15 unified activity log contract)
-- ============================================================
ALTER TABLE public.finance_portal_activity_log
  ADD COLUMN IF NOT EXISTS purchase_file_id uuid
    REFERENCES public.purchase_files(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS client_deal_id uuid
    REFERENCES public.client_deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visible_to_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visible_to_finance_partner boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS visible_to_command_centre boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_finance_activity_purchase_file
  ON public.finance_portal_activity_log(purchase_file_id, created_at DESC)
  WHERE purchase_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_activity_client_deal
  ON public.finance_portal_activity_log(client_deal_id, created_at DESC)
  WHERE client_deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_finance_activity_client_visible
  ON public.finance_portal_activity_log(client_id, created_at DESC)
  WHERE visible_to_client = true;

-- ============================================================
-- 5. finance_portal_client_assignments: allow optional per-deal scope
--    (per-client assignment remains the default; PF-level is an override)
-- ============================================================
ALTER TABLE public.finance_portal_client_assignments
  ADD COLUMN IF NOT EXISTS purchase_file_id uuid
    REFERENCES public.purchase_files(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fpa_purchase_file
  ON public.finance_portal_client_assignments(purchase_file_id)
  WHERE purchase_file_id IS NOT NULL;

-- ============================================================
-- 6. Backfill: where purchase_files.client_deal_id is set, mirror the
--    relationship onto existing lender_submissions / valuations / documents
--    that already share the same client_id, so historical rows participate
--    in the unified contract.
-- ============================================================
UPDATE public.lender_submissions ls
SET purchase_file_id = pf.id
FROM public.purchase_files pf
WHERE ls.purchase_file_id IS NULL
  AND ls.client_id = pf.client_id
  AND ls.deal_id IS NOT NULL
  AND ls.deal_id = pf.client_deal_id;

UPDATE public.purchase_file_valuations v
SET lender_submission_id = ls.id
FROM public.lender_submissions ls
WHERE v.lender_submission_id IS NULL
  AND ls.purchase_file_id = v.purchase_file_id
  AND ls.is_preferred_pathway = true;

-- (finance_portal_documents intentionally NOT backfilled — historical uploads
--  may be deal-agnostic; new uploads can opt in via the column.)
