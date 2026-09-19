BEGIN;

CREATE OR REPLACE FUNCTION public.claim_workflow_trigger_events(
  p_limit       integer  DEFAULT 20,
  p_claimed_by  text     DEFAULT 'dispatcher',
  p_stale_after interval DEFAULT interval '5 minutes'
)
RETURNS TABLE (
  id           uuid,
  trigger_type text,
  payload      jsonb,
  occurred_at  timestamptz,
  attempts     integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH claimable AS (
    SELECT e.id
    FROM public.workflow_trigger_events e
    WHERE e.status = 'pending'
       OR (e.status = 'claimed' AND e.claimed_at < now() - p_stale_after)
    ORDER BY e.occurred_at
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.workflow_trigger_events e
     SET status     = 'claimed',
         claimed_at = now(),
         claimed_by = p_claimed_by,
         attempts   = e.attempts + 1
    FROM claimable c
   WHERE e.id = c.id
  RETURNING e.id, e.trigger_type, e.payload, e.occurred_at, e.attempts;
$$;

COMMENT ON FUNCTION public.claim_workflow_trigger_events IS
  'Atomically claims pending (and abandoned) trigger events for one dispatcher run. SKIP LOCKED, so overlapping invocations cannot claim the same event.';

REVOKE ALL ON FUNCTION public.claim_workflow_trigger_events(integer, text, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_workflow_trigger_events(integer, text, interval) TO service_role;

CREATE OR REPLACE FUNCTION public.release_workflow_trigger_event(
  p_id             uuid,
  p_status         text,
  p_last_error     text DEFAULT NULL,
  p_refund_attempt boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_status NOT IN ('processed', 'pending', 'failed') THEN
    RAISE EXCEPTION 'release_workflow_trigger_event: unexpected status %', p_status;
  END IF;

  UPDATE public.workflow_trigger_events
     SET status       = p_status,
         last_error   = p_last_error,
         attempts     = CASE
                          WHEN p_refund_attempt THEN GREATEST(attempts - 1, 0)
                          ELSE attempts
                        END,
         claimed_at   = CASE WHEN p_status = 'pending' THEN NULL ELSE claimed_at END,
         claimed_by   = CASE WHEN p_status = 'pending' THEN NULL ELSE claimed_by END,
         processed_at = CASE WHEN p_status = 'pending' THEN NULL ELSE now() END
   WHERE id = p_id;
END;
$$;

COMMENT ON FUNCTION public.release_workflow_trigger_event IS
  'Finishes a claimed trigger event: processed, pending (retry) or failed (given up). p_refund_attempt undoes the claim''s attempt increment when the event was put back untried.';

REVOKE ALL ON FUNCTION public.release_workflow_trigger_event(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_workflow_trigger_event(uuid, text, text, boolean) TO service_role;

CREATE INDEX IF NOT EXISTS workflow_trigger_events_claimable_idx
  ON public.workflow_trigger_events (occurred_at)
  WHERE status IN ('pending', 'claimed');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('dispatch-workflow-triggers')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatch-workflow-triggers');

    PERFORM cron.schedule(
      'dispatch-workflow-triggers',
      '* * * * *',
      $job$SELECT public.cron_invoke_signed_function('dispatch-workflow-triggers', '{}'::jsonb, 'pg_cron');$job$
    );
  END IF;
END;
$$;

COMMIT;