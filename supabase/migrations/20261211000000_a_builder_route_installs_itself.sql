-- ===========================================================================
-- A BUILDER'S ROUTE INSTALLS ITSELF, AND A DISAGREEMENT NEVER EATS THE EVENT.
-- ===========================================================================
--
-- THE DEFECT, measured 21 Sep 2026 across both databases. A builder's stock
-- reaches this workspace only if `builder_network_connections` holds a row
-- naming that builder's organisation. Nothing ever created one except an
-- operator by hand, so every organisation registered after the first was born
-- unroutable — and silently, because the producer's routing is a join:
--
--     JOIN workspace_connections c ON i.organisation_id = c.builder_organisation_id
--
-- an empty join inserts no events, raises no error and writes no row. Three
-- builders in a row hit it. The remedy on the producer's side is to provision
-- a connection when an organisation is approved; this is the half that lets
-- the provisioning ARRIVE, because a connection the receiver has never heard
-- of cannot be used to tell the receiver about itself.
--
-- 1. `connection.authorised` — THE ROUTE TRAVELS OVER THE ROUTE THAT EXISTS.
--
-- The secret and the inbound URL are properties of the WORKSPACE ↔ NETWORK
-- channel, not of any one builder relationship: every connection this
-- workspace holds shares them. So a second builder needs no new credential —
-- only a row. The network announces it on a connection this workspace already
-- trusts, the envelope is verified exactly as every stock event is, and this
-- function writes the row. Nothing here mints, carries or stores a new
-- secret; the transport material is copied from the announcing connection,
-- which is the same material by construction.
--
-- The FIRST connection to a workspace is still an operator's act, and should
-- be: that one is a new trust relationship rather than a new builder inside
-- an existing one.
--
-- 2. AN IDENTITY MISMATCH IS A CONFIGURATION FAULT, NOT A BAD PAYLOAD.
--
-- `organisation_mismatch` was answered by `mark_inbound_refused`, which sets
-- `processed_at` — so the event was CONSUMED and never retried. A connection
-- pointing at the wrong organisation for ten minutes therefore destroyed
-- every event that arrived in those ten minutes, including a daily
-- reconciliation that will not be composed again. That is the one failure
-- mode a queue exists to prevent.
--
-- It is now a HALT on that relationship: the connection is stamped
-- `identity_mismatch_since`, one critical operational event is recorded, the
-- event is left unprocessed, and this function SKIPS that connection's events
-- until the stamp clears. Nothing is lost, nothing floods, and the state is
-- queryable. The stamp clears itself the moment the two sides agree again.
--
-- 3. THE LABEL IS DERIVED, NEVER TYPED. `builder_org_label` read
-- "Bob The Builder" on a connection carrying Mairandi Developers' stock,
-- because it was a string somebody set once. It is refreshed from the
-- organisation block of every event that lands, so a builder renaming itself
-- changes the label and nothing else — the UUID is the identity.
-- ===========================================================================

ALTER TABLE public.builder_network_connections
  ADD COLUMN IF NOT EXISTS identity_mismatch_since timestamptz,
  ADD COLUMN IF NOT EXISTS identity_mismatch_detail jsonb;

COMMENT ON COLUMN public.builder_network_connections.identity_mismatch_since IS
  'Set when a delivered payload named an organisation other than this '
  'connection''s. While set, this connection''s events are held unprocessed '
  'rather than consumed, and delivery for the relationship is halted.';

-- A route is announced over a route. Both sides key on the network''s id.
CREATE UNIQUE INDEX IF NOT EXISTS builder_network_connections_org_live_key
  ON public.builder_network_connections (builder_organisation_id)
  WHERE builder_organisation_id IS NOT NULL AND state <> 'revoked';

