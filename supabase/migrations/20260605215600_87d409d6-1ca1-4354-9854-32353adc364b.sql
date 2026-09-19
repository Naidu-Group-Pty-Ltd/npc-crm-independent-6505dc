
CREATE TABLE IF NOT EXISTS public.template_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NULL,
  template_name TEXT NULL,
  requested_by UUID NULL,
  mode TEXT NOT NULL DEFAULT 'preview',
  pdf_variant TEXT NOT NULL DEFAULT 'pdf/a-2b',
  tagged BOOLEAN NOT NULL DEFAULT true,
  theme_id TEXT NULL,
  page_master_id TEXT NULL,
  page_count INTEGER NULL,
  asset_count INTEGER NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NULL,
  signed_url TEXT NULL,
  signed_url_expires_at TIMESTAMPTZ NULL,
  bytes INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT NULL,
  duration_ms INTEGER NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.template_render_jobs TO authenticated;
GRANT ALL ON public.template_render_jobs TO service_role;

ALTER TABLE public.template_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "render_jobs_select_auth"
ON public.template_render_jobs FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "render_jobs_insert_self"
ON public.template_render_jobs FOR INSERT
TO authenticated
WITH CHECK (requested_by IS NULL OR requested_by = auth.uid());

CREATE POLICY "render_jobs_update_self"
ON public.template_render_jobs FOR UPDATE
TO authenticated
USING (requested_by IS NULL OR requested_by = auth.uid())
WITH CHECK (requested_by IS NULL OR requested_by = auth.uid());

CREATE INDEX IF NOT EXISTS template_render_jobs_template_idx
  ON public.template_render_jobs (template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS template_render_jobs_requested_by_idx
  ON public.template_render_jobs (requested_by, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_template_render_jobs_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_template_render_jobs_updated_at ON public.template_render_jobs;
CREATE TRIGGER trg_template_render_jobs_updated_at
BEFORE UPDATE ON public.template_render_jobs
FOR EACH ROW EXECUTE FUNCTION public.touch_template_render_jobs_updated_at();
