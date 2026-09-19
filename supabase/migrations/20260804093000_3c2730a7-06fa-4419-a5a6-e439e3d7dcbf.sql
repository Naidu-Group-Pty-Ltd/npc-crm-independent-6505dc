CREATE TABLE IF NOT EXISTS public.brand_design_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  brand_hex text CHECK (brand_hex IS NULL OR brand_hex ~ '^#[0-9A-Fa-f]{6}$'),
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin text NOT NULL DEFAULT 'authored' CHECK (origin IN ('authored', 'generated')),
  brief text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.brand_design_systems IS
  'A saved position on the report design system: a brand colour plus a full ReportDesignOptions. The resolved palette is deliberately not stored — it is derived per render against the preset''s own grounds, because a palette resolved under one preset is not legal under another.';

CREATE INDEX IF NOT EXISTS brand_design_systems_active_idx
  ON public.brand_design_systems (is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.template_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'extracting'
    CHECK (status IN ('extracting', 'review', 'rendering', 'succeeded', 'failed')),
  source_filename text NOT NULL DEFAULT '',
  source_size_bytes integer,
  source_markdown text,
  structure jsonb,
  binding jsonb,
  bound_format text,
  design_system_id uuid REFERENCES public.brand_design_systems(id) ON DELETE SET NULL,
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'converted-templates',
  storage_path text,
  bytes integer,
  page_count integer,
  bound_chapters integer NOT NULL DEFAULT 0,
  unfilled_chapters integer NOT NULL DEFAULT 0,
  appendix_sections integer NOT NULL DEFAULT 0,
  unstructured boolean NOT NULL DEFAULT false,
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  duration_ms integer,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.template_conversions IS
  'One uploaded template converted onto the report design system and bound to a report format. Holds the parsed Markdown so a binding can be re-proposed and re-rendered without re-parsing the source PDF.';

CREATE INDEX IF NOT EXISTS template_conversions_requester_idx
  ON public.template_conversions (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS template_conversions_failed_idx
  ON public.template_conversions (created_at DESC)
  WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS template_conversions_appendix_idx
  ON public.template_conversions (created_at DESC)
  WHERE appendix_sections > 0;
CREATE INDEX IF NOT EXISTS template_conversions_system_idx
  ON public.template_conversions (design_system_id)
  WHERE design_system_id IS NOT NULL;

DROP POLICY IF EXISTS "Service role manages converted templates" ON storage.objects;
CREATE POLICY "Service role manages converted templates"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'converted-templates')
  WITH CHECK (bucket_id = 'converted-templates');

ALTER TABLE public.brand_design_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_conversions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brand_design_systems_select ON public.brand_design_systems;
CREATE POLICY brand_design_systems_select
  ON public.brand_design_systems
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS template_conversions_select ON public.template_conversions;
CREATE POLICY template_conversions_select
  ON public.template_conversions
  FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.brand_design_systems FROM anon, authenticated;
REVOKE ALL ON public.template_conversions FROM anon, authenticated;
GRANT SELECT ON public.brand_design_systems TO authenticated;
GRANT SELECT ON public.template_conversions TO authenticated;
GRANT ALL ON public.brand_design_systems TO service_role;
GRANT ALL ON public.template_conversions TO service_role;