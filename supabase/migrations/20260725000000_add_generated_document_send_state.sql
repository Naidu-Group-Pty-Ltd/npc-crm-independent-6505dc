-- Persist the integrity and idempotency state used by send_freeform.
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS pdf_hash text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
