ALTER TABLE public.generated_reports
  DROP CONSTRAINT IF EXISTS generated_reports_generated_by_fkey;

ALTER TABLE public.generated_reports
  ADD CONSTRAINT generated_reports_generated_by_custom_users_fkey
  FOREIGN KEY (generated_by)
  REFERENCES public.custom_users(id)
  ON DELETE SET NULL
  NOT VALID;

CREATE INDEX IF NOT EXISTS idx_generated_reports_generated_by
  ON public.generated_reports(generated_by);