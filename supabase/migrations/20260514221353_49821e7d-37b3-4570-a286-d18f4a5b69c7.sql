
ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS bulk_job_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_investment_reports_bulk_job_id
  ON public.investment_reports (bulk_job_id)
  WHERE bulk_job_id IS NOT NULL;

-- Backfill from existing bulk_generation_items rows
UPDATE public.investment_reports r
SET bulk_job_id = i.job_id
FROM public.bulk_generation_items i
WHERE i.report_id = r.id
  AND r.bulk_job_id IS NULL;
