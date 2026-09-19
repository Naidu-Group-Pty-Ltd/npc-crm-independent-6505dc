-- Migration jobs (one row per bulk run)
CREATE TABLE public.migration_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('contacts','opportunities','conversations','notes')),
  source_account TEXT NOT NULL CHECK (source_account IN ('legacy','new')),
  target_account TEXT NOT NULL CHECK (target_account IN ('legacy','new')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  dry_run BOOLEAN NOT NULL DEFAULT true,
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  succeeded_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_migration_jobs_status ON public.migration_jobs(status);
CREATE INDEX idx_migration_jobs_domain ON public.migration_jobs(domain);
CREATE INDEX idx_migration_jobs_created_at ON public.migration_jobs(created_at DESC);

-- Per-record items (one row per source entity processed)
CREATE TABLE public.migration_job_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.migration_jobs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  target_id TEXT,
  entity_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','skipped')),
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_migration_job_items_job_id ON public.migration_job_items(job_id);
CREATE INDEX idx_migration_job_items_status ON public.migration_job_items(status);
CREATE UNIQUE INDEX idx_migration_job_items_unique_source ON public.migration_job_items(job_id, source_id);

-- updated_at trigger
CREATE TRIGGER update_migration_jobs_updated_at
  BEFORE UPDATE ON public.migration_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.migration_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.migration_job_items ENABLE ROW LEVEL SECURITY;

-- Superadmins can read everything; service_role bypasses RLS automatically for writes
CREATE POLICY "Superadmins can view migration jobs"
  ON public.migration_jobs FOR SELECT
  USING (public.has_role(auth.uid(), 'superadmin'::app_role));

CREATE POLICY "Superadmins can view migration job items"
  ON public.migration_job_items FOR SELECT
  USING (public.has_role(auth.uid(), 'superadmin'::app_role));

-- Block all client-side writes; only service_role (edge functions) may write
CREATE POLICY "No client writes to migration jobs"
  ON public.migration_jobs FOR ALL
  USING (false) WITH CHECK (false);

CREATE POLICY "No client writes to migration job items"
  ON public.migration_job_items FOR ALL
  USING (false) WITH CHECK (false);