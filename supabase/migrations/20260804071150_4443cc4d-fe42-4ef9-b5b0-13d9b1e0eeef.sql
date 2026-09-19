CREATE TABLE IF NOT EXISTS public.market_intelligence_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.marketing_intelligence_reports(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  report_type text NOT NULL DEFAULT '',
  audience_segment text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'marketing-reports',
  storage_path text,
  bytes integer,
  page_count integer,
  persisted boolean NOT NULL DEFAULT false,
  layers_shown integer NOT NULL DEFAULT 0,
  layers_empty integer NOT NULL DEFAULT 0,
  sections_dropped integer NOT NULL DEFAULT 0,
  chars_omitted integer NOT NULL DEFAULT 0,
  sections_included text[] NOT NULL DEFAULT '{}',
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.market_intelligence_renders IS
  'One row per Market Intelligence render: what was produced, from which report, how many layers had content, what the caps did not carry, whether pdf_storage_path was set, and under which brand snapshot. Written by render-market-intelligence-pdf.';

CREATE INDEX IF NOT EXISTS market_intelligence_renders_report_idx
  ON public.market_intelligence_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_intelligence_renders_brand_idx
  ON public.market_intelligence_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS market_intelligence_renders_failed_idx
  ON public.market_intelligence_renders (created_at DESC)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS market_intelligence_renders_gaps_idx
  ON public.market_intelligence_renders (created_at DESC)
  WHERE layers_empty > 0;
CREATE INDEX IF NOT EXISTS market_intelligence_renders_persisted_idx
  ON public.market_intelligence_renders (report_id, created_at DESC)
  WHERE persisted;

ALTER TABLE public.market_intelligence_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY market_intelligence_renders_select
  ON public.market_intelligence_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.market_intelligence_renders FROM anon, authenticated;
GRANT SELECT ON public.market_intelligence_renders TO authenticated;
GRANT ALL ON public.market_intelligence_renders TO service_role;

CREATE TABLE IF NOT EXISTS public.investment_report_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.investment_reports(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'investment-reports',
  storage_path text,
  bytes integer,
  page_count integer,
  charts_drawn integer NOT NULL DEFAULT 0,
  charts_skipped integer NOT NULL DEFAULT 0,
  has_financials boolean NOT NULL DEFAULT false,
  has_score boolean NOT NULL DEFAULT false,
  chapters_dropped integer NOT NULL DEFAULT 0,
  chars_omitted integer NOT NULL DEFAULT 0,
  chapters_included text[] NOT NULL DEFAULT '{}',
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.investment_report_renders IS
  'One row per investment report render: what was produced, how many infographics were drawn against how many were skipped for want of data, whether the row carried a score and a financial model, and under which brand snapshot. Written by render-investment-report-pdf.';

CREATE INDEX IF NOT EXISTS investment_report_renders_report_idx
  ON public.investment_report_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investment_report_renders_brand_idx
  ON public.investment_report_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS investment_report_renders_failed_idx
  ON public.investment_report_renders (created_at DESC)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS investment_report_renders_skipped_idx
  ON public.investment_report_renders (created_at DESC)
  WHERE charts_skipped > 0;

ALTER TABLE public.investment_report_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY investment_report_renders_select
  ON public.investment_report_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.investment_report_renders FROM anon, authenticated;
GRANT SELECT ON public.investment_report_renders TO authenticated;
GRANT ALL ON public.investment_report_renders TO service_role;