
-- Allow new terminal state for chunked pipeline.
ALTER TABLE public.pdf_import_jobs DROP CONSTRAINT IF EXISTS pdf_import_jobs_status_check;
ALTER TABLE public.pdf_import_jobs ADD CONSTRAINT pdf_import_jobs_status_check CHECK (
  status = ANY (ARRAY[
    'queued','uploading','parsing','mapping','finalizing',
    'succeeded','failed','cancelled','recoverable_failed'
  ])
);

-- Chunked pipeline progress columns.
ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS chunked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chunks_total integer,
  ADD COLUMN IF NOT EXISTS chunks_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunks_failed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS callback_received_at timestamptz;

-- Chunk ledger.
CREATE TABLE IF NOT EXISTS public.pdf_import_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.pdf_import_jobs(id) ON DELETE CASCADE,
  parent_chunk_id uuid REFERENCES public.pdf_import_chunks(id) ON DELETE SET NULL,
  chunk_index integer NOT NULL,
  page_start integer NOT NULL,
  page_end integer NOT NULL,
  page_count integer GENERATED ALWAYS AS (page_end - page_start + 1) STORED,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending','dispatched','parsing','succeeded','failed','split','fatal'])),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  artifact_paths jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_text text,
  dispatched_at timestamptz,
  finished_at timestamptz,
  duration_ms integer,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, chunk_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pdf_import_chunks TO authenticated;
GRANT ALL ON public.pdf_import_chunks TO service_role;

ALTER TABLE public.pdf_import_chunks ENABLE ROW LEVEL SECURITY;

-- Same scoping model as pdf_import_jobs: service_role bypasses RLS; authenticated
-- callers can read chunks that belong to a job they own.
CREATE POLICY "pdf_import_chunks_owner_select" ON public.pdf_import_chunks
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.pdf_import_jobs j
    WHERE j.id = pdf_import_chunks.job_id AND j.user_id = auth.uid()
  ));

CREATE INDEX IF NOT EXISTS pdf_import_chunks_job_idx ON public.pdf_import_chunks (job_id, chunk_index);
CREATE INDEX IF NOT EXISTS pdf_import_chunks_status_idx ON public.pdf_import_chunks (status, last_event_at);

-- Aggregate trigger: every chunk row change recomputes job-level rollups.
CREATE OR REPLACE FUNCTION public.recompute_pdf_import_job_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job uuid := COALESCE(NEW.job_id, OLD.job_id);
  v_total integer;
  v_done integer;
  v_failed integer;
  v_pages_done integer;
BEGIN
  SELECT
    count(*) FILTER (WHERE status NOT IN ('split')),
    count(*) FILTER (WHERE status = 'succeeded'),
    count(*) FILTER (WHERE status IN ('fatal')),
    COALESCE(sum(page_count) FILTER (WHERE status = 'succeeded'), 0)
  INTO v_total, v_done, v_failed, v_pages_done
  FROM public.pdf_import_chunks
  WHERE job_id = v_job;

  UPDATE public.pdf_import_jobs
  SET
    chunks_total = v_total,
    chunks_completed = v_done,
    chunks_failed = v_failed,
    pages_completed = GREATEST(COALESCE(pages_completed, 0), v_pages_done),
    updated_at = now()
  WHERE id = v_job;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pdf_import_chunks_progress ON public.pdf_import_chunks;
CREATE TRIGGER pdf_import_chunks_progress
  AFTER INSERT OR UPDATE OR DELETE ON public.pdf_import_chunks
  FOR EACH ROW EXECUTE FUNCTION public.recompute_pdf_import_job_progress();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_pdf_import_chunks_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.last_event_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pdf_import_chunks_touch ON public.pdf_import_chunks;
CREATE TRIGGER pdf_import_chunks_touch
  BEFORE UPDATE ON public.pdf_import_chunks
  FOR EACH ROW EXECUTE FUNCTION public.touch_pdf_import_chunks_updated_at();

-- Realtime so the diagnostics dashboard can stream chunk progress.
DO $$
BEGIN
  PERFORM 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='pdf_import_chunks';
  IF NOT FOUND THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.pdf_import_chunks';
  END IF;
END$$;
