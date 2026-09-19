
-- Chunk 4 — extend finance-status enum to the 18 spec states.
ALTER TYPE public.purchase_finance_status ADD VALUE IF NOT EXISTS 'pre_approval_in_progress' AFTER 'in_review';
ALTER TYPE public.purchase_finance_status ADD VALUE IF NOT EXISTS 'green_light_given'        AFTER 'purchase_specific_review';
ALTER TYPE public.purchase_finance_status ADD VALUE IF NOT EXISTS 'proceed_with_caution'     AFTER 'green_light_given';
ALTER TYPE public.purchase_finance_status ADD VALUE IF NOT EXISTS 'loan_docs_issued'         AFTER 'unconditional_approval';

-- Chunk 5 — extend decision-outcome enum.
ALTER TYPE public.finance_decision_outcome ADD VALUE IF NOT EXISTS 'subject_to_lmi_approval' AFTER 'subject_to_deposit';

-- Chunk 5 — extend green-light decisions table with spec fields.
ALTER TABLE public.purchase_file_finance_decisions
  ADD COLUMN IF NOT EXISTS decision_expiry_date      date,
  ADD COLUMN IF NOT EXISTS max_comfortable_price     numeric,
  ADD COLUMN IF NOT EXISTS estimated_borrowing_cap   numeric,
  ADD COLUMN IF NOT EXISTS proposed_loan_amount      numeric,
  ADD COLUMN IF NOT EXISTS deposit_required          numeric,
  ADD COLUMN IF NOT EXISTS shortfall_required        numeric,
  ADD COLUMN IF NOT EXISTS lvr                       numeric,
  ADD COLUMN IF NOT EXISTS lmi_applicable            boolean,
  ADD COLUMN IF NOT EXISTS lmi_amount                numeric,
  ADD COLUMN IF NOT EXISTS preferred_lender_pathway  text,
  ADD COLUMN IF NOT EXISTS broker_notes              text,
  ADD COLUMN IF NOT EXISTS supporting_document_id    uuid
    REFERENCES public.finance_portal_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pf_decisions_expiry
  ON public.purchase_file_finance_decisions(decision_expiry_date)
  WHERE decision_expiry_date IS NOT NULL;
