
-- =========================================================
-- figma_templates: registry of Figma frames available as report templates
-- =========================================================
CREATE TABLE public.figma_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  figma_file_key TEXT NOT NULL,
  figma_node_id TEXT,
  figma_url TEXT,
  report_type TEXT NOT NULL DEFAULT 'investment',
  tier TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  thumbnail_url TEXT,
  thumbnail_expires_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_error TEXT,
  raw_node JSONB,
  compiled_schema JSONB,
  compile_warnings JSONB DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.figma_templates TO service_role;

ALTER TABLE public.figma_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_figma_templates"
  ON public.figma_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_figma_templates_report_type_active
  ON public.figma_templates (report_type, is_active)
  WHERE is_active = true;

CREATE INDEX idx_figma_templates_file_node
  ON public.figma_templates (figma_file_key, figma_node_id);

CREATE TRIGGER trg_figma_templates_updated_at
  BEFORE UPDATE ON public.figma_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- figma_template_sync_log: audit trail for every sync attempt
-- =========================================================
CREATE TABLE public.figma_template_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  figma_template_id UUID REFERENCES public.figma_templates(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  triggered_by UUID,
  summary TEXT,
  diff JSONB,
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.figma_template_sync_log TO service_role;

ALTER TABLE public.figma_template_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_figma_template_sync_log"
  ON public.figma_template_sync_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_figma_sync_log_template
  ON public.figma_template_sync_log (figma_template_id, created_at DESC);
