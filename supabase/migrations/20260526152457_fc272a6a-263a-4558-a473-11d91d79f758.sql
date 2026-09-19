-- Chunk 12: Deal-type adaptive finance layers
-- Adds a JSONB `deal_type_fields` column on purchase_files for deal-type-specific structured data,
-- plus a small set of dedicated columns that are commonly queried/displayed across deal types.

ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS deal_type_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- H&L / Construction commonly-surfaced fields
ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS land_price numeric,
  ADD COLUMN IF NOT EXISTS build_price numeric,
  ADD COLUMN IF NOT EXISTS land_settlement_date date,
  ADD COLUMN IF NOT EXISTS construction_start_date date,
  ADD COLUMN IF NOT EXISTS construction_completion_estimate date,
  ADD COLUMN IF NOT EXISTS construction_stage text;

-- Commercial / Industrial commonly-surfaced fields
ALTER TABLE public.purchase_files
  ADD COLUMN IF NOT EXISTS commercial_loan_type text,
  ADD COLUMN IF NOT EXISTS gst_treatment text,
  ADD COLUMN IF NOT EXISTS lease_in_place boolean,
  ADD COLUMN IF NOT EXISTS lease_term_months integer,
  ADD COLUMN IF NOT EXISTS net_rental_yield numeric;

-- Index to support filtering by construction stage
CREATE INDEX IF NOT EXISTS idx_purchase_files_construction_stage
  ON public.purchase_files (construction_stage)
  WHERE construction_stage IS NOT NULL;
