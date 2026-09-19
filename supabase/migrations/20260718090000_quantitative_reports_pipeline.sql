ALTER TABLE public.generated_reports
  ADD COLUMN IF NOT EXISTS report_type text DEFAULT 'quantitative',
  ADD COLUMN IF NOT EXISTS generation_source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS workspace_id text DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS version integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source_record_count integer,
  ADD COLUMN IF NOT EXISTS source_snapshot jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pdf_bucket text,
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS file_name text,
  ADD COLUMN IF NOT EXISTS file_size integer,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_details text;

ALTER TABLE public.charts
  ADD COLUMN IF NOT EXISTS chart_key text,
  ADD COLUMN IF NOT EXISTS dataset jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS analysis_text text,
  ADD COLUMN IF NOT EXISTS summary_text text,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_date date,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS generated_reports_quant_weekly_unique
  ON public.generated_reports (workspace_id, report_type, period_start, period_end, version)
  WHERE generation_source = 'scheduled' AND status = 'completed';
CREATE UNIQUE INDEX IF NOT EXISTS charts_report_chart_key_unique ON public.charts (report_id, chart_key) WHERE chart_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_generated_reports_quant_completed ON public.generated_reports (report_type, status, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_charts_report_sort ON public.charts (report_id, sort_order, created_at);

INSERT INTO storage.buckets (id, name, public)
VALUES ('quantitative-reports', 'quantitative-reports', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DO $$ BEGIN
  PERFORM cron.unschedule('weekly-quantitative-report-generation');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'weekly-quantitative-report-generation',
  '15 8 * * 1',
  $$SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/quantitative-report-pipeline',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := jsonb_build_object('operation','weekly','source','scheduled','workspace_id','default')) AS request_id;$$
);
