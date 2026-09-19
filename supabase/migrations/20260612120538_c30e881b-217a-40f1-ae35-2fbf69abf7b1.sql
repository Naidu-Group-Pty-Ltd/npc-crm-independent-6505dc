
-- ============================================================
-- Phase 0: PDF Import pipeline guardrails (storage bucket created separately via UI)
-- ============================================================

-- 1. pdf_import_jobs ------------------------------------------------
CREATE TABLE public.pdf_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  template_id UUID NULL,
  source_file_path TEXT NOT NULL,
  source_file_name TEXT NULL,
  source_file_size_bytes BIGINT NULL,
  engine TEXT NOT NULL DEFAULT 'legacy' CHECK (engine IN ('legacy', 'docling')),
  engine_version TEXT NULL,
  mode TEXT NOT NULL DEFAULT 'semantic' CHECK (mode IN ('semantic', 'hybrid', 'pixel_perfect')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','uploading','parsing','mapping','finalizing','succeeded','failed','cancelled')),
  stage TEXT NULL,
  stage_started_at TIMESTAMPTZ NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  duration_ms INTEGER NULL,
  page_count INTEGER NULL,
  ssim_score NUMERIC(5,4) NULL,
  error_code TEXT NULL,
  error_text TEXT NULL,
  diagnostics_path TEXT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdf_import_jobs_user ON public.pdf_import_jobs(user_id, created_at DESC);
CREATE INDEX idx_pdf_import_jobs_status ON public.pdf_import_jobs(status)
  WHERE status NOT IN ('succeeded','failed','cancelled');
CREATE INDEX idx_pdf_import_jobs_template ON public.pdf_import_jobs(template_id) WHERE template_id IS NOT NULL;

GRANT SELECT ON public.pdf_import_jobs TO authenticated;
GRANT ALL ON public.pdf_import_jobs TO service_role;

ALTER TABLE public.pdf_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own pdf import jobs"
  ON public.pdf_import_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'superadmin'));

CREATE OR REPLACE FUNCTION public.tg_pdf_import_jobs_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status IN ('succeeded','failed','cancelled') AND NEW.finished_at IS NULL THEN
    NEW.finished_at = now();
    IF NEW.started_at IS NOT NULL THEN
      NEW.duration_ms = EXTRACT(EPOCH FROM (NEW.finished_at - NEW.started_at)) * 1000;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pdf_import_jobs_set_updated_at
  BEFORE UPDATE ON public.pdf_import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_pdf_import_jobs_set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.pdf_import_jobs;

-- 2. feature_flags -------------------------------------------------
CREATE TABLE public.feature_flags (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT NULL,
  updated_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read feature flags"
  ON public.feature_flags FOR SELECT TO authenticated USING (true);

CREATE POLICY "Superadmins manage feature flags"
  ON public.feature_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'));

CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.tg_pdf_import_jobs_set_updated_at();

INSERT INTO public.feature_flags(key, value, description)
VALUES (
  'pdf_import.engine',
  '{"default":"legacy","superadmin":"legacy","allowlist":[]}'::jsonb,
  'Controls which extractor template-import-pdf uses. Values: legacy | docling. allowlist holds user ids opted in early.'
)
ON CONFLICT (key) DO NOTHING;
