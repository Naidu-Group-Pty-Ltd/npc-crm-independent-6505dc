CREATE TABLE IF NOT EXISTS public.client_details_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  property_count integer NOT NULL DEFAULT 0,
  sections_included text[] NOT NULL DEFAULT '{}',
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_details_renders IS
  'One row per Client Details render: what was produced, about which client, how much of that client''s record had content, and under which brand snapshot. Written by render-client-details-pdf.';

CREATE INDEX IF NOT EXISTS client_details_renders_client_idx
  ON public.client_details_renders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_details_renders_brand_idx
  ON public.client_details_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_details_renders_failed_idx
  ON public.client_details_renders (created_at DESC)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS client_details_renders_portfolio_idx
  ON public.client_details_renders (property_count, created_at DESC);

ALTER TABLE public.client_details_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_details_renders_select
  ON public.client_details_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.client_details_renders FROM anon, authenticated;
GRANT SELECT ON public.client_details_renders TO authenticated;
GRANT ALL ON public.client_details_renders TO service_role;