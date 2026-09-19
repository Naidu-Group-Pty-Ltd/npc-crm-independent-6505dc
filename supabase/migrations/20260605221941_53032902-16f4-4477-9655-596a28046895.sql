ALTER TABLE public.report_template_versions
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

CREATE INDEX IF NOT EXISTS idx_report_template_versions_label
  ON public.report_template_versions(template_id, label)
  WHERE label IS NOT NULL;