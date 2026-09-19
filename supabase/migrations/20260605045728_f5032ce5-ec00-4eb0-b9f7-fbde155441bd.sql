-- Variant fork support for investment_reports
ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS report_variant text NOT NULL DEFAULT 'composite',
  ADD COLUMN IF NOT EXISTS derived_from_report_id uuid NULL REFERENCES public.investment_reports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_generated_at timestamptz NULL;

-- Constrain variant values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_reports_report_variant_check'
  ) THEN
    ALTER TABLE public.investment_reports
      ADD CONSTRAINT investment_reports_report_variant_check
      CHECK (report_variant IN ('composite', 'financial', 'due_diligence'));
  END IF;
END $$;

-- Backfill any pre-existing nulls (defensive, the default handles future rows)
UPDATE public.investment_reports SET report_variant = 'composite' WHERE report_variant IS NULL;

-- Index for fast parent → children lookup
CREATE INDEX IF NOT EXISTS investment_reports_derived_from_variant_idx
  ON public.investment_reports (derived_from_report_id, report_variant);