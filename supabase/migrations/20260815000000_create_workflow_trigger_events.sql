-- The queue that makes "Live" mean something.
--
-- Until now a workflow could be marked Live and nothing would ever start it:
-- the triggers were modelled in the catalog and drawn on the canvas, but no
-- part of the system watched the tables they claimed to watch. This is the
-- half that closes — capture — and it is deliberately the half that needs no
-- Edge Function deployment, because it is entirely inside Postgres.
--
-- Design notes worth knowing before changing this:
--
-- * Capture is gated on demand. `workflow_trigger_is_live` returns false when
--   no live workflow contains a node of that trigger type, and the row triggers
--   return early on it. A project with no live workflows therefore pays one
--   cheap EXISTS per write and stores nothing — this table cannot become a
--   silent write amplifier on `clients`.
--
-- * Enqueueing never breaks the write that caused it. Every enqueue is wrapped
--   so a fault here can fail an automation but can never fail a client record
--   being saved. That asymmetry is the whole point: the business write is the
--   thing that matters.
--
-- * `dedupe_key` is UNIQUE and carries the natural identity of the occurrence
--   (row id plus the transition), so a retried or double-fired statement lands
--   once. A dispatcher can therefore be at-least-once without being
--   at-least-twice from the user's point of view.

BEGIN;

CREATE TABLE IF NOT EXISTS public.workflow_trigger_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Catalog node id, e.g. 'platform.client_created'.
  trigger_type text NOT NULL,
  -- Shaped to the catalog node's declared outputs, so `{{trigger.…}}` resolves
  -- against a real event exactly as it does against sample data.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),

  status text NOT NULL DEFAULT 'pending',
  -- Claim fields. A dispatcher takes work by moving pending → claimed in one
  -- statement; `claimed_at` lets a crashed claim be reaped rather than stranding
  -- the event forever.
  claimed_at timestamptz,
  claimed_by text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,

  -- Natural identity of the occurrence. UNIQUE, so a repeat is a no-op.
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workflow_trigger_events_status_check
    CHECK (status IN ('pending', 'claimed', 'processed', 'failed', 'discarded')),
  CONSTRAINT workflow_trigger_events_dedupe_key_unique UNIQUE (dedupe_key)
);

COMMENT ON TABLE public.workflow_trigger_events IS
  'Captured platform events awaiting workflow dispatch. Written by row triggers; drained by a dispatcher.';

-- The dispatcher''s only hot query: oldest pending first.
CREATE INDEX IF NOT EXISTS workflow_trigger_events_pending_idx
  ON public.workflow_trigger_events (occurred_at)
  WHERE status = 'pending';

-- Reaping abandoned claims.
CREATE INDEX IF NOT EXISTS workflow_trigger_events_claimed_idx
  ON public.workflow_trigger_events (claimed_at)
  WHERE status = 'claimed';

CREATE INDEX IF NOT EXISTS workflow_trigger_events_type_idx
  ON public.workflow_trigger_events (trigger_type, occurred_at DESC);

ALTER TABLE public.workflow_trigger_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_trigger_events_service_role_all ON public.workflow_trigger_events;
CREATE POLICY workflow_trigger_events_service_role_all ON public.workflow_trigger_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admins read the queue so Live is observable from the UI. They do not write it:
-- these rows are a record of something that happened, not something to author.
DROP POLICY IF EXISTS "Admins can view workflow trigger events" ON public.workflow_trigger_events;
CREATE POLICY "Admins can view workflow trigger events" ON public.workflow_trigger_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

-- ── Capture gate ────────────────────────────────────────────────────────────

/**
 * True when at least one live workflow contains a node of this trigger type.
 *
 * This is what keeps capture free when nothing is armed. It is STABLE rather
 * than IMMUTABLE because it reads `workflows`, and it is deliberately not
 * SECURITY DEFINER: it runs inside a row trigger, which already executes as the
 * table owner.
 */
CREATE OR REPLACE FUNCTION public.workflow_trigger_is_live(p_trigger_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workflows w,
         LATERAL jsonb_array_elements(COALESCE(w.graph -> 'nodes', '[]'::jsonb)) AS n
    WHERE w.status = 'live'
      AND n ->> 'type' = p_trigger_type
  );
$$;

/**
 * Record one occurrence, at most once.
 *
 * Returns quietly when nothing is listening, and swallows its own failures —
 * an automation that misses an event is a problem, but a client record that
 * cannot be saved because of an automation is a bigger one.
 */
CREATE OR REPLACE FUNCTION public.enqueue_workflow_trigger_event(
  p_trigger_type text,
  p_dedupe_key text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.workflow_trigger_is_live(p_trigger_type) THEN
    RETURN;
  END IF;

  INSERT INTO public.workflow_trigger_events (trigger_type, dedupe_key, payload)
  VALUES (p_trigger_type, p_dedupe_key, COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (dedupe_key) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[workflow] could not enqueue % (%): %', p_trigger_type, p_dedupe_key, SQLERRM;
END;
$$;

COMMIT;
