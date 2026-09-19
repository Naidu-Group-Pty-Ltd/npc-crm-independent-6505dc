-- ============================================================================
-- Builders Network Phase 7, wave 5 — the marketplace mirrors the network's
-- REAL stock, and an activation says who is asking (plan §3 E4/E5).
--
-- Wave 4 made selection events travel. Two gaps remained, and each one makes
-- the Activate button a lie in production:
--
--   THE MIRROR IS A SEED, NOT A SYNC. `builder_network_stock_*` was seeded
--   from the portal tables at extraction time and updated by nothing since.
--   Its "active" rows are properties the network has archived; the network's
--   current stock is absent. An adviser can only activate what a card shows,
--   and every card shows history. This wave adds the CONSUMER half of the
--   stock mirror sync — the network composes `stock.item.upserted` and
--   `stock.catalog.reconciled` into the same connection outbox that already
--   carries acknowledgements, and THIS sweep converges them into the mirror.
--
--   THE BUILDER LEARNS *THAT*, NEVER *WHO*. The announcement payload carried
--   no agency identity — deliberately, until the product owner decided
--   otherwise. That decision is now taken: the builder receiving an
--   activation must see WHICH agency activated and how to reach them. The
--   producer now composes an `agency` block carrying the ACTING ADVISER's
--   name, email and phone — the agency's own outward contact, composed key
--   by key from `custom_users`. It is not client PII (the client's ref and
--   label rules are untouched), not an internal note, and not a staff id —
--   the privacy contract's forbidden sets stand unchanged and every gate
--   still throws on all of them. The agency's DISPLAY NAME is directory
--   data the network already holds (`workspace_registry`, asserted at
--   provisioning), so it does not ride the event.
--
-- The mirror convergence idiom is wave 4's, unchanged: a webhook is not
-- delivery, the sweep is; idempotent by dedupe key at the door and monotonic
-- by `source_version` per row here, so replays and out-of-order retries
-- cannot wind a card backwards.
--
-- IMAGES: METADATA CROSSES, BYTES DO NOT. An item event names its primary
-- image and its display-rule record; this consumer points the mirror row's
-- `external_url` at the network's public stock-image door (derived from the
-- connection's own `network_inbound_url` — no environment-specific URL is
-- written into a migration). The network serves the same bytes its own
-- portal card would serve, under the same client-visibility invariant, and
-- a photograph re-sanitised there changes here without another event.
-- ============================================================================

-- ===========================================================================
-- 1. The producer discloses the agency contact (authorised, key by key)
-- ===========================================================================
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

  -- THE AGENCY BLOCK — the workspace's authorised self-disclosure. The
  -- acting adviser's outward contact, read from custom_users at compose
  -- time and built key by key: no id crosses, no row is spread, and a
  -- deleted or inactive user composes an empty block rather than a stale
  -- identity. The agency's display NAME is the network's directory data
  -- (workspace_registry) and deliberately does not ride the event.
  SELECT nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS contact_name,
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
    jsonb_strip_nulls(jsonb_build_object(
      'remote_selection_ref', NEW.id,
      'stock_item_id', NEW.stock_item_id,
      'status', NEW.status,
      'agency', v_agency)),
    v_version)
  ON CONFLICT (dedupe_key) DO NOTHING;

  RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_announce_stock_selection()
  FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 2. The clone's convergence sweep learns the stock mirror events
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.builder_network_apply_inbound_events(
  _limit integer DEFAULT 50)
RETURNS TABLE (applied integer, refused integer, deferred integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
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
      SELECT c.id, c.state, c.builder_organisation_id, c.network_inbound_url
      INTO v_connection
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
        -- The connection's mapped organisation is the authority; a payload
        -- claiming another organisation's stock is refused by name.
        IF v_connection.builder_organisation_id IS NULL
           OR v_org_id <> v_connection.builder_organisation_id THEN
          PERFORM public.builder_network_mark_inbound_refused(
            v_event.id, v_connection.id, v_event.event_type,
            'organisation_mismatch', 'critical');
          v_refused := v_refused + 1;
          CONTINUE;
        END IF;

        -- The builder's identity row, monotonic like everything else.
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

        -- The projection, column by column. Absent keys read as NULL; the
        -- version guard keeps a delayed retry from winding a card back.
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
          -- Never the builder's raw row: exactly the one key the
          -- marketplace reads from it.
          jsonb_strip_nulls(jsonb_build_object('house_design', v_payload->'house_design')),
          CASE WHEN jsonb_typeof(v_payload->'manual_stats') = 'object'
               THEN v_payload->'manual_stats' ELSE NULL END,
          NULL,
          COALESCE(v_event.source_version, 0),
          COALESCE(nullif(v_payload->>'item_created_at','')::timestamptz, now()),
          now())
        ON CONFLICT (id) DO UPDATE SET
          organisation_id = EXCLUDED.organisation_id,
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
                >= public.builder_network_stock_items.source_version;

        -- Did our write win? Equal means yes (or an idempotent replay of the
        -- same version); greater means a newer event already landed and the
        -- image pointer is ITS to set, not this event's.
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
            -- The network serves its own bytes: the mirror row points at the
            -- network's public stock-image door, derived from the same
            -- transport configuration that already addresses deliveries.
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
              -- The mirror serves the network's door, never a stale local
              -- object from the seeded era.
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

            -- One primary, and only it: seeded-era siblings would otherwise
            -- keep outranking the network's own choice in the card ordering.
            DELETE FROM public.builder_network_stock_item_images
            WHERE stock_item_id = v_item_id AND id <> v_image_id;

            UPDATE public.builder_network_stock_items
               SET primary_image_id = v_image_id
             WHERE id = v_item_id;
          ELSE
            -- No provable builder image means NO image — the empty frame is
            -- the honest card, exactly as the network's own rule reads.
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
          PERFORM public.builder_network_mark_inbound_refused(
            v_event.id, v_connection.id, v_event.event_type,
            'organisation_mismatch', 'critical');
          v_refused := v_refused + 1;
          CONTINUE;
        END IF;

        -- Archive what the network no longer lists. The per-row version
        -- guard is what makes a DELAYED reconcile safe: an item upserted
        -- after the snapshot carries a later version and stays.
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
END $fn$;

REVOKE ALL ON FUNCTION public.builder_network_apply_inbound_events(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_apply_inbound_events(integer)
  TO service_role;

COMMENT ON FUNCTION public.builder_network_apply_inbound_events(integer) IS
  'The clone''s inbound convergence sweep: stock.selection.acknowledged onto builder_stock_selections, stock.item.upserted / stock.catalog.reconciled onto the builder_network_stock_* mirror. Idempotent, replayable, monotonic per row. Driven by pg_cron and opportunistically after each landing in builder-network-inbound.';

-- ===========================================================================
-- 3. Post-migration assertions
-- ===========================================================================
DO $$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.builder_network_announce_stock_selection()'::regprocedure);
  IF position('agency' IN v_def) = 0 OR position('custom_users' IN v_def) = 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the producer does not disclose the agency contact';
  END IF;
  IF position('client_id' IN v_def) > 0 OR position('internal_notes' IN v_def) > 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the producer references fields the contract forbids';
  END IF;

  v_def := pg_get_functiondef('public.builder_network_apply_inbound_events(integer)'::regprocedure);
  IF position('stock.item.upserted' IN v_def) = 0
     OR position('stock.catalog.reconciled' IN v_def) = 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the sweep does not converge the stock mirror';
  END IF;
  IF position('builder-network-stock-image' IN v_def) = 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: mirror images would not point at the network''s door';
  END IF;
  IF position('stock.selection.acknowledged' IN v_def) = 0 THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the sweep lost the acknowledgement branch';
  END IF;

  RAISE NOTICE 'stock mirror consumer + agency disclosure installed';
END $$;
