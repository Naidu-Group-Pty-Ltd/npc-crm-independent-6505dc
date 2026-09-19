ALTER TABLE public.template_library_entries
  ADD COLUMN IF NOT EXISTS design_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.template_library_entries.design_meta IS
  'Design-system metadata for catalogue families: familyKey, templateCode, variantAxis, density, ground, recommendedUse, the resolved manifest, and the curated colourway ids. Empty for entries that are not part of a design family. Never used for routing or authorisation.';

CREATE INDEX IF NOT EXISTS template_library_entries_design_family_idx
  ON public.template_library_entries ((design_meta ->> 'familyKey'))
  WHERE design_meta ? 'familyKey';

ALTER TABLE public.client_deals
  ADD COLUMN IF NOT EXISTS builder_invoice_current_payment_id uuid
  REFERENCES public.build_progress_payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_client_deals_builder_invoice_current_payment
  ON public.client_deals (builder_invoice_current_payment_id)
  WHERE builder_invoice_current_payment_id IS NOT NULL;

COMMENT ON COLUMN public.client_deals.builder_invoice_current_payment_id IS
  'Selected build progress payment shown in the consolidated Builder Invoice Log project row.';