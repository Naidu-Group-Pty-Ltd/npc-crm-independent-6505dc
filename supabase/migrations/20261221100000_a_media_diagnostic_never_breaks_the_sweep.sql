-- ===========================================================================
-- A diagnostic must never break the thing it diagnoses.
--
-- The media sweep (`20261221090000`) records an operational event when it
-- refuses a media block and when it dead-letters one. Its first production
-- proof (25 Sep 2026) found that the recorder, `record_portal_operational_event`,
-- throws on ordinary metadata: its privacy screen is the jsonpath
-- `$.**.keyvalue()`, which walks into every scalar, and `.keyvalue()` refuses
-- anything that is not an object. So:
--
--   * a refusal was rolled back with the recorder's error and retried, rather
--     than stamped once;
--   * on the fifth attempt the dead-letter path called the same recorder
--     inside the exception handler, where nothing catches it — the whole
--     sweep would abort, roll back the batch, and every media event behind
--     that one would wait for ever.
--
-- The recorder's screen is a shared privacy control and is reported
-- separately rather than changed here. What this migration guarantees is that
-- the media sweep's own diagnostics can never fail it: they go through
-- `builder_network_media_note`, which swallows a recorder failure into a
-- database WARNING. The refusal or dead-letter stamp on the event — the
-- durable record — always stands.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.builder_network_media_note(
  _event_name text, _severity text, _event_id uuid, _metadata jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  BEGIN
    PERFORM public.record_portal_operational_event(
      _event_name, _severity, gen_random_uuid(), _event_id::text, 'system', NULL,
      'integration_worker', NULL, NULL, NULL, NULL, false, _metadata);
  EXCEPTION WHEN others THEN
    RAISE WARNING '% for inbound event % could not be recorded: %', _event_name, _event_id, SQLERRM;
  END;
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_media_note(text, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_media_note(text, text, uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.builder_network_apply_stock_media(
  _limit integer DEFAULT 200)
RETURNS TABLE (applied integer, skipped integer, refused integer, deferred integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_event record;
  v_connection record;
  v_media jsonb;
  v_item_id uuid;
  v_org uuid;
  v_owner uuid;
  v_current bigint;
  v_version bigint;
  v_image_base text;
  v_photo_ids uuid[];
  v_doc_keys text[];
  v_reason text;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_refused integer := 0;
  v_deferred integer := 0;
BEGIN
  FOR v_event IN
    SELECT e.id, e.connection_id, e.payload, e.source_version, e.media_apply_attempts
    FROM public.builder_network_inbound_events e
    WHERE e.media_applied_at IS NULL
      AND e.event_type = 'stock.item.upserted'
      -- The property first: only what the main sweep has already consumed.
      AND e.processed_at IS NOT NULL
    ORDER BY e.received_at, e.id
    LIMIT greatest(1, least(_limit, 1000))
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_media := v_event.payload->'media';
      v_version := COALESCE(v_event.source_version, 0);
      v_reason := NULL;

      -- No block: an event composed before media existed. Nothing to do, and
      -- emphatically not "zero photographs".
      IF v_media IS NULL OR jsonb_typeof(v_media) = 'null' THEN
        UPDATE public.builder_network_inbound_events
           SET media_applied_at = now(), media_apply_error = 'no_media'
         WHERE id = v_event.id;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      BEGIN
        v_item_id := (v_event.payload->>'id')::uuid;
        v_org := (v_event.payload->>'organisation_id')::uuid;
      EXCEPTION WHEN others THEN
        v_item_id := NULL; v_org := NULL;
      END;

      SELECT c.id, c.state, c.builder_organisation_id, c.network_inbound_url
        INTO v_connection
        FROM public.builder_network_connections c
       WHERE c.id = v_event.connection_id;

      -- Ownership, re-read now: the connection's builder, the payload's builder
      -- and the mirror row's builder must be one and the same.
      SELECT i.organisation_id INTO v_owner
        FROM public.builder_network_stock_items i WHERE i.id = v_item_id;

      IF jsonb_typeof(v_media) <> 'object' THEN
        v_reason := 'invalid_media';
      ELSIF v_media->'schema_version' IS DISTINCT FROM '1'::jsonb THEN
        v_reason := 'unsupported_media_version';
      ELSIF v_item_id IS NULL OR v_org IS NULL THEN
        v_reason := 'invalid_payload';
      ELSIF v_connection.id IS NULL OR v_connection.state <> 'active' THEN
        v_reason := 'connection_not_active';
      ELSIF v_connection.builder_organisation_id IS NULL
            OR v_connection.builder_organisation_id <> v_org THEN
        v_reason := 'connection_organisation_mismatch';
      ELSIF v_owner IS NULL THEN
        v_reason := 'property_not_mirrored';
      ELSIF v_owner <> v_org THEN
        v_reason := 'property_organisation_mismatch';
      ELSIF COALESCE(v_connection.network_inbound_url, '') !~ '/builder-network-inbound$' THEN
        v_reason := 'no_image_route';
      ELSIF jsonb_typeof(COALESCE(v_media->'photos', '[]'::jsonb)) <> 'array'
         OR jsonb_typeof(COALESCE(v_media->'documents', '[]'::jsonb)) <> 'array'
         OR jsonb_array_length(COALESCE(v_media->'photos', '[]'::jsonb)) > 12
         OR jsonb_array_length(COALESCE(v_media->'documents', '[]'::jsonb)) > 12 THEN
        v_reason := 'invalid_media';
      ELSIF EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_media->'photos', '[]'::jsonb)) p
        WHERE jsonb_typeof(p) <> 'object'
           OR COALESCE(p->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      OR (SELECT count(DISTINCT lower(p->>'id')) <> count(*)
            FROM jsonb_array_elements(COALESCE(v_media->'photos', '[]'::jsonb)) p)
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_media->'documents', '[]'::jsonb)) d
        WHERE jsonb_typeof(d) <> 'object'
           OR COALESCE(d->>'id', '') !~ '^[0-9a-f]{32}$'
           OR COALESCE(d->>'kind', '') NOT IN ('brochure', 'floor_plan', 'site_plan', 'estate', 'other')
           OR length(btrim(COALESCE(d->>'label', ''))) NOT BETWEEN 1 AND 200
           OR COALESCE(d->>'url', '') !~* '^https?://[^[:space:]]+$'
           OR length(d->>'url') > 2048)
      OR (SELECT count(DISTINCT d->>'id') <> count(*)
            FROM jsonb_array_elements(COALESCE(v_media->'documents', '[]'::jsonb)) d) THEN
        v_reason := 'invalid_media';
      END IF;

      IF v_reason IS NOT NULL THEN
        UPDATE public.builder_network_inbound_events
           SET media_applied_at = now(), media_apply_error = 'refused:' || v_reason
         WHERE id = v_event.id;
        PERFORM public.builder_network_media_note(
          'builder_network_media_refused',
          CASE WHEN v_reason IN ('property_organisation_mismatch', 'connection_organisation_mismatch',
                                 'invalid_media', 'unsupported_media_version')
               THEN 'critical' ELSE 'warning' END,
          v_event.id,
          jsonb_build_object('event_id', v_event.id, 'connection_id', v_event.connection_id,
                             'stock_item_id', v_item_id, 'reason', v_reason));
        v_refused := v_refused + 1;
        CONTINUE;
      END IF;

      -- Monotonic by the network's own clock. An equal version re-converges
      -- (a replay heals rather than skips); an older one changes nothing.
      SELECT m.media_version INTO v_current
        FROM public.builder_network_stock_item_media m
       WHERE m.stock_item_id = v_item_id
       FOR UPDATE;
      IF v_current IS NOT NULL AND v_current > v_version THEN
        UPDATE public.builder_network_inbound_events
           SET media_applied_at = now(), media_apply_error = 'superseded'
         WHERE id = v_event.id;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_image_base := regexp_replace(v_connection.network_inbound_url, '/builder-network-inbound$', '')
        || '/builder-network-stock-image?id=';

      -- Photographs: the whole set, in the order sent.
      SELECT COALESCE(array_agg(lower(p->>'id')::uuid ORDER BY n), '{}')
        INTO v_photo_ids
        FROM jsonb_array_elements(COALESCE(v_media->'photos', '[]'::jsonb)) WITH ORDINALITY AS x(p, n);

      DELETE FROM public.builder_network_stock_item_photos
       WHERE stock_item_id = v_item_id
         AND NOT (upstream_image_id = ANY (v_photo_ids));

      INSERT INTO public.builder_network_stock_item_photos(
        stock_item_id, upstream_image_id, organisation_id, connection_id, position,
        external_url, content_type, media_version)
      SELECT v_item_id, lower(p->>'id')::uuid, v_org, v_connection.id, (n - 1)::smallint,
             v_image_base || lower(p->>'id'),
             nullif(left(btrim(COALESCE(p->>'content_type', '')), 100), ''),
             v_version
        FROM jsonb_array_elements(COALESCE(v_media->'photos', '[]'::jsonb)) WITH ORDINALITY AS x(p, n)
      ON CONFLICT (stock_item_id, upstream_image_id) DO UPDATE SET
        organisation_id = EXCLUDED.organisation_id,
        connection_id = EXCLUDED.connection_id,
        position = EXCLUDED.position,
        external_url = EXCLUDED.external_url,
        content_type = EXCLUDED.content_type,
        media_version = EXCLUDED.media_version,
        updated_at = now();

      -- Documents: the same, separately. A document is never a photograph.
      SELECT COALESCE(array_agg(d->>'id' ORDER BY n), '{}')
        INTO v_doc_keys
        FROM jsonb_array_elements(COALESCE(v_media->'documents', '[]'::jsonb)) WITH ORDINALITY AS x(d, n);

      DELETE FROM public.builder_network_stock_item_documents
       WHERE stock_item_id = v_item_id
         AND NOT (document_key = ANY (v_doc_keys));

      INSERT INTO public.builder_network_stock_item_documents(
        stock_item_id, document_key, organisation_id, connection_id, position,
        kind, label, url, media_version)
      SELECT v_item_id, d->>'id', v_org, v_connection.id, (n - 1)::smallint,
             d->>'kind', btrim(d->>'label'), d->>'url', v_version
        FROM jsonb_array_elements(COALESCE(v_media->'documents', '[]'::jsonb)) WITH ORDINALITY AS x(d, n)
      ON CONFLICT (stock_item_id, document_key) DO UPDATE SET
        organisation_id = EXCLUDED.organisation_id,
        connection_id = EXCLUDED.connection_id,
        position = EXCLUDED.position,
        kind = EXCLUDED.kind,
        label = EXCLUDED.label,
        url = EXCLUDED.url,
        media_version = EXCLUDED.media_version,
        updated_at = now();

      INSERT INTO public.builder_network_stock_item_media(
        stock_item_id, organisation_id, connection_id, media_version,
        photo_count, document_count, applied_at)
      VALUES (v_item_id, v_org, v_connection.id, v_version,
              cardinality(v_photo_ids), cardinality(v_doc_keys), now())
      ON CONFLICT (stock_item_id) DO UPDATE SET
        organisation_id = EXCLUDED.organisation_id,
        connection_id = EXCLUDED.connection_id,
        media_version = EXCLUDED.media_version,
        photo_count = EXCLUDED.photo_count,
        document_count = EXCLUDED.document_count,
        applied_at = now();

      UPDATE public.builder_network_inbound_events
         SET media_applied_at = now(), media_apply_error = NULL,
             media_apply_attempts = media_apply_attempts + 1
       WHERE id = v_event.id;
      v_applied := v_applied + 1;

    EXCEPTION WHEN others THEN
      -- Everything this event wrote is rolled back with the block, so a
      -- retried event converges from where the last GOOD one left the rows.
      IF v_event.media_apply_attempts + 1 >= 5 THEN
        UPDATE public.builder_network_inbound_events
           SET media_applied_at = now(),
               media_apply_attempts = media_apply_attempts + 1,
               media_apply_error = left('dead:' || SQLERRM, 500)
         WHERE id = v_event.id;
        PERFORM public.builder_network_media_note(
          'builder_network_media_apply_dead', 'critical',
          v_event.id,
          jsonb_build_object('event_id', v_event.id, 'connection_id', v_event.connection_id,
                             'error', left(SQLERRM, 200)));
        v_refused := v_refused + 1;
      ELSE
        UPDATE public.builder_network_inbound_events
           SET media_apply_attempts = media_apply_attempts + 1,
               media_apply_error = left(SQLERRM, 500)
         WHERE id = v_event.id;
        v_deferred := v_deferred + 1;
      END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_applied, v_skipped, v_refused, v_deferred;
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_apply_stock_media(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_apply_stock_media(integer) TO service_role;

-- Asserted by effect: neither is reachable from a browser role.
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.builder_network_apply_stock_media(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.builder_network_media_note(text, text, uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a media sweep function is executable by authenticated';
  END IF;
END $$;

COMMIT;
