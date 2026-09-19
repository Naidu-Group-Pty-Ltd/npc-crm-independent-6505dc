
-- ── Jobs table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ghl_marketing_dump_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | completed | failed | partial
  account TEXT NOT NULL DEFAULT 'legacy',
  requested_resources TEXT[] NOT NULL DEFAULT ARRAY['form','survey','funnel','workflow']::TEXT[],
  use_firecrawl BOOLEAN NOT NULL DEFAULT TRUE,
  download_assets BOOLEAN NOT NULL DEFAULT TRUE,
  cursor JSONB NOT NULL DEFAULT '{}'::jsonb,           -- { phase, index } for resumable chunking
  total_assets INTEGER NOT NULL DEFAULT 0,
  processed_assets INTEGER NOT NULL DEFAULT 0,
  failed_assets INTEGER NOT NULL DEFAULT 0,
  current_label TEXT,
  error_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ghl_marketing_dump_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_dump_jobs"
  ON public.ghl_marketing_dump_jobs FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ghl_dump_jobs_status ON public.ghl_marketing_dump_jobs(status, created_at DESC);

-- ── Workflow snapshot bridge ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ghl_workflow_snapshot_bridge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_workflow_id TEXT NOT NULL UNIQUE,
  legacy_name TEXT,
  trigger_summary TEXT,
  step_count INTEGER,
  raw_metadata JSONB,
  new_workflow_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | imported | verified | skipped
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ghl_workflow_snapshot_bridge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_workflow_bridge"
  ON public.ghl_workflow_snapshot_bridge FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ── New columns on raw dumps ────────────────────────────────────
ALTER TABLE public.ghl_marketing_raw_dumps
  ADD COLUMN IF NOT EXISTS portable_html_path TEXT,
  ADD COLUMN IF NOT EXISTS inlined_css TEXT,
  ADD COLUMN IF NOT EXISTS asset_manifest JSONB,
  ADD COLUMN IF NOT EXISTS reconstruction_notes TEXT,
  ADD COLUMN IF NOT EXISTS harvest_job_id UUID REFERENCES public.ghl_marketing_dump_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asset_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS asset_bytes BIGINT NOT NULL DEFAULT 0;

-- ── Storage bucket ──────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('ghl-marketing-dump', 'ghl-marketing-dump', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "service_role_dump_bucket_all"
  ON storage.objects FOR ALL
  TO service_role USING (bucket_id = 'ghl-marketing-dump') WITH CHECK (bucket_id = 'ghl-marketing-dump');

-- ── updated_at trigger ──────────────────────────────────────────
CREATE TRIGGER trg_ghl_dump_jobs_updated_at
  BEFORE UPDATE ON public.ghl_marketing_dump_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_ghl_workflow_bridge_updated_at
  BEFORE UPDATE ON public.ghl_workflow_snapshot_bridge
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
