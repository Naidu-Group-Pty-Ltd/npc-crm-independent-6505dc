-- Persist the stage displayed by the project-level Builder Invoice Log row.
-- Stage payment rows remain the source of truth for all historical financial data.
ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS builder_invoice_current_payment_id uuid
  REFERENCES public.build_progress_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_deals_builder_invoice_current_payment
  ON public.client_deals (builder_invoice_current_payment_id)
  WHERE builder_invoice_current_payment_id IS NOT NULL;

COMMENT ON COLUMN public.client_deals.builder_invoice_current_payment_id IS
  'Selected build progress payment shown in the consolidated Builder Invoice Log project row.';
