CREATE TABLE IF NOT EXISTS public.cash_flow_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.investment_reports(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  term_years integer,
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cash_flow_renders IS
  'One row per 10 Year Cash Flow Analysis render: what was produced, from which investment report, and under which brand snapshot. Written by render-cash-flow-pdf.';

CREATE INDEX IF NOT EXISTS cash_flow_renders_report_idx
  ON public.cash_flow_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_flow_renders_brand_idx
  ON public.cash_flow_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cash_flow_renders_failed_idx
  ON public.cash_flow_renders (created_at DESC)
  WHERE status = 'failed';

ALTER TABLE public.cash_flow_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_flow_renders_select
  ON public.cash_flow_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.cash_flow_renders FROM anon, authenticated;
GRANT SELECT ON public.cash_flow_renders TO authenticated;
GRANT ALL ON public.cash_flow_renders TO service_role;