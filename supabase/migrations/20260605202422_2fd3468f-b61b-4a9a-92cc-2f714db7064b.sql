ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'jspdf',
  ADD COLUMN IF NOT EXISTS custom_css text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_templates_engine_check'
  ) THEN
    ALTER TABLE public.report_templates
      ADD CONSTRAINT report_templates_engine_check
      CHECK (engine IN ('jspdf', 'weasyprint'));
  END IF;
END $$;