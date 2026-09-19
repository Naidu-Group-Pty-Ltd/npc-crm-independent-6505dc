CREATE TABLE IF NOT EXISTS public.portfolio_review_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.portfolio_analysis_reports(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  review_id uuid REFERENCES public.portfolio_reviews(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  holdings integer,
  pages integer,
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portfolio_review_renders IS
  'One row per Portfolio Performance Review render: what was produced, from which analysis report and review, and under which brand snapshot. Written by render-portfolio-review-pdf. The document contents are not stored here — the two source rows are referenced instead.';

CREATE INDEX IF NOT EXISTS portfolio_review_renders_report_idx
  ON public.portfolio_review_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portfolio_review_renders_client_idx
  ON public.portfolio_review_renders (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS portfolio_review_renders_brand_idx
  ON public.portfolio_review_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS portfolio_review_renders_failed_idx
  ON public.portfolio_review_renders (created_at DESC)
  WHERE status = 'failed';

ALTER TABLE public.portfolio_review_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY portfolio_review_renders_select
  ON public.portfolio_review_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.portfolio_review_renders FROM anon, authenticated;
GRANT SELECT ON public.portfolio_review_renders TO authenticated;
GRANT ALL ON public.portfolio_review_renders TO service_role;