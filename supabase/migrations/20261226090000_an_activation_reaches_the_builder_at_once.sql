-- ============================================================================
-- An activation reaches the builder at once, not on the next minute.
--
-- Measured on production (26 Sep 2026): ~91 s from a Command Centre
-- activation to the Builder Portal. The Builders Network applies an inbound
-- event on receipt; the wait was HERE. This producer queued the outbox row and
-- nothing delivered it until `cross-portal-outbox-worker-1min` next ran,
-- while every agency-message path already calls `builder_network_kick_outbox()`
-- — the signed (`agency_message` caller), fire-after-commit kick of that same
-- worker.
--
-- THE ONLY CHANGE: after the row is queued — and only if it was, since a
-- duplicate dedupe key queues nothing — the producer kicks the worker. The body
-- is otherwise the one 20261201100000 defined, clause for clause: the same
-- gates, the same privacy-bounded payload, the same versioned dedupe key, the
-- same `username` fallback for the contact name.
--
-- Unchanged guarantees: the outbox row is written in the selection's own
-- transaction (a rolled-back activation sends nothing, and pg_net sends the
-- kick only after commit); the worker claims with SKIP LOCKED and a lease, so
-- a kick racing the minute tick cannot deliver twice; the network's door and
-- `source_version` guard stay idempotent; the minute schedule stays as the
-- recovery path.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.builder_network_announce_stock_selection()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_flag boolean;
  v_connection uuid;
  v_event_type text;
  v_version bigint;
  v_contact record;
  v_agency jsonb;
BEGIN
  IF NEW.status = 'builder_acknowledged' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.stock_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (value = 'true'::jsonb) INTO v_flag
  FROM public.feature_flags WHERE key = 'builder_network_enabled';
  IF v_flag IS DISTINCT FROM true THEN
    RETURN NEW;
  END IF;

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

  -- The structured name when it exists; the display name the Command Centre
  -- actually shows otherwise. Key by key, active users only, never an id.
  SELECT COALESCE(
           nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
           nullif(btrim(COALESCE(u.username, '')), '')) AS contact_name,
         nullif(btrim(COALESCE(u.email, '')), '') AS contact_email,
         nullif(btrim(COALESCE(u.phone, '')), '') AS contact_phone
  INTO v_contact
  FROM public.custom_users u
  WHERE u.id = NEW.selected_by_user_id
    AND u.is_active = true AND u.deleted_at IS NULL;

  v_agency := jsonb_strip_nulls(jsonb_build_object(
    'contact_name', v_contact.contact_name,
    'contact_email', v_contact.contact_email,
    'contact_phone', v_contact.contact_phone));
  IF v_agency = '{}'::jsonb THEN v_agency := NULL; END IF;

  INSERT INTO public.builder_network_outbox(
    connection_id, event_type, dedupe_key, payload, source_version)
  VALUES (
    v_connection,
    v_event_type,
    'stock.selection:' || NEW.id || ':' || v_version,
    jsonb_strip_nulls(jsonb_build_object(
      'remote_selection_ref', NEW.id,
      'stock_item_id', NEW.stock_item_id,
      'status', NEW.status,
      'agency', v_agency)),
    v_version)
  ON CONFLICT (dedupe_key) DO NOTHING;
  IF FOUND THEN
    -- Deliver now, not on the next minute: the same signed kick every message
    -- path uses. pg_net sends it only after this transaction commits, a failure
    -- is swallowed inside the kick, and the minute schedule remains the
    -- recovery path for anything a kick does not reach.
    PERFORM public.builder_network_kick_outbox();
  END IF;

  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_announce_stock_selection()
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_def text := pg_get_functiondef('public.builder_network_announce_stock_selection()'::regprocedure);
BEGIN
  IF position('builder_network_kick_outbox' IN v_def) = 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the activation producer does not kick the outbox worker';
  END IF;
  IF position('username' IN v_def) = 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the contact name lost its display-name fallback';
  END IF;
  RAISE NOTICE 'the activation producer kicks the outbox worker';
END $$;
