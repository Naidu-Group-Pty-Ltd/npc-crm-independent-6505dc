CREATE TABLE IF NOT EXISTS public.property_comparison_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id uuid NOT NULL REFERENCES public.property_comparisons(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  property_count integer,
  pages integer,
  source_shape text CHECK (source_shape IN ('columns', 'salvaged')),
  recovered_sections text[] NOT NULL DEFAULT '{}',
  missing_sections text[] NOT NULL DEFAULT '{}',
  score_scale integer CHECK (score_scale IS NULL OR score_scale IN (10, 100)),
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.property_comparison_renders IS
  'One row per Property Comparison Analysis render: what was produced, from which comparison, under which brand snapshot, and — when the source record was truncated — which sections it was missing. Written by render-property-comparison-pdf. The document contents are not stored here; the source row is referenced instead.';

CREATE INDEX IF NOT EXISTS property_comparison_renders_comparison_idx
  ON public.property_comparison_renders (comparison_id, created_at DESC);
CREATE INDEX IF NOT EXISTS property_comparison_renders_brand_idx
  ON public.property_comparison_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS property_comparison_renders_failed_idx
  ON public.property_comparison_renders (created_at DESC)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS property_comparison_renders_shape_idx
  ON public.property_comparison_renders (source_shape, created_at DESC)
  WHERE source_shape IS NOT NULL;

ALTER TABLE public.property_comparison_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY property_comparison_renders_select
  ON public.property_comparison_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.property_comparison_renders FROM anon, authenticated;
GRANT SELECT ON public.property_comparison_renders TO authenticated;
GRANT ALL ON public.property_comparison_renders TO service_role;