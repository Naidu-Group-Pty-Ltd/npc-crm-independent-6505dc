-- export_jobs: generic tracker for async file exports built by edge functions
CREATE TABLE public.export_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type TEXT NOT NULL,                    -- e.g. 'conversations_full_history'
  file_format TEXT NOT NULL CHECK (file_format IN ('csv', 'xlsx')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  scope JSONB NOT NULL DEFAULT '{}'::jsonb,     -- filter params (e.g. { conversation_ids: [...], channel: 'sms' })
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  total_messages INTEGER NOT NULL DEFAULT 0,
  storage_bucket TEXT,
  storage_path TEXT,
  file_size_bytes BIGINT,
  signed_url TEXT,
  signed_url_expires_at TIMESTAMPTZ,
  error_summary TEXT,
  created_by UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_export_jobs_created_by_status ON public.export_jobs (created_by, status, created_at DESC);
CREATE INDEX idx_export_jobs_status_created ON public.export_jobs (status, created_at DESC);

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;

-- service_role only (matches project standard); all access goes through edge functions.
CREATE POLICY "service_role full access to export_jobs"
ON public.export_jobs
AS PERMISSIVE
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Auto-update updated_at
CREATE TRIGGER trg_export_jobs_updated_at
BEFORE UPDATE ON public.export_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.export_jobs;
ALTER TABLE public.export_jobs REPLICA IDENTITY FULL;