-- ---------------------------------------------------------------------------
-- HALT THE RELATIONSHIP, KEEP THE EVENT.
--
-- Called where a delivered payload names an organisation other than the
-- connection's. It records the fault once, stamps the connection, and leaves
-- `processed_at` NULL — the apply loop skips a stamped connection entirely,
-- so the queue neither drains into the wrong builder nor spins retrying. The
-- stamp is cleared by agreement, not by a timer: the moment the two sides
-- name the same organisation, delivery resumes with nothing lost.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_halt_identity_mismatch(
  _connection_id uuid, _event_id uuid, _event_type text,
  _connection_org uuid, _payload_org uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_already timestamptz;
BEGIN
  SELECT identity_mismatch_since INTO v_already
  FROM public.builder_network_connections WHERE id = _connection_id;

  UPDATE public.builder_network_connections
     SET identity_mismatch_since = COALESCE(identity_mismatch_since, now()),
         identity_mismatch_detail = jsonb_build_object(
           'connection_organisation_id', _connection_org,
           'payload_organisation_id', _payload_org,
           'event_type', _event_type,
           'observed_at', now()),
         updated_at = now()
   WHERE id = _connection_id;

  UPDATE public.builder_network_inbound_events
     SET apply_error = 'connection_identity_mismatch'
   WHERE id = _event_id;

  -- Once per halt, not once per event: a stopped relationship is one fault.
  IF v_already IS NULL THEN
    PERFORM public.record_portal_operational_event(
      'builder_network_connection_identity_mismatch', 'critical',
      gen_random_uuid(), _event_id::text, 'system', NULL, 'integration_worker',
      NULL, NULL, NULL, NULL, false,
      jsonb_build_object('connection_id', _connection_id,
                         'connection_organisation_id', _connection_org,
                         'payload_organisation_id', _payload_org,
                         'event_type', _event_type));
  END IF;
END $function$;

-- A worker's instrument, never a browser's. CREATE grants EXECUTE to PUBLIC
-- and this project's default privileges grant it to `anon` and
-- `authenticated` directly, so all three are closed and only the role that
-- runs the sweep is granted back. The apply loop reaches it as the definer.
REVOKE EXECUTE ON FUNCTION public.builder_network_halt_identity_mismatch(
  uuid, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_halt_identity_mismatch(
  uuid, uuid, text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.builder_network_apply_inbound_events(_limit integer DEFAULT 50)
 RETURNS TABLE(applied integer, refused integer, deferred integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event record;
  v_connection record;
  v_ref uuid;
  v_ack timestamptz;
  v_payload jsonb;
  v_item_id uuid;
  v_org_id uuid;
  v_image jsonb;
  v_image_id uuid;
  v_image_url text;
  v_ids uuid[];
  v_current bigint;
  v_new_conn uuid;
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
      -- A relationship whose two ends disagree is HELD, never consumed.
      AND NOT EXISTS (
        SELECT 1 FROM public.builder_network_connections c
        WHERE c.id = e.connection_id AND c.identity_mismatch_since IS NOT NULL)
    ORDER BY e.received_at
    LIMIT greatest(1, least(_limit, 500))
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      SELECT c.id, c.state, c.builder_organisation_id, c.network_inbound_url,
             c.outbound_hmac_secret, c.scopes
      INTO v_connection
      FROM public.builder_network_connections c WHERE c.id = v_event.connection_id;
      IF v_connection.id IS NULL OR v_connection.state = 'revoked' THEN
        PERFORM public.builder_network_mark_inbound_refused(
          v_event.id, v_event.connection_id, v_event.event_type,
          'connection_revoked', 'warning');
        v_refused := v_refused + 1;
        CONTINUE;
      END IF;

      IF v_event.event_type = 'connection.authorised' THEN
        -- ================================================================
        -- A SECOND BUILDER, ANNOUNCED OVER THE FIRST BUILDER'S CHANNEL.
        -- ================================================================
        -- Authority is the SIGNATURE: this envelope was verified against a
        -- connection this workspace already holds, and the network is the
        -- party that decides which builders a workspace may receive. The
        -- transport is copied from the announcing connection because it is
        -- the same workspace channel; no secret is minted here.
        v_payload := COALESCE(v_event.payload, '{}'::jsonb);
        BEGIN
          v_new_conn := (v_payload->>'network_connection_id')::uuid;
          v_org_id := (v_payload->>'builder_organisation_id')::uuid;
        EXCEPTION WHEN others THEN v_new_conn := NULL; v_org_id := NULL; END;
        IF v_new_conn IS NULL OR v_org_id IS NULL THEN
          PERFORM public.builder_network_mark_inbound_refused(
            v_event.id, v_connection.id, v_event.event_type,
            'invalid_payload', 'warning');
          v_refused := v_refused + 1;
          CONTINUE;
        END IF;

        INSERT INTO public.builder_network_connections(
          network_connection_id, builder_org_label, builder_organisation_id,
          state, scopes, outbound_hmac_secret, network_inbound_url,
          accepted_at, revoked_at, created_at, updated_at)
        VALUES (
          v_new_conn,
          left(COALESCE(
            nullif(btrim(COALESCE(v_payload->>'trading_name', '')), ''),
            nullif(btrim(COALESCE(v_payload->>'legal_name', '')), ''),
            'Builder'), 200),
          v_org_id,
          -- The announcement carries the network's own authorisation state.
          -- `revoked` must arrive with its stamp: the table's own CHECK
          -- refuses a terminal row that cannot say when it ended.
          CASE WHEN COALESCE(v_payload->>'state', 'active') = 'revoked'
               THEN 'revoked' ELSE 'active' END,
          COALESCE(v_connection.scopes, ARRAY['stock:publish']::text[]),
          v_connection.outbound_hmac_secret,
          v_connection.network_inbound_url,
          now(),
          CASE WHEN COALESCE(v_payload->>'state', 'active') = 'revoked'
               THEN now() ELSE NULL END,
          now(), now())
        ON CONFLICT (network_connection_id) DO UPDATE SET
          -- The organisation is the identity and is never re-pointed here:
          -- a connection that already names a different builder is a fault
          -- for the halt above to catch, not something to overwrite.
          builder_org_label = EXCLUDED.builder_org_label,
          state = EXCLUDED.state,
          revoked_at = CASE WHEN EXCLUDED.state = 'revoked'
            THEN COALESCE(public.builder_network_connections.revoked_at, now())
            ELSE NULL END,
          outbound_hmac_secret = COALESCE(
            public.builder_network_connections.outbound_hmac_secret,
            EXCLUDED.outbound_hmac_secret),
          network_inbound_url = COALESCE(
            public.builder_network_connections.network_inbound_url,
            EXCLUDED.network_inbound_url),
          updated_at = now()
        WHERE public.builder_network_connections.builder_organisation_id
                IS NOT DISTINCT FROM EXCLUDED.builder_organisation_id;

        -- Every connection needs its inbound stamp, or the badge reads
        -- nothing for a relationship that is live.
        INSERT INTO public.builder_network_stamps(connection_id, side, stamp, source_version)
        SELECT c.id, 'inbound',
               jsonb_build_object('count', 0, 'latest', NULL,
                                  'pendingRequests', 0, 'attention', 0), 0
        FROM public.builder_network_connections c
        WHERE c.network_connection_id = v_new_conn
        ON CONFLICT (connection_id, side) DO NOTHING;

        UPDATE public.builder_network_inbound_events
           SET processed_at = now(), apply_error = NULL,
               apply_attempts = apply_attempts + 1
         WHERE id = v_event.id;
        v_applied := v_applied + 1;
        v_touched := v_touched || v_connection.id;

      ELSIF v_event.event_type = 'stock.selection.acknowledged' THEN
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

      ELSIF v_event.event_type = 'stock.item.upserted' THEN
        v_payload := COALESCE(v_event.payload, '{}'::jsonb);
        BEGIN
          v_item_id := (v_payload->>'id')::uuid;
        EXCEPTION WHEN others THEN v_item_id := NULL; END;
        BEGIN
          v_org_id := (v_payload->>'organisation_id')::uuid;
        EXCEPTION WHEN others THEN v_org_id := NULL; END;
        IF v_item_id IS NULL OR v_org_id IS NULL THEN
          PERFORM public.builder_network_mark_inbound_refused(
            v_event.id, v_connection.id, v_event.event_type,
            'invalid_payload', 'warning');
          v_refused := v_refused + 1;
          CONTINUE;
        END IF;
        IF v_connection.builder_organisation_id IS NULL
           OR v_org_id <> v_connection.builder_organisation_id THEN
          PERFORM public.builder_network_halt_identity_mismatch(
            v_connection.id, v_event.id, v_event.event_type,
            v_connection.builder_organisation_id, v_org_id);
          v_deferred := v_deferred + 1;
          CONTINUE;
        END IF;

        INSERT INTO public.builder_network_stock_organisations(
          id, legal_name, trading_name, source_version, updated_at)
        VALUES (
          v_org_id,
          COALESCE(nullif(btrim(v_payload#>>'{organisation,legal_name}'), ''), 'Builder'),
          nullif(btrim(COALESCE(v_payload#>>'{organisation,trading_name}', '')), ''),
          COALESCE(v_event.source_version, 0), now())
        ON CONFLICT (id) DO UPDATE
          SET legal_name = EXCLUDED.legal_name,
              trading_name = EXCLUDED.trading_name,
              source_version = EXCLUDED.source_version,
              updated_at = now()
          WHERE EXCLUDED.source_version
                  >= public.builder_network_stock_organisations.source_version;

        -- The presentation label follows the builder's own name, always.
        UPDATE public.builder_network_connections c
           SET builder_org_label = left(COALESCE(
                 nullif(btrim(COALESCE(v_payload#>>'{organisation,trading_name}', '')), ''),
                 nullif(btrim(COALESCE(v_payload#>>'{organisation,legal_name}', '')), ''),
                 c.builder_org_label), 200),
               updated_at = now()
         WHERE c.id = v_connection.id
           AND c.builder_org_label IS DISTINCT FROM left(COALESCE(
                 nullif(btrim(COALESCE(v_payload#>>'{organisation,trading_name}', '')), ''),
                 nullif(btrim(COALESCE(v_payload#>>'{organisation,legal_name}', '')), ''),
                 c.builder_org_label), 200);

        INSERT INTO public.builder_network_stock_items(
          id, organisation_id, upload_id, first_upload_id,
          created_by_builder_user_id, external_reference, development_name,
          project_name, address_line, suburb, state, postcode, lot_number,
          unit_number, bedrooms, bathrooms, car_spaces, property_type,
          land_size_sqm, building_size_sqm, price, price_display,
          availability_status, expected_completion, description,
          lifecycle_status, enrichment_status, image_work_stage,
          source_row, manual_stats, primary_image_id, source_version,
          created_at, updated_at)
        VALUES (
          v_item_id, v_org_id,
          nullif(v_payload->>'upload_id', '')::uuid,
          nullif(v_payload->>'first_upload_id', '')::uuid,
          nullif(v_payload->>'created_by_builder_user_id', '')::uuid,
          v_payload->>'external_reference',
          v_payload->>'development_name',
          v_payload->>'project_name',
          v_payload->>'address_line',
          v_payload->>'suburb',
          v_payload->>'state',
          v_payload->>'postcode',
          v_payload->>'lot_number',
          v_payload->>'unit_number',
          nullif(v_payload->>'bedrooms', '')::numeric,
          nullif(v_payload->>'bathrooms', '')::numeric,
          nullif(v_payload->>'car_spaces', '')::numeric,
          v_payload->>'property_type',
          nullif(v_payload->>'land_size_sqm', '')::numeric,
          nullif(v_payload->>'building_size_sqm', '')::numeric,
          nullif(v_payload->>'price', '')::numeric,
          v_payload->>'price_display',
          COALESCE(nullif(btrim(COALESCE(v_payload->>'availability_status','')), ''), 'unknown'),
          v_payload->>'expected_completion',
          v_payload->>'description',
          COALESCE(nullif(btrim(COALESCE(v_payload->>'lifecycle_status','')), ''), 'active'),
          COALESCE(nullif(btrim(COALESCE(v_payload->>'enrichment_status','')), ''), 'complete'),
          COALESCE(nullif(btrim(COALESCE(v_payload->>'image_work_stage','')), ''), 'settled'),
          jsonb_strip_nulls(jsonb_build_object('house_design', v_payload->'house_design')),
          CASE WHEN jsonb_typeof(v_payload->'manual_stats') = 'object'
               THEN v_payload->'manual_stats' ELSE NULL END,
          NULL,
          COALESCE(v_event.source_version, 0),
          COALESCE(nullif(v_payload->>'item_created_at','')::timestamptz, now()),
          now())
        ON CONFLICT (id) DO UPDATE SET
          -- The supplying builder is an INVARIANT of a stock item. A payload
          -- that would move an item to another organisation is refused by the
          -- guard above and can never reach this SET, so the column is
          -- deliberately not written here: an item belongs to the builder
          -- that first supplied it, whatever any connection is re-pointed to.
          upload_id = EXCLUDED.upload_id,
          first_upload_id = EXCLUDED.first_upload_id,
          created_by_builder_user_id = EXCLUDED.created_by_builder_user_id,
          external_reference = EXCLUDED.external_reference,
          development_name = EXCLUDED.development_name,
          project_name = EXCLUDED.project_name,
          address_line = EXCLUDED.address_line,
          suburb = EXCLUDED.suburb,
          state = EXCLUDED.state,
          postcode = EXCLUDED.postcode,
          lot_number = EXCLUDED.lot_number,
          unit_number = EXCLUDED.unit_number,
          bedrooms = EXCLUDED.bedrooms,
          bathrooms = EXCLUDED.bathrooms,
          car_spaces = EXCLUDED.car_spaces,
          property_type = EXCLUDED.property_type,
          land_size_sqm = EXCLUDED.land_size_sqm,
          building_size_sqm = EXCLUDED.building_size_sqm,
          price = EXCLUDED.price,
          price_display = EXCLUDED.price_display,
          availability_status = EXCLUDED.availability_status,
          expected_completion = EXCLUDED.expected_completion,
          description = EXCLUDED.description,
          lifecycle_status = EXCLUDED.lifecycle_status,
          enrichment_status = EXCLUDED.enrichment_status,
          image_work_stage = EXCLUDED.image_work_stage,
          source_row = EXCLUDED.source_row,
          manual_stats = EXCLUDED.manual_stats,
          source_version = EXCLUDED.source_version,
          updated_at = now()
        WHERE EXCLUDED.source_version
                >= public.builder_network_stock_items.source_version
          AND public.builder_network_stock_items.organisation_id = EXCLUDED.organisation_id;

        SELECT source_version INTO v_current
        FROM public.builder_network_stock_items WHERE id = v_item_id;
        IF v_current = COALESCE(v_event.source_version, 0) THEN
          v_image := CASE WHEN jsonb_typeof(v_payload->'primary_image') = 'object'
                          THEN v_payload->'primary_image' ELSE NULL END;
          v_image_id := NULL;
          IF v_image IS NOT NULL THEN
            BEGIN
              v_image_id := (v_image->>'id')::uuid;
            EXCEPTION WHEN others THEN v_image_id := NULL; END;
          END IF;

          IF v_image_id IS NOT NULL
             AND v_connection.network_inbound_url LIKE '%/builder-network-inbound' THEN
            v_image_url := regexp_replace(
              v_connection.network_inbound_url, '/builder-network-inbound$', '')
              || '/builder-network-stock-image?id=' || v_image_id;

            INSERT INTO public.builder_network_stock_item_images(
              id, stock_item_id, organisation_id, source_stage,
              verification_status, processing_status, external_url,
              content_type, byte_size, position, source_detail,
              source_version, created_at, updated_at)
            VALUES (
              v_image_id, v_item_id, v_org_id,
              COALESCE(nullif(btrim(COALESCE(v_image->>'source_stage','')), ''), 'uploaded_document'),
              COALESCE(nullif(btrim(COALESCE(v_image->>'verification_status','')), ''), 'source_supplied'),
              COALESCE(nullif(btrim(COALESCE(v_image->>'processing_status','')), ''), 'ready'),
              v_image_url,
              v_image->>'content_type',
              nullif(v_image->>'byte_size', '')::bigint,
              0,
              CASE WHEN jsonb_typeof(v_image->'source_detail') = 'object'
                   THEN v_image->'source_detail' ELSE '{}'::jsonb END,
              COALESCE(v_event.source_version, 0), now(), now())
            ON CONFLICT (id) DO UPDATE SET
              stock_item_id = EXCLUDED.stock_item_id,
              organisation_id = EXCLUDED.organisation_id,
              source_stage = EXCLUDED.source_stage,
              verification_status = EXCLUDED.verification_status,
              processing_status = EXCLUDED.processing_status,
              external_url = EXCLUDED.external_url,
              storage_bucket = NULL,
              storage_path = NULL,
              content_type = EXCLUDED.content_type,
              byte_size = EXCLUDED.byte_size,
              position = EXCLUDED.position,
              source_detail = EXCLUDED.source_detail,
              source_version = EXCLUDED.source_version,
              updated_at = now()
            WHERE EXCLUDED.source_version
                    >= public.builder_network_stock_item_images.source_version;

            DELETE FROM public.builder_network_stock_item_images
            WHERE stock_item_id = v_item_id AND id <> v_image_id;

            UPDATE public.builder_network_stock_items
               SET primary_image_id = v_image_id
             WHERE id = v_item_id;
          ELSE
            DELETE FROM public.builder_network_stock_item_images
            WHERE stock_item_id = v_item_id;
            UPDATE public.builder_network_stock_items
               SET primary_image_id = NULL
             WHERE id = v_item_id;
          END IF;
        END IF;

        UPDATE public.builder_network_inbound_events
           SET processed_at = now(), apply_error = NULL,
               apply_attempts = apply_attempts + 1
         WHERE id = v_event.id;
        v_applied := v_applied + 1;
        v_touched := v_touched || v_connection.id;

      ELSIF v_event.event_type = 'stock.catalog.reconciled' THEN
        v_payload := COALESCE(v_event.payload, '{}'::jsonb);
        BEGIN
          v_org_id := (v_payload->>'organisation_id')::uuid;
          SELECT COALESCE(array_agg(x::uuid), '{}') INTO v_ids
          FROM jsonb_array_elements_text(v_payload->'active_item_ids') x;
        EXCEPTION WHEN others THEN v_org_id := NULL; v_ids := NULL; END;
        IF v_org_id IS NULL OR v_ids IS NULL THEN
          PERFORM public.builder_network_mark_inbound_refused(
            v_event.id, v_connection.id, v_event.event_type,
            'invalid_payload', 'warning');
          v_refused := v_refused + 1;
          CONTINUE;
        END IF;
        IF v_connection.builder_organisation_id IS NULL
           OR v_org_id <> v_connection.builder_organisation_id THEN
          PERFORM public.builder_network_halt_identity_mismatch(
            v_connection.id, v_event.id, v_event.event_type,
            v_connection.builder_organisation_id, v_org_id);
          v_deferred := v_deferred + 1;
          CONTINUE;
        END IF;

        -- ORGANISATION-SCOPED, ALWAYS. One builder's reconciliation can never
        -- reach into another builder's rows, whatever the connection carries.
        UPDATE public.builder_network_stock_items i
           SET lifecycle_status = 'archived', updated_at = now()
         WHERE i.organisation_id = v_org_id
           AND i.lifecycle_status = 'active'
           AND i.source_version < COALESCE(v_event.source_version, 0)
           AND NOT (i.id = ANY (v_ids));

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
END $function$;

-- ---------------------------------------------------------------------------
-- AGREEMENT CLEARS THE HALT.
--
-- Held events name the organisation they were composed for. When the
-- connection comes to name the same one, the relationship is consistent again
-- and delivery resumes — so the clearing is derived from the held events
-- rather than from an operator remembering to reset a flag.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_clear_settled_mismatches()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_cleared integer := 0;
BEGIN
  WITH settled AS (
    SELECT c.id
    FROM public.builder_network_connections c
    WHERE c.identity_mismatch_since IS NOT NULL
      AND c.builder_organisation_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.builder_network_inbound_events e
        WHERE e.connection_id = c.id
          AND e.processed_at IS NULL
          AND e.apply_error = 'connection_identity_mismatch'
          AND COALESCE(nullif(e.payload->>'organisation_id', ''), '')
              <> c.builder_organisation_id::text)
  )
  UPDATE public.builder_network_connections c
     SET identity_mismatch_since = NULL,
         identity_mismatch_detail = NULL,
         updated_at = now()
    FROM settled s WHERE c.id = s.id;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  RETURN v_cleared;
END $function$;

REVOKE EXECUTE ON FUNCTION public.builder_network_clear_settled_mismatches()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_clear_settled_mismatches()
  TO service_role;

-- ---------------------------------------------------------------------------
-- WHAT THIS WORKSPACE ACTUALLY RECEIVES, PER BUILDER.
--
-- A view rather than a written table, so it cannot disagree with the rows it
-- describes — the failure this whole change exists to end.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.builder_network_receive_state
WITH (security_invoker = true) AS
SELECT
  c.id                                AS connection_id,
  c.network_connection_id,
  c.builder_organisation_id,
  COALESCE(o.trading_name, o.legal_name, c.builder_org_label) AS builder_label,
  c.state,
  c.identity_mismatch_since,
  (SELECT count(*) FROM public.builder_network_inbound_events e
    WHERE e.connection_id = c.id AND e.processed_at IS NULL)  AS events_waiting,
  (SELECT count(*) FROM public.builder_network_stock_items i
    WHERE i.organisation_id = c.builder_organisation_id
      AND i.lifecycle_status = 'active')                      AS mirrored_active_items,
  (SELECT max(i.updated_at) FROM public.builder_network_stock_items i
    WHERE i.organisation_id = c.builder_organisation_id)      AS last_item_at,
  CASE
    WHEN c.state = 'revoked'                    THEN 'revoked'
    WHEN c.identity_mismatch_since IS NOT NULL  THEN 'identity_mismatch'
    WHEN c.state <> 'active'                    THEN 'not_authorised'
    WHEN (SELECT count(*) FROM public.builder_network_inbound_events e
           WHERE e.connection_id = c.id AND e.processed_at IS NULL) > 0
                                                THEN 'syncing'
    ELSE 'synced'
  END                                                          AS receive_state
FROM public.builder_network_connections c
LEFT JOIN public.builder_network_stock_organisations o
  ON o.id = c.builder_organisation_id;

COMMENT ON VIEW public.builder_network_receive_state IS
  'Per-builder truth about what this workspace receives: authorisation, '
  'events waiting, mirrored active items, and whether the two sides agree.';
