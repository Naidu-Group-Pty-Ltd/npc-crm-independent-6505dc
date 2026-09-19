
CREATE TABLE IF NOT EXISTS public.ghl_marketing_raw_dumps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('form','survey','quiz','funnel','funnel_page','workflow')),
  ghl_id TEXT NOT NULL,
  location_id TEXT,
  name TEXT,
  parent_ghl_id TEXT,
  raw_payload JSONB,
  html_content TEXT,
  css_content TEXT,
  embed_code TEXT,
  full_url TEXT,
  fetch_status TEXT DEFAULT 'ok',
  fetch_error TEXT,
  endpoints_tried JSONB,
  last_fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (resource_type, ghl_id)
);

CREATE INDEX IF NOT EXISTS idx_ghl_marketing_raw_dumps_type ON public.ghl_marketing_raw_dumps(resource_type);
CREATE INDEX IF NOT EXISTS idx_ghl_marketing_raw_dumps_parent ON public.ghl_marketing_raw_dumps(parent_ghl_id);

ALTER TABLE public.ghl_marketing_raw_dumps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_select" ON public.ghl_marketing_raw_dumps
  FOR SELECT TO service_role USING (true);
CREATE POLICY "service_role_only_insert" ON public.ghl_marketing_raw_dumps
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "service_role_only_update" ON public.ghl_marketing_raw_dumps
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_only_delete" ON public.ghl_marketing_raw_dumps
  FOR DELETE TO service_role USING (true);

CREATE TRIGGER trg_ghl_marketing_raw_dumps_updated
  BEFORE UPDATE ON public.ghl_marketing_raw_dumps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
