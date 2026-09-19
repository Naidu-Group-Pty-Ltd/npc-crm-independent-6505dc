-- Draining `workflow_trigger_events`.
--
-- The table has carried claim columns since it was created — `status`,
-- `claimed_at`, `claimed_by`, `attempts`, `last_error` — and a comment saying it
-- is "drained by a dispatcher". Nothing drained it. Every event captured since
-- has sat at `pending`, so a workflow marked Live never ran on its own; the
-- status control's toast said as much, which is honest but not the intent.
--
-- This is the half that has to be in the database: taking work exactly once.
-- Two dispatcher invocations can overlap — pg_cron does not wait for the last
-- run to finish, and a slow batch plus a one-minute cadence guarantees overlap
-- eventually. `FOR UPDATE SKIP LOCKED` is what makes the second invocation pass
-- over rows the first is already holding rather than dispatching them twice,
-- and a workflow dispatched twice sends the message twice.

BEGIN;

-- ── Claiming ────────────────────────────────────────────────────────────────

/**
 * Takes up to `p_limit` events for one dispatcher invocation.
 *
 * Reaps as well as claims. An invocation that dies mid-batch — killed at the
 * Edge wall-clock ceiling, or an instance recycled — leaves its events at
 * `claimed` with nobody coming back for them, so a claim older than
 * `p_stale_after` is treated as abandoned and offered again. That is why the
 * claim increments `attempts`: a genuinely poisonous event that kills the
 * dispatcher every time still walks up to MAX_ATTEMPTS and stops, rather than
 * being re-claimed for ever.
 */
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
    -- Oldest first: an automation that fires out of order is worse than one
    -- that fires late.
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

-- ── Releasing ───────────────────────────────────────────────────────────────

/**
 * Records what happened to a claimed event.
 *
 * `p_status` is one of 'processed', 'pending' (retry on the next tick) or
 * 'failed' (given up on). The dispatcher decides which — see
 * `_shared/workflow/dispatch.pure.ts`, where the rule is stated once and tested
 * — because the distinction is about what the *engine* reported, which SQL
 * cannot see.
 *
 * Note that a retry does NOT decrement `attempts`. The count is of dispatch
 * attempts, and an attempt that failed still happened.
 */
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
         -- The claim counts an attempt up front, so that an event which kills
         -- the dispatcher still walks up to MAX_ATTEMPTS instead of being
         -- retried for ever. An event the dispatcher put back WITHOUT trying it
         -- — because the batch ran out of wall clock, or because the workflow
         -- table could not be read — was not an attempt at all, and charging it
         -- one would let a busy five minutes exhaust an event's retries before
         -- anything had ever been dispatched for it.
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

-- Claiming scans by status and orders by occurrence; without this it is a seq
-- scan over every event ever captured, most of them long since processed.
CREATE INDEX IF NOT EXISTS workflow_trigger_events_claimable_idx
  ON public.workflow_trigger_events (occurred_at)
  WHERE status IN ('pending', 'claimed');

-- ── Schedule ────────────────────────────────────────────────────────────────

-- One minute. An automation people describe as "when a client is added" should
-- not visibly lag, and the claim is cheap when there is nothing to claim.
-- `cron_invoke_signed_function` HMAC-signs the call as `pg_cron`, which is the
-- only caller the dispatcher accepts.
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
