-- Extend existing report_templates with builder fields
ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS report_type TEXT,
  ADD COLUMN IF NOT EXISTS tier TEXT,
  ADD COLUMN IF NOT EXISTS schema JSONB NOT NULL DEFAULT '{"version":1,"tokens":{},"pages":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;

CREATE INDEX IF NOT EXISTS idx_report_templates_report_type ON public.report_templates(report_type);
CREATE INDEX IF NOT EXISTS idx_report_templates_active ON public.report_templates(is_active) WHERE is_active = true;

-- Version history snapshots
CREATE TABLE IF NOT EXISTS public.report_template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.report_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  schema JSONB NOT NULL,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE INDEX IF NOT EXISTS idx_report_template_versions_template
  ON public.report_template_versions(template_id, version DESC);

ALTER TABLE public.report_template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_report_template_versions" ON public.report_template_versions;
CREATE POLICY "service_role_all_report_template_versions"
  ON public.report_template_versions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);