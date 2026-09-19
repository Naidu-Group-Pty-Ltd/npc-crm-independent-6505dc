ALTER TABLE public.agency_agreements
  ADD COLUMN IF NOT EXISTS signing_layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signing_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signing_prepared_at TIMESTAMPTZ;

ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS signing_layout JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signing_recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS signing_prepared_at TIMESTAMPTZ;