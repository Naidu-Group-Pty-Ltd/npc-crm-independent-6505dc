-- ============================================================================
-- Builders Network Phase 7, wave 4 — the selection events actually travel
-- (plan §3 E3; the network's convergence counterpart shipped in
-- aurixa-builders 20260915120000).
--
-- The mirror migration built the roads and nothing drove them: a Command
-- Centre adviser's selection landed in `builder_stock_selections` and the
-- network — whose Stock List is where the BUILDER sees and acknowledges it —
-- was never told. This wave adds the two missing halves of E3's journey:
--
--   OUTBOUND — a trigger on `builder_stock_selections` composes
--   `stock.selection.announced` (INSERT) / `stock.selection.updated`
--   (status change) into `builder_network_outbox` IN THE SELECTION'S OWN
--   TRANSACTION: the domain write cannot commit without its event nor the
--   event without the write. The existing cross-portal-outbox-worker drain
--   (flag-gated, HMAC-signed, privacy-gated) already delivers this queue.
--
--   INBOUND — `builder_network_apply_inbound_events()` is the clone's
--   convergence sweep (same name and idiom as the network edition):
--   `stock.selection.acknowledged` from the Builders Network moves the
--   Command Centre's own selection row to `builder_acknowledged`. A webhook
--   is not delivery; this sweep is, and it is idempotent and replayable.
--
-- The event contract is the network's, matched exactly (the network's sweep
-- header documents it):
--
--   event_type   stock.selection.announced | stock.selection.updated
--   payload      remote_selection_ref  the selection row's own uuid — opaque
--                                      to the network, never derived
--                stock_item_id         the mirror PK, which IS the network's
--                                      stock item id (the E3 PK trick)
--                status                selected|progressed|completed|withdrawn
--   source_version  monotonic (one clone-wide sequence; the network's guard
--                   is per-ref >= so a global series satisfies it)
--
-- THE PRIVACY BOUNDARY, at composition: the payload is built key by key and
-- carries exactly the three fields above. No client_id, no
-- selected_by_user_id, no internal_notes, no builder_reference, no
-- remote_client_label (the label is an authorised-disclosure decision this
-- wave deliberately does not take). The worker re-asserts the same contract
-- before the wire, and the network's door asserts it a third time on
-- arrival — one contract, both ends, three gates.
--
-- Dark by default, like every wave before it: the trigger composes nothing
-- while `builder_network_enabled` is false or the organisation holds no
-- ACTIVE connection carrying `stock:publish`. Enabling starts announcements
-- PROSPECTIVELY — a historical backfill is a separate operator act, not a
-- flag flip's surprise.
--
-- New mapping column: `builder_network_connections.builder_organisation_id`
-- — which builder organisation rides this connection. Mission Control's
-- provisioning machinery writes it alongside outbound_hmac_secret and
-- network_inbound_url (MC minted the connection and knows both ends; the
-- network's provision_transport response names the connection).
-- ============================================================================

-- ===========================================================================
-- 1. Schema: the mapping column, the apply bookkeeping, the version series
-- ===========================================================================
ALTER TABLE public.builder_network_connections
  ADD COLUMN IF NOT EXISTS builder_organisation_id uuid;

COMMENT ON COLUMN public.builder_network_connections.builder_organisation_id IS
  'The builder organisation (the NETWORK''s organisation id) this connection serves. Written by Mission Control''s provisioning machinery with the transport credentials; the selection producer resolves an item''s connection through it.';

CREATE INDEX IF NOT EXISTS builder_network_connections_org_idx
  ON public.builder_network_connections (builder_organisation_id)
  WHERE builder_organisation_id IS NOT NULL;

ALTER TABLE public.builder_network_inbound_events
  ADD COLUMN IF NOT EXISTS apply_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS apply_error text;

COMMENT ON COLUMN public.builder_network_inbound_events.apply_error IS
  'Why the apply sweep could not (or will not) converge this event. Set with processed_at on terminal refusals — clearing processed_at replays the event after a fix ships; NULL on every applied event.';

CREATE SEQUENCE IF NOT EXISTS public.builder_network_selection_version_seq;

-- ===========================================================================
-- 2. The producer trigger
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.builder_network_announce_stock_selection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_flag boolean;
  v_connection uuid;
  v_event_type text;
  v_version bigint;
BEGIN
  -- The builder's own act arrives FROM the network; announcing it back
  -- would echo the network's write into its own inbox.
  IF NEW.status = 'builder_acknowledged' THEN
    RETURN NEW;
  END IF;
  -- Only a status movement is news on UPDATE; note edits are Command Centre
  -- private and cross nothing.
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  -- A selection whose mirror item was deleted has nothing the network could
  -- key the announcement to.
  IF NEW.stock_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dark by default: flag read server-side, OFF unless readable and true.
  SELECT (value = 'true'::jsonb) INTO v_flag
  FROM public.feature_flags WHERE key = 'builder_network_enabled';
  IF v_flag IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

  -- The one live connection serving this organisation, and only when the
  -- builder granted the stock:publish scope. None means not connected —
  -- silently local, exactly as the marketplace behaved before the network.
  SELECT c.id INTO v_connection
  FROM public.builder_network_connections c
  WHERE c.builder_organisation_id = NEW.organisation_id
    AND c.state = 'active'
    AND 'stock:publish' = ANY (c.scopes)
  ORDER BY c.accepted_at DESC NULLS LAST
  LIMIT 1;
  IF v_connection IS NULL THEN
    RETURN NEW;
  END IF;

  v_event_type := CASE WHEN TG_OP = 'INSERT'
    THEN 'stock.selection.announced' ELSE 'stock.selection.updated' END;
  v_version := nextval('public.builder_network_selection_version_seq');

  -- Composed key by key: exactly the contract, nothing else can leak by
  -- spreading a row. Idempotent per state-change via the versioned dedupe
  -- key; the NETWORK dedupes application per selection ref with its own
  -- monotonic guard.
  INSERT INTO public.builder_network_outbox(
    connection_id, event_type, dedupe_key, payload, source_version)
  VALUES (
    v_connection,
    v_event_type,
    'stock.selection:' || NEW.id || ':' || v_version,
    jsonb_build_object(
      'remote_selection_ref', NEW.id,
      'stock_item_id', NEW.stock_item_id,
      'status', NEW.status),
    v_version)
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END $fn$;

-- A trigger function is never callable as an RPC, but CREATE grants EXECUTE
-- to PUBLIC regardless (WP-17's rule): revoke it like every other definer.
REVOKE ALL ON FUNCTION public.builder_network_announce_stock_selection()
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.builder_stock_selections') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_builder_network_announce_selection
      ON public.builder_stock_selections;
    CREATE TRIGGER trg_builder_network_announce_selection
      AFTER INSERT OR UPDATE ON public.builder_stock_selections
      FOR EACH ROW EXECUTE FUNCTION public.builder_network_announce_stock_selection();
  ELSE
    -- Wave 3's conditional creation has not run here (a pre-mirror corpus
    -- replay). The trigger arrives with the table on a later replay of this
    -- same file; nothing is lost because nothing could have selected.
    RAISE NOTICE 'builder_stock_selections absent — producer trigger deferred to a post-mirror replay';
  END IF;
END $$;

-- ===========================================================================
-- 3. The clone's convergence sweep (the network edition's idiom, this side)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.builder_network_mark_inbound_refused(
  _event_id uuid,
  _connection_id uuid,
  _event_type text,
  _reason text,
  _severity text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE public.builder_network_inbound_events
     SET processed_at = now(), apply_error = _reason,
         apply_attempts = apply_attempts + 1
   WHERE id = _event_id;
  PERFORM public.record_portal_operational_event(
    'builder_network_inbound_apply_refused',
    CASE WHEN _severity IN ('info','warning','high','critical') THEN _severity ELSE 'warning' END,
    gen_random_uuid(), _event_id::text, 'system', NULL, 'integration_worker',
    NULL, NULL, NULL, NULL, false,
    jsonb_build_object('connection_id', _connection_id,
                       'event_type', _event_type, 'reason', _reason));
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_mark_inbound_refused(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_mark_inbound_refused(uuid, uuid, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.builder_network_apply_inbound_events(
  _limit integer DEFAULT 50)
RETURNS TABLE (applied integer, refused integer, deferred integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_event record;
  v_connection record;
  v_ref uuid;
  v_ack timestamptz;
  v_applied integer := 0;
  v_refused integer := 0;
  v_deferred integer := 0;
  v_touched uuid[] := '{}';
  v_conn_list uuid[];
  v_conn uuid;
  v_pending integer;
BEGIN
  FOR v_event IN
    SELECT e.* FROM public.builder_network_inbound_events e
    WHERE e.processed_at IS NULL
    ORDER BY e.received_at
    LIMIT greatest(1, least(_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT c.id, c.state INTO v_connection
      FROM public.builder_network_connections c WHERE c.id = v_event.connection_id;
      IF v_connection.id IS NULL OR v_connection.state = 'revoked' THEN
        PERFORM public.builder_network_mark_inbound_refused(
          v_event.id, v_event.connection_id, v_event.event_type,
          'connection_revoked', 'warning');
        v_refused := v_refused + 1;
        CONTINUE;
      END IF;

      IF v_event.event_type = 'stock.selection.acknowledged' THEN
        BEGIN
          v_ref := (v_event.payload->>'remote_selection_ref')::uuid;
        EXCEPTION WHEN others THEN v_ref := NULL; END;
        IF v_ref IS NULL THEN
          PERFORM public.builder_network_mark_inbound_refused(
            v_event.id, v_connection.id, v_event.event_type,
            'invalid_payload', 'warning');
          v_refused := v_refused + 1;
          CONTINUE;
        END IF;
        BEGIN
          v_ack := (v_event.payload->>'acknowledged_at')::timestamptz;
        EXCEPTION WHEN others THEN v_ack := NULL; END;

        -- The builder acknowledged a SELECTED selection. One already moved
        -- on (progressed/withdrawn) keeps its later state — the event is
        -- consumed as stale, never an error. acknowledged_by stays NULL: a
        -- network portal user is not a Command Centre identity, and the
        -- network keeps who; this record keeps THAT and when.
        UPDATE public.builder_stock_selections s
           SET status = 'builder_acknowledged',
               acknowledged_at = COALESCE(v_ack, now())
         WHERE s.id = v_ref AND s.status = 'selected';

        UPDATE public.builder_network_inbound_events
           SET processed_at = now(), apply_error = NULL,
               apply_attempts = apply_attempts + 1
         WHERE id = v_event.id;
        v_applied := v_applied + 1;
        v_touched := v_touched || v_connection.id;
      ELSE
        PERFORM public.builder_network_mark_inbound_refused(
          v_event.id, v_connection.id, v_event.event_type,
          'unhandled_event_type:' || left(v_event.event_type, 60), 'warning');
        v_refused := v_refused + 1;
      END IF;
    EXCEPTION WHEN others THEN
      IF v_event.apply_attempts + 1 >= 5 THEN
        UPDATE public.builder_network_inbound_events
           SET processed_at = now(), apply_attempts = apply_attempts + 1,
               apply_error = left('dead:' || SQLERRM, 500)
         WHERE id = v_event.id;
        PERFORM public.record_portal_operational_event(
          'builder_network_inbound_apply_dead', 'critical',
          gen_random_uuid(), v_event.id::text, 'system', NULL, 'integration_worker',
          NULL, NULL, NULL, NULL, false,
          jsonb_build_object('connection_id', v_event.connection_id,
                             'event_type', v_event.event_type,
                             'error', left(SQLERRM, 200)));
        v_refused := v_refused + 1;
      ELSE
        UPDATE public.builder_network_inbound_events
           SET apply_attempts = apply_attempts + 1,
               apply_error = left(SQLERRM, 500)
         WHERE id = v_event.id;
        v_deferred := v_deferred + 1;
      END IF;
    END;
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT c), '{}') INTO v_conn_list FROM unnest(v_touched) c;
  FOREACH v_conn IN ARRAY v_conn_list
  LOOP
    SELECT count(*)::integer INTO v_pending
    FROM public.builder_network_inbound_events e
    WHERE e.connection_id = v_conn AND e.processed_at IS NULL;
    UPDATE public.builder_network_stamps s
       SET stamp = jsonb_build_object(
             'count', v_pending,
             'latest', to_jsonb((SELECT max(e.received_at) FROM public.builder_network_inbound_events e
                                 WHERE e.connection_id = v_conn AND e.processed_at IS NULL)),
             'pendingRequests', v_pending,
             'attention', 0),
           updated_at = now()
     WHERE s.connection_id = v_conn AND s.side = 'inbound';
  END LOOP;

  applied := v_applied;
  refused := v_refused;
  deferred := v_deferred;
  RETURN NEXT;
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_apply_inbound_events(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_apply_inbound_events(integer)
  TO service_role;

COMMENT ON FUNCTION public.builder_network_apply_inbound_events(integer) IS
  'The clone''s inbound convergence sweep: applies stock.selection.acknowledged from the Builders Network onto builder_stock_selections, idempotently and replayably. Driven by pg_cron and opportunistically after each landing in builder-network-inbound.';

-- ===========================================================================
-- 4. The driver, pg_cron-guarded (the worker that DELIVERS is already
--    scheduled by 20260916000000; this drives the inbound half)
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'builder-network-inbound-apply-1min') THEN
      PERFORM cron.schedule(
        'builder-network-inbound-apply-1min',
        '* * * * *',
        $job$SELECT public.builder_network_apply_inbound_events(50);$job$);
    END IF;
  END IF;
END $$;

-- ===========================================================================
-- 5. Post-migration assertions (shape; behaviour is CI's vitest suite)
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='builder_network_connections'
      AND column_name='builder_organisation_id'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: connections carry no organisation mapping';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='builder_network_announce_stock_selection'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the producer function is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='builder_network_apply_inbound_events'
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the clone convergence sweep is missing';
  END IF;
  IF to_regclass('public.builder_stock_selections') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_builder_network_announce_selection'
      AND tgrelid = 'public.builder_stock_selections'::regclass
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the selections table exists but carries no producer trigger';
  END IF;
  RAISE NOTICE 'selection producer installed: outbound trigger, inbound sweep, driver scheduled';
END $$;
