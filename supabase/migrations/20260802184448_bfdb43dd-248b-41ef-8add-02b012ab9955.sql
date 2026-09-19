CREATE TABLE IF NOT EXISTS public.cash_flow_comparison_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_report_id uuid NOT NULL REFERENCES public.investment_reports(id) ON DELETE CASCADE,
  compared_report_ids uuid[] NOT NULL DEFAULT '{}',
  property_count integer,
  investor_profile text,
  has_ai_analysis boolean NOT NULL DEFAULT false,
  ai_sections_missing text[] NOT NULL DEFAULT '{}',
  term_years integer,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cash_flow_comparison_renders IS
  'One row per Cash Flow Comparison Analysis render: what was produced, which investment reports it compared, whether it carried a written analysis, and under which brand snapshot. Written by render-cash-flow-comparison-pdf.';

CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_primary_idx
  ON public.cash_flow_comparison_renders (primary_report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_brand_idx
  ON public.cash_flow_comparison_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_failed_idx
  ON public.cash_flow_comparison_renders (created_at DESC)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_analysis_idx
  ON public.cash_flow_comparison_renders (has_ai_analysis, created_at DESC);

ALTER TABLE public.cash_flow_comparison_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_flow_comparison_renders_select
  ON public.cash_flow_comparison_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.cash_flow_comparison_renders FROM anon, authenticated;
GRANT SELECT ON public.cash_flow_comparison_renders TO authenticated;
GRANT ALL ON public.cash_flow_comparison_renders TO service_role;