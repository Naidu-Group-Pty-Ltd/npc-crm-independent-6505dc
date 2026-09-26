-- ===========================================================================
-- A property brings its photographs and documents — and they converge BESIDE
-- it, never inside it.
--
-- The Builders Network sends each property as one signed `stock.item.upserted`
-- event, and `builder_network_apply_inbound_events` turns it into the mirror
-- row a marketplace card draws. That sweep is unchanged here, on purpose: it is
-- ~17 kB of convergence logic that a whole marketplace depends on, and a media
-- system grown inside it would put every property at the mercy of its
-- photographs.
--
-- The network now adds a versioned `media` block to the same event:
--
--   media: {
--     schema_version: 1,
--     photos:    [{ id, content_type }],          -- 0..12, in display order
--     documents: [{ id, kind, label, url }]       -- 0..12, typed links
--   }
--
-- and a SEPARATE sweep converges it, in the shape the ranking converger set
-- (`20261202090000`): its own stamp on the event, its own cron job, its own
-- tables. Four rules carry it.
--
--   * THE PROPERTY FIRST. The sweep reads an event only after the main sweep
--     has consumed it, and only onto a mirror row the connection's own builder
--     owns. A signed event is not an ownership proof: the connection's mapped
--     organisation, the payload's organisation and the mirror row's organisation
--     must all be the same builder, re-read at apply time.
--
--   * THE CURRENT STATE, NOT A LOG. A media block is the WHOLE set. What it
--     names is upserted in the order given; what it does not name is deleted.
--     So a reorder, a replacement, a removal and a replay all converge to the
--     same rows, and a later block cannot be wound back by an older one
--     (`builder_network_stock_item_media.media_version`).
--
--   * NO BLOCK IS NOT AN EMPTY BLOCK. Every event sent before the network
--     composed media carries none, and reading that as "zero photographs" would
--     empty every gallery on the first old event replayed. An event with no
--     block is stamped `no_media` and changes nothing.
--
--   * A MEDIA FAILURE NEVER REACHES THE PROPERTY. A malformed block is refused
--     WHOLE (nothing half-applied) and reported; an apply that throws is
--     retried on the next tick, five times, then dead-lettered with a critical
--     operational event — the main sweep's own bound. Nothing here writes
--     `builder_network_stock_items` or the card's image table.
--
-- Photographs are served the way the card's primary image already is: through
-- the network's own image door, which re-checks on every request that the image
-- is one the builder currently publishes. No storage path crosses, no bytes are
-- copied, and nothing new is made public.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The tables. Service-role only, like every table of the sync plane: the
--    browser reads a property through `builder-stock-marketplace`, never here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.builder_network_stock_item_media (
  stock_item_id uuid PRIMARY KEY
    REFERENCES public.builder_network_stock_items(id) ON DELETE CASCADE,
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  -- The event's `source_version`: the network's clock for this property.
  media_version bigint NOT NULL,
  photo_count smallint NOT NULL CHECK (photo_count BETWEEN 0 AND 12),
  document_count smallint NOT NULL CHECK (document_count BETWEEN 0 AND 12),
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.builder_network_stock_item_photos (
  stock_item_id uuid NOT NULL
    REFERENCES public.builder_network_stock_items(id) ON DELETE CASCADE,
  -- The network's own image id: stable across replay, reorder and retry.
  upstream_image_id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
  external_url text NOT NULL,
  content_type text,
  media_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stock_item_id, upstream_image_id)
);

CREATE TABLE IF NOT EXISTS public.builder_network_stock_item_documents (
  stock_item_id uuid NOT NULL
    REFERENCES public.builder_network_stock_items(id) ON DELETE CASCADE,
  -- The network's key for the link (a digest of its URL): stable across replay.
  document_key text NOT NULL CHECK (document_key ~ '^[0-9a-f]{32}$'),
  organisation_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 11),
  kind text NOT NULL
    CHECK (kind IN ('brochure', 'floor_plan', 'site_plan', 'estate', 'other')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  url text NOT NULL CHECK (url ~* '^https?://[^[:space:]]+$' AND length(url) <= 2048),
  media_version bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stock_item_id, document_key)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'builder_network_stock_item_media',
    'builder_network_stock_item_photos',
    'builder_network_stock_item_documents'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_service ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. The sweep's own stamp on the event. Its PRESENCE is the guard, never its
--    outcome: an event is stamped whether it applied, carried nothing or was
--    refused, so nothing is rescanned for ever.
-- ---------------------------------------------------------------------------
ALTER TABLE public.builder_network_inbound_events
  ADD COLUMN IF NOT EXISTS media_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS media_apply_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS media_apply_error text;

COMMENT ON COLUMN public.builder_network_inbound_events.media_applied_at IS
  'When the media sweep settled this event (applied, no_media, superseded, refused or dead — media_apply_error says which). NULL means not yet.';

CREATE INDEX IF NOT EXISTS builder_network_inbound_events_media_pending_idx
  ON public.builder_network_inbound_events (received_at)
  WHERE media_applied_at IS NULL AND event_type = 'stock.item.upserted';

-- Every event already consumed before this migration was composed before the
-- network sent media, so it carries no block: settle it the way the sweep
-- would (`no_media`, nothing changed) rather than make the first ticks crawl
-- through thousands of them ahead of the first event that does carry media.
UPDATE public.builder_network_inbound_events
   SET media_applied_at = now(), media_apply_error = 'no_media'
 WHERE media_applied_at IS NULL
   AND event_type = 'stock.item.upserted'
   AND processed_at IS NOT NULL
   AND NOT (payload ? 'media');

-- ---------------------------------------------------------------------------
-- 3. The sweep.
-- ---------------------------------------------------------------------------
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
        PERFORM public.record_portal_operational_event(
          'builder_network_media_refused',
          CASE WHEN v_reason IN ('property_organisation_mismatch', 'connection_organisation_mismatch',
                                 'invalid_media', 'unsupported_media_version')
               THEN 'critical' ELSE 'warning' END,
          gen_random_uuid(), v_event.id::text, 'system', NULL, 'integration_worker',
          NULL, NULL, NULL, NULL, false,
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
        PERFORM public.record_portal_operational_event(
          'builder_network_media_apply_dead', 'critical',
          gen_random_uuid(), v_event.id::text, 'system', NULL, 'integration_worker',
          NULL, NULL, NULL, NULL, false,
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

COMMENT ON FUNCTION public.builder_network_apply_stock_media(integer) IS
  'Converges the media block of stock.item.upserted events (photos and typed document links) onto their own tables, after the main sweep has consumed the event. Separate from builder_network_apply_inbound_events so a media failure can never reach the property.';

-- ---------------------------------------------------------------------------
-- 4. Its own tick, beside the ranking converger's.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'builder-network-media-apply-1min') THEN
      PERFORM cron.schedule(
        'builder-network-media-apply-1min',
        '* * * * *',
        $job$SELECT public.builder_network_apply_stock_media(200);$job$
      );
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Asserted by effect.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('authenticated',
       'public.builder_network_apply_stock_media(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'builder_network_apply_stock_media is executable by authenticated';
  END IF;
  IF has_table_privilege('anon', 'public.builder_network_stock_item_photos', 'SELECT')
     OR has_table_privilege('authenticated', 'public.builder_network_stock_item_documents', 'SELECT') THEN
    RAISE EXCEPTION 'a media table is readable by a browser role';
  END IF;
END $$;

COMMIT;
