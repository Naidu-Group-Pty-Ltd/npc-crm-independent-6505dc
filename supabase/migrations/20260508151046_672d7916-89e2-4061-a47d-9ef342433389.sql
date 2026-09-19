
-- ── ghl_account_config (singleton) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ghl_account_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  default_account TEXT NOT NULL DEFAULT 'legacy' CHECK (default_account IN ('legacy','new')),
  legacy_disabled_at TIMESTAMPTZ,
  cutover_job_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton_row CHECK (id = TRUE)
);

INSERT INTO public.ghl_account_config (id, default_account)
VALUES (TRUE, 'legacy')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.ghl_account_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role only" ON public.ghl_account_config;
CREATE POLICY "service_role only"
  ON public.ghl_account_config
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── legacy_wipe_jobs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.legacy_wipe_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  confirmation_received TEXT,
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_resource TEXT,
  resources_completed TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  total_deleted INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  worker_lock_until TIMESTAMPTZ,
  dispatch_count INTEGER NOT NULL DEFAULT 0,
  cutover_finalised BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS legacy_wipe_jobs_status_idx ON public.legacy_wipe_jobs(status);
CREATE INDEX IF NOT EXISTS legacy_wipe_jobs_created_at_idx ON public.legacy_wipe_jobs(created_at DESC);

ALTER TABLE public.legacy_wipe_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role only" ON public.legacy_wipe_jobs;
CREATE POLICY "service_role only"
  ON public.legacy_wipe_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger (reuses existing helper if present)
CREATE OR REPLACE FUNCTION public.touch_legacy_wipe_jobs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legacy_wipe_jobs_touch_updated_at ON public.legacy_wipe_jobs;
CREATE TRIGGER legacy_wipe_jobs_touch_updated_at
  BEFORE UPDATE ON public.legacy_wipe_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_legacy_wipe_jobs_updated_at();

-- ── Realtime publication ────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'legacy_wipe_jobs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.legacy_wipe_jobs';
  END IF;
END$$;

ALTER TABLE public.legacy_wipe_jobs REPLICA IDENTITY FULL;

-- ── finalize_ghl_cutover() ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_ghl_cutover(p_job_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.legacy_wipe_jobs%ROWTYPE;
  v_config public.ghl_account_config%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.legacy_wipe_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job not found');
  END IF;

  IF v_job.dry_run THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot finalise cutover from a dry-run job');
  END IF;

  IF v_job.status <> 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job is not in completed status: ' || v_job.status);
  END IF;

  UPDATE public.ghl_account_config
  SET default_account = 'new',
      legacy_disabled_at = COALESCE(legacy_disabled_at, now()),
      cutover_job_id = COALESCE(cutover_job_id, p_job_id),
      updated_at = now()
  WHERE id = TRUE
  RETURNING * INTO v_config;

  UPDATE public.legacy_wipe_jobs
  SET cutover_finalised = TRUE
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'default_account', v_config.default_account,
    'legacy_disabled_at', v_config.legacy_disabled_at,
    'cutover_job_id', v_config.cutover_job_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_ghl_cutover(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_ghl_cutover(UUID) TO service_role;
