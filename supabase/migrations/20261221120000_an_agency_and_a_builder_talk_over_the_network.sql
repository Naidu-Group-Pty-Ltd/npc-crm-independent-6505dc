-- ============================================================================
-- An agency and a builder talk about an activated property, over the signed
-- network. The Command Centre's half.
--
-- The Builders Network's half is aurixa-builders'
-- `20260925180000_an_agency_and_a_builder_talk_over_the_network.sql`; the two
-- share one contract, written out in
-- `docs/builder-portal/51-an-agency-and-a-builder-talk.md`.
--
-- WHAT A CONVERSATION IS. One per (connection, property), and its id is
-- DERIVED — md5('agency.conversation:' || network connection id || ':' ||
-- stock item id) — so both ends compute the same id without asking each
-- other, repeated "start" attempts converge, and a payload naming a different
-- conversation is refused rather than trusted. It exists only while the
-- property is activated here (a live `builder_stock_selections` row). The
-- person whose activation opened it owns it (`owner_user_id`); anyone with
-- Listings edit access writes into it as themselves.
--
-- WHAT A MESSAGE IS. Written here with a globally unique id and carried to
-- the network as `agency.message.posted`. The same send repeated (a lost
-- response, a double click) is the same row, because the browser's
-- `client_message_id` is unique per sender. A message from the builder is
-- stored under the BUILDER's id, so a redelivery converges to one row.
--
-- DELIVERED MEANS ACCEPTED. The door's 200 only says the envelope landed; the
-- network's sweep applies it and answers with `agency.message.receipt`. Only
-- an accepted receipt marks a message delivered; a refusal, or an outbox row
-- that dead-letters, marks it failed, and a retry re-sends it under a new
-- generation.
--
-- ITS OWN LANE. The main sweep refuses an event type it does not know,
-- terminally. A BEFORE INSERT trigger marks message events consumed for the
-- main sweep the moment they land, and this sweep keeps its own stamp
-- (`message_applied_at`) — the media sweep's precedent. The main, media and
-- rank sweeps are not changed.
--
-- NOTHING ELSE CROSSES. The payload is composed key by key: ids, the body the
-- person typed, their display name and the server's timestamp. No user id,
-- no client, no note. The outbox worker and the receiving door both assert the
-- network privacy contract on top of this.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The records.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.builder_network_conversations (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES public.builder_network_connections(id) ON DELETE CASCADE,
  stock_item_id uuid NOT NULL REFERENCES public.builder_network_stock_items(id) ON DELETE CASCADE,
  builder_organisation_id uuid NOT NULL,
  -- Whose activation opened it, and who wrote first. Never sent anywhere.
  owner_user_id uuid,
  started_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT builder_network_conversations_pair UNIQUE (connection_id, stock_item_id)
);

CREATE TABLE IF NOT EXISTS public.builder_network_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL
    REFERENCES public.builder_network_conversations(id) ON DELETE CASCADE,
  -- Who wrote it. Outbound messages are the Command Centre's; inbound, the builder's.
  side text NOT NULL CHECK (side IN ('command_centre', 'builder')),
  sender_user_id uuid,
  client_message_id uuid,
  sender_display_name text NOT NULL
    CHECK (length(btrim(sender_display_name)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  -- The writing side's server clock: the order both ends sort by, with the id
  -- as the tie-breaker. Never the browser's.
  sent_at timestamptz NOT NULL,
  received_at timestamptz,
  delivery_state text CHECK (delivery_state IN ('queued', 'delivered', 'failed')),
  delivery_generation integer NOT NULL DEFAULT 1 CHECK (delivery_generation >= 1),
  delivered_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT builder_network_messages_state_is_outbound
    CHECK ((side = 'command_centre') = (delivery_state IS NOT NULL)),
  CONSTRAINT builder_network_messages_delivered_stamp
    CHECK (delivery_state IS DISTINCT FROM 'delivered' OR delivered_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS builder_network_messages_client_key
  ON public.builder_network_messages (sender_user_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS builder_network_messages_thread_idx
  ON public.builder_network_messages (conversation_id, sent_at, id);
-- The read window: the newest rows by arrival here.
CREATE INDEX IF NOT EXISTS builder_network_messages_arrival_idx
  ON public.builder_network_messages (conversation_id, created_at DESC, id DESC);

ALTER TABLE public.builder_network_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_network_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.builder_network_conversations, public.builder_network_messages
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.builder_network_conversations, public.builder_network_messages TO service_role;

CREATE SEQUENCE IF NOT EXISTS public.builder_network_message_version_seq;
REVOKE ALL ON SEQUENCE public.builder_network_message_version_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.builder_network_message_version_seq TO service_role;

ALTER TABLE public.builder_network_inbound_events
  ADD COLUMN IF NOT EXISTS message_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS message_apply_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_apply_error text;

CREATE INDEX IF NOT EXISTS builder_network_inbound_events_message_pending_idx
  ON public.builder_network_inbound_events (received_at, id)
  WHERE message_applied_at IS NULL
    AND event_type IN ('agency.message.posted', 'agency.message.receipt');

-- ---------------------------------------------------------------------------
-- 2. The one derivation both ends share.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_conversation_id(
  _network_connection_id uuid, _stock_item_id uuid)
RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT
AS $fn$
  SELECT md5('agency.conversation:' || _network_connection_id::text || ':' || _stock_item_id::text)::uuid
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_message_payload(_message_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'schema_version', 1,
    'conversation_id', m.conversation_id,
    'message_id', m.id,
    'stock_item_id', c.stock_item_id,
    'body', m.body,
    'sender_display_name', m.sender_display_name,
    'sent_at', to_char(m.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'generation', m.delivery_generation)
  FROM public.builder_network_messages m
  JOIN public.builder_network_conversations c ON c.id = m.conversation_id
  WHERE m.id = _message_id
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_kick_outbox()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  BEGIN
    PERFORM public.cron_invoke_signed_function('cross-portal-outbox-worker', '{}'::jsonb, 'agency_message');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END
$fn$;

-- A connection a message may not cross right now: its builder identity is
-- disputed (20261211000000's halt) or the builder has withdrawn stock:publish.
-- Neither is the end of the relationship, so what is queued is HELD, never
-- dropped: its outbox row waits (available_at = infinity, which the existing
-- claim never reaches) and is released the moment the connection recovers.
CREATE OR REPLACE FUNCTION public.builder_network_message_route_held(
  _connection_id uuid, _event_type text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  -- A disputed identity holds everything. A withdrawn stock:publish holds new
  -- CONTENT only: the receipt that tells the builder why must still reach it.
  SELECT EXISTS (
    SELECT 1 FROM public.builder_network_connections c
     WHERE c.id = _connection_id
       AND (c.identity_mismatch_since IS NOT NULL
            OR (_event_type = 'agency.message.posted'
                AND NOT ('stock:publish' = ANY (COALESCE(c.scopes, ARRAY[]::text[]))))))
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_message_enqueue(
  _connection_id uuid, _event_type text, _dedupe_key text, _payload jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $fn$
  INSERT INTO public.builder_network_outbox(connection_id, event_type, dedupe_key, payload, source_version, available_at)
  VALUES (_connection_id, _event_type, _dedupe_key, _payload,
          nextval('public.builder_network_message_version_seq'),
          CASE WHEN public.builder_network_message_route_held(_connection_id, _event_type) THEN 'infinity'::timestamptz ELSE now() END)
  ON CONFLICT (dedupe_key) DO NOTHING
$fn$;

-- A worker that claimed a message and then found its route held puts it back
-- to wait. That decision and the park are ONE locked statement: the
-- connection row is taken FOR SHARE, so a recovery (whose trigger releases
-- held rows) either commits first and is seen here, or waits and then releases
-- what this parked. Read in the worker and parked afterwards, a recovery in
-- between would be overwritten and the message held for ever. The delivery
-- attempt the claim spent is returned either way.
CREATE OR REPLACE FUNCTION public.builder_network_park_held_message(
  _outbox_id uuid, _worker_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_connection uuid;
  v_type text;
  v_held boolean;
BEGIN
  SELECT o.connection_id, o.event_type INTO v_connection, v_type
    FROM public.builder_network_outbox o
   WHERE o.id = _outbox_id AND o.locked_by = _worker_id AND o.status = 'pending'
     AND o.event_type LIKE 'agency.message.%';
  IF v_connection IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM public.builder_network_connections c WHERE c.id = v_connection FOR SHARE;
  v_held := public.builder_network_message_route_held(v_connection, v_type);
  UPDATE public.builder_network_outbox o
     SET available_at = CASE WHEN v_held THEN 'infinity'::timestamptz ELSE now() END,
         locked_at = NULL, locked_by = NULL,
         attempts = greatest(0, o.attempts - 1),
         last_error = CASE WHEN v_held THEN 'held:route_not_deliverable' ELSE o.last_error END
   WHERE o.id = _outbox_id AND o.locked_by = _worker_id;
  RETURN v_held;
END
$fn$;

-- A message written right after activating depends on the activation having
-- reached the network: sent first, it would be refused there as not open. The
-- outbox claim promises no order between rows, so a posted message whose
-- connection still holds an earlier, undelivered activation event waits
-- behind it, spending no delivery attempt. A dead activation does not hold it:
-- the message then goes and is refused visibly, never held for ever.
CREATE OR REPLACE FUNCTION public.builder_network_defer_message_behind_activation(
  _outbox_id uuid, _worker_id text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_row public.builder_network_outbox%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.builder_network_outbox o
   WHERE o.id = _outbox_id AND o.locked_by = _worker_id AND o.status = 'pending'
     AND o.event_type = 'agency.message.posted';
  IF v_row.id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.builder_network_outbox e
     WHERE e.connection_id = v_row.connection_id AND e.id <> v_row.id
       AND e.event_type LIKE 'stock.selection.%' AND e.status = 'pending'
       AND e.created_at <= v_row.created_at) THEN
    RETURN false;
  END IF;
  UPDATE public.builder_network_outbox o
     SET available_at = now() + interval '15 seconds',
         locked_at = NULL, locked_by = NULL,
         attempts = greatest(0, o.attempts - 1),
         last_error = 'deferred:behind_activation'
   WHERE o.id = _outbox_id AND o.locked_by = _worker_id;
  RETURN true;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Writing a message (the Command Centre's side).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_post_message(
  _stock_item_id uuid,
  _sender_user_id uuid,
  _client_message_id uuid,
  _body text)
RETURNS SETOF public.builder_network_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_body text := btrim(COALESCE(_body, ''));
  v_flag boolean;
  v_org uuid;
  v_connection record;
  v_conversation uuid;
  v_owner uuid;
  v_existing public.builder_network_messages%ROWTYPE;
  v_name text;
  v_id uuid;
BEGIN
  IF _client_message_id IS NULL OR length(v_body) = 0 OR length(v_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_INVALID';
  END IF;

  -- The same send again (a lost response, a double click) is the same row, and
  -- it is answered FIRST: a repeat of a message this sender already made is not
  -- a new write, so a relationship that closed or paused since does not turn it
  -- into a failure the sender would read as "not sent". Nothing new is written.
  -- The key is bound to what was sent: the same key with other text, or for
  -- another property, is not a repeat, and answering it with the original
  -- would lose the new text.
  SELECT * INTO v_existing FROM public.builder_network_messages m
   WHERE m.sender_user_id = _sender_user_id AND m.client_message_id = _client_message_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.body <> v_body OR NOT EXISTS (
      SELECT 1 FROM public.builder_network_conversations c
       WHERE c.id = v_existing.conversation_id AND c.stock_item_id = _stock_item_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_ID_REUSED';
    END IF;
    RETURN NEXT v_existing;
    RETURN;
  END IF;

  SELECT (value = 'true'::jsonb) INTO v_flag
    FROM public.feature_flags WHERE key = 'builder_network_enabled';
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NETWORK_DISABLED';
  END IF;

  -- The builder and the connection are read from rows, never from the caller:
  -- the property names its builder, and the builder's authorised connection is
  -- the one the activation itself was announced over.
  -- Only a property the builder still lists takes a new message; its history
  -- stays readable after it is archived. Held, so an archive landing now waits.
  SELECT i.organisation_id INTO v_org
    FROM public.builder_network_stock_items i
   WHERE i.id = _stock_item_id AND i.lifecycle_status = 'active'
   FOR SHARE;
  SELECT c.id, c.network_connection_id, c.identity_mismatch_since INTO v_connection
    FROM public.builder_network_connections c
   WHERE c.builder_organisation_id = v_org AND c.state = 'active'
     AND 'stock:publish' = ANY (c.scopes)
   ORDER BY c.accepted_at DESC NULLS LAST
   LIMIT 1
   -- Held until this transaction ends: a dispute or a withdrawn scope that
   -- lands now waits for this message, and the route trigger then sees it.
   FOR SHARE OF c;
  IF v_org IS NULL OR v_connection.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_FOUND';
  END IF;
  -- A relationship whose two ends disagree about who the builder is carries
  -- nothing new until it is repaired (20261211000000's halt, outbound).
  IF v_connection.identity_mismatch_since IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONNECTION_HALTED';
  END IF;
  v_conversation := public.builder_network_conversation_id(v_connection.network_connection_id, _stock_item_id);

  -- Every live activation is held until this message is written, so a
  -- withdrawal cannot commit between this check and the write: it either
  -- commits first (and this sees it) or waits for this message.
  PERFORM 1 FROM public.builder_stock_selections s
   WHERE s.stock_item_id = _stock_item_id AND s.organisation_id = v_org
     AND s.status <> 'withdrawn'
   FOR SHARE OF s;
  SELECT s.selected_by_user_id INTO v_owner
    FROM public.builder_stock_selections s
   WHERE s.stock_item_id = _stock_item_id AND s.organisation_id = v_org
     AND s.status <> 'withdrawn'
   ORDER BY s.selected_at, s.id
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_OPEN';
  END IF;

  SELECT COALESCE(
           nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
           nullif(btrim(COALESCE(u.username, '')), ''))
    INTO v_name
    FROM public.custom_users u
   WHERE u.id = _sender_user_id AND u.is_active = true AND u.deleted_at IS NULL;
  IF v_name IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_SENDER_NOT_A_MEMBER';
  END IF;

  INSERT INTO public.builder_network_conversations(
    id, connection_id, stock_item_id, builder_organisation_id, owner_user_id, started_by_user_id)
  VALUES (v_conversation, v_connection.id, _stock_item_id, v_org, v_owner, _sender_user_id)
  ON CONFLICT (id) DO NOTHING;

  v_id := gen_random_uuid();
  BEGIN
    INSERT INTO public.builder_network_messages(
      id, conversation_id, side, sender_user_id, client_message_id,
      sender_display_name, body, sent_at, delivery_state, delivery_generation)
    VALUES (v_id, v_conversation, 'command_centre', _sender_user_id, _client_message_id,
            left(v_name, 200), v_body, clock_timestamp(), 'queued', 1);
  EXCEPTION WHEN unique_violation THEN
    -- Two overlapping sends of one message (a double click, a retried request):
    -- the other committed first. Its row IS this send; answer with it.
    SELECT * INTO v_existing FROM public.builder_network_messages m
     WHERE m.sender_user_id = _sender_user_id AND m.client_message_id = _client_message_id;
    IF v_existing.id IS NULL THEN
      RAISE;
    END IF;
    IF v_existing.conversation_id <> v_conversation OR v_existing.body <> v_body THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_ID_REUSED';
    END IF;
    RETURN NEXT v_existing;
    RETURN;
  END;

  UPDATE public.builder_network_conversations
     SET last_message_at = GREATEST(COALESCE(last_message_at, '-infinity'), now())
   WHERE id = v_conversation;

  PERFORM public.builder_network_message_enqueue(v_connection.id, 'agency.message.posted',
    'agency.message:' || v_id || ':1', public.builder_network_message_payload(v_id));
  PERFORM public.builder_network_kick_outbox();

  RETURN QUERY SELECT * FROM public.builder_network_messages WHERE id = v_id;
END
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_retry_message(
  _message_id uuid, _sender_user_id uuid)
RETURNS SETOF public.builder_network_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_message public.builder_network_messages%ROWTYPE;
  v_conversation public.builder_network_conversations%ROWTYPE;
  v_flag boolean;
BEGIN
  -- Sending again is sending: the kill switch applies exactly as it does to
  -- a new message.
  SELECT (value = 'true'::jsonb) INTO v_flag
    FROM public.feature_flags WHERE key = 'builder_network_enabled';
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NETWORK_DISABLED';
  END IF;

  SELECT * INTO v_message FROM public.builder_network_messages
   WHERE id = _message_id AND side = 'command_centre' AND sender_user_id = _sender_user_id
   FOR UPDATE;
  IF v_message.id IS NULL OR v_message.delivery_state <> 'failed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_NOT_RETRYABLE';
  END IF;
  SELECT * INTO v_conversation FROM public.builder_network_conversations WHERE id = v_message.conversation_id;
  -- Sending again is writing: the conversation must still be open, exactly
  -- as for a new message, and what makes it open is held until it is sent.
  PERFORM 1 FROM public.builder_network_connections c WHERE c.id = v_conversation.connection_id FOR SHARE;
  PERFORM 1 FROM public.builder_network_stock_items i WHERE i.id = v_conversation.stock_item_id FOR SHARE;
  PERFORM 1 FROM public.builder_stock_selections s
   WHERE s.stock_item_id = v_conversation.stock_item_id
     AND s.organisation_id = v_conversation.builder_organisation_id
     AND s.status <> 'withdrawn'
   FOR SHARE OF s;
  IF EXISTS (
    SELECT 1 FROM public.builder_network_connections c
     WHERE c.id = v_conversation.connection_id AND c.identity_mismatch_since IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONNECTION_HALTED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.builder_network_connections c
     WHERE c.id = v_conversation.connection_id AND c.state = 'active'
       AND 'stock:publish' = ANY (c.scopes))
     OR NOT EXISTS (
    SELECT 1 FROM public.builder_stock_selections s
     WHERE s.stock_item_id = v_conversation.stock_item_id
       AND s.organisation_id = v_conversation.builder_organisation_id
       AND s.status <> 'withdrawn')
     OR NOT EXISTS (
    -- Still listed, and still this builder's: a property that changed hands
    -- takes no retry toward the builder who no longer holds it.
    SELECT 1 FROM public.builder_network_stock_items i
     WHERE i.id = v_conversation.stock_item_id AND i.lifecycle_status = 'active'
       AND i.organisation_id = v_conversation.builder_organisation_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_OPEN';
  END IF;

  UPDATE public.builder_network_messages
     SET delivery_state = 'queued', delivery_generation = delivery_generation + 1,
         failure_reason = NULL
   WHERE id = _message_id;
  PERFORM public.builder_network_message_enqueue(v_conversation.connection_id, 'agency.message.posted',
    'agency.message:' || _message_id || ':' || (v_message.delivery_generation + 1),
    public.builder_network_message_payload(_message_id));
  PERFORM public.builder_network_kick_outbox();

  RETURN QUERY SELECT * FROM public.builder_network_messages WHERE id = _message_id;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Receiving (the builder's messages, and the receipts for ours).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_apply_message_event(_event_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_event public.builder_network_inbound_events%ROWTYPE;
  v_connection record;
  v_payload jsonb;
  v_message_id uuid;
  v_conversation_id uuid;
  v_item uuid;
  v_generation integer;
  v_body text;
  v_name text;
  v_sent timestamptz;
  v_reason text;
  v_existing public.builder_network_messages%ROWTYPE;
  v_inserted integer := 0;
  v_outcome text;
  v_owner uuid;
BEGIN
  SELECT * INTO v_event FROM public.builder_network_inbound_events WHERE id = _event_id;
  v_payload := COALESCE(v_event.payload, '{}'::jsonb);

  -- Held until the event is applied: a dispute, a revocation or a withdrawn
  -- scope that lands now waits, rather than committing beside a message this
  -- is about to store under the old answer.
  SELECT c.id, c.state, c.builder_organisation_id, c.network_connection_id, c.identity_mismatch_since
    INTO v_connection
    FROM public.builder_network_connections c WHERE c.id = v_event.connection_id
   FOR SHARE;
  IF v_connection.id IS NULL THEN
    RETURN 'refused:connection_not_active';
  END IF;
  -- The sweep skips a disputed connection, but the dispute can begin after
  -- the row was selected: this is the last word, and it leaves the event
  -- unconsumed for the replay after repair.
  IF v_connection.identity_mismatch_since IS NOT NULL THEN
    RETURN 'held';
  END IF;
  -- A builder that withdrew stock:publish has withdrawn this conversation's
  -- grant too: no new message from it is stored. Receipts for what we sent
  -- still land — they carry no content.

  -- Exactly the contract's keys: the door refuses anything else before it is
  -- stored, and this is the same rule where the event is applied.
  IF jsonb_typeof(v_payload) <> 'object' OR EXISTS (
    SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(v_payload) = 'object' THEN v_payload ELSE '{}'::jsonb END) k
     WHERE k <> ALL (CASE WHEN v_event.event_type = 'agency.message.posted'
                          THEN ARRAY['body', 'conversation_id', 'generation', 'message_id', 'schema_version',
                                     'sender_display_name', 'sent_at', 'stock_item_id']
                          ELSE ARRAY['conversation_id', 'generation', 'message_id', 'outcome', 'reason',
                                     'schema_version'] END)) THEN
    RETURN 'refused:invalid_payload';
  END IF;
  -- And each value is the contract's JSON type: `->>` would turn an object or
  -- a number into text that passes every later check.
  IF EXISTS (
    SELECT 1 FROM jsonb_each(v_payload) kv
     WHERE NOT (kv.key = 'reason' AND jsonb_typeof(kv.value) = 'null')
       AND jsonb_typeof(kv.value) <> CASE WHEN kv.key IN ('generation', 'schema_version') THEN 'number' ELSE 'string' END) THEN
    RETURN 'refused:invalid_payload';
  END IF;

  BEGIN
    v_message_id := (v_payload->>'message_id')::uuid;
    v_conversation_id := (v_payload->>'conversation_id')::uuid;
    v_generation := (v_payload->>'generation')::integer;
  EXCEPTION WHEN others THEN
    v_message_id := NULL;
  END;
  IF v_message_id IS NULL OR v_conversation_id IS NULL OR v_generation IS NULL OR v_generation < 1
     OR COALESCE((v_payload->>'schema_version')::text, '') <> '1' THEN
    RETURN 'refused:invalid_payload';
  END IF;

  -- ── A receipt for something this side sent ─────────────────────────────
  IF v_event.event_type = 'agency.message.receipt' THEN
    v_outcome := v_payload->>'outcome';
    IF v_outcome IS NULL OR v_outcome NOT IN ('accepted', 'refused') THEN
      RETURN 'refused:invalid_payload';
    END IF;
    SELECT m.* INTO v_existing
      FROM public.builder_network_messages m
      JOIN public.builder_network_conversations c ON c.id = m.conversation_id
     WHERE m.id = v_message_id AND m.side = 'command_centre'
       AND c.id = v_conversation_id AND c.connection_id = v_connection.id
     FOR UPDATE OF m;
    IF v_existing.id IS NULL THEN
      RETURN 'refused:unknown_message';
    END IF;
    IF v_generation <> v_existing.delivery_generation OR v_existing.delivery_state = 'delivered' THEN
      RETURN 'applied';
    END IF;
    IF v_outcome = 'accepted' THEN
      UPDATE public.builder_network_messages
         SET delivery_state = 'delivered', delivered_at = now(), failure_reason = NULL
       WHERE id = v_message_id;
    ELSE
      UPDATE public.builder_network_messages
         SET delivery_state = 'failed',
             failure_reason = 'refused:' || left(COALESCE(v_payload->>'reason', 'unspecified'), 60)
       WHERE id = v_message_id;
    END IF;
    RETURN 'applied';
  END IF;

  -- ── The builder's message ─────────────────────────────────────────────
  -- A receipt above settles a message this side already sent and carries no
  -- content, so one that landed before a revocation still applies. New
  -- content needs the relationship to be live when it is stored.
  IF v_connection.state <> 'active' THEN
    RETURN 'refused:connection_not_active';
  END IF;
  BEGIN
    v_item := (v_payload->>'stock_item_id')::uuid;
    v_sent := (v_payload->>'sent_at')::timestamptz;
  EXCEPTION WHEN others THEN
    v_item := NULL;
  END;
  v_body := btrim(COALESCE(v_payload->>'body', ''));
  v_name := btrim(COALESCE(v_payload->>'sender_display_name', ''));

  -- The property is held before who owns it is checked, so a reassignment
  -- that lands now either commits first (and is seen) or waits for this.
  IF v_item IS NOT NULL THEN
    PERFORM 1 FROM public.builder_network_stock_items i WHERE i.id = v_item FOR SHARE;
  END IF;
  -- The time is a canonical RFC 3339 instant: a word PostgreSQL resolves in
  -- context ('now', 'today', 'epoch') would read differently on every retry
  -- and turn a lost-receipt recovery into a conflict.
  IF v_item IS NULL OR v_sent IS NULL OR NOT isfinite(v_sent)
     OR (v_payload->>'sent_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
     -- Nor from the future beyond ordinary clock skew: a message dated years
     -- ahead would sort above every real message for ever, and enough of them
     -- would crowd the real ones out of a capped read.
     OR v_sent > now() + interval '5 minutes'
     OR length(v_body) NOT BETWEEN 1 AND 4000
     OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    v_reason := 'invalid_message';
  ELSIF NOT EXISTS (SELECT 1 FROM public.builder_network_connections c
                     WHERE c.id = v_connection.id AND 'stock:publish' = ANY (c.scopes)) THEN
    -- A builder that withdrew stock:publish has withdrawn this conversation's
    -- grant too: nothing new from it is stored, and it is told so rather than
    -- left to time out. Receipts for what we sent still land, and so does the
    -- retry of a message already held here unchanged (a receipt lost on the
    -- way back): refusing it would tell the builder words this side keeps
    -- were rejected.
    SELECT * INTO v_existing FROM public.builder_network_messages WHERE id = v_message_id;
    IF v_existing.id IS NULL
       OR v_existing.conversation_id <> v_conversation_id OR v_existing.side <> 'builder'
       OR v_existing.body <> v_body OR v_existing.sender_display_name <> left(v_name, 200)
       OR v_existing.sent_at <> v_sent THEN
      v_reason := 'scope_revoked';
    END IF;
    v_existing := NULL;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.builder_network_stock_items i
     WHERE i.id = v_item AND i.organisation_id = v_connection.builder_organisation_id) THEN
    -- Not this builder's (or no longer): nothing new is stored, but the retry
    -- of a message already held here unchanged is acknowledged again, or the
    -- builder would record a refusal for words this side keeps.
    SELECT * INTO v_existing FROM public.builder_network_messages WHERE id = v_message_id;
    IF v_existing.id IS NULL
       OR v_existing.conversation_id <> v_conversation_id OR v_existing.side <> 'builder'
       OR v_existing.body <> v_body OR v_existing.sender_display_name <> left(v_name, 200)
       OR v_existing.sent_at <> v_sent THEN
      v_reason := 'stock_item_not_ours';
    END IF;
    v_existing := NULL;
  ELSIF v_conversation_id <> public.builder_network_conversation_id(v_connection.network_connection_id, v_item) THEN
    v_reason := 'conversation_mismatch';
  ELSE
    PERFORM 1 FROM public.builder_network_stock_items i WHERE i.id = v_item FOR SHARE;
    PERFORM 1 FROM public.builder_stock_selections s
     WHERE s.stock_item_id = v_item AND s.organisation_id = v_connection.builder_organisation_id
       AND s.status <> 'withdrawn'
     FOR SHARE OF s;
    SELECT s.selected_by_user_id INTO v_owner
      FROM public.builder_stock_selections s
     WHERE s.stock_item_id = v_item AND s.organisation_id = v_connection.builder_organisation_id
       AND s.status <> 'withdrawn'
     ORDER BY s.selected_at, s.id
     LIMIT 1;
    -- A property the builder no longer lists is closed to new messages the
    -- same way a withdrawn activation is.
    IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.builder_network_stock_items i
       WHERE i.id = v_item AND i.lifecycle_status = 'active') THEN
      -- Closed to NEW messages. One already held here, unchanged, is this
      -- side's own record: its retry (a receipt lost on the way back) is
      -- acknowledged again, or the builder would record a refusal for words
      -- this conversation keeps.
      SELECT * INTO v_existing FROM public.builder_network_messages WHERE id = v_message_id;
      IF v_existing.id IS NULL
         OR v_existing.conversation_id <> v_conversation_id OR v_existing.side <> 'builder'
         OR v_existing.body <> v_body OR v_existing.sender_display_name <> left(v_name, 200)
         OR v_existing.sent_at <> v_sent THEN
        v_reason := 'conversation_not_open';
      END IF;
      v_existing := NULL;
    END IF;
  END IF;

  IF v_reason IS NULL THEN
    SELECT * INTO v_existing FROM public.builder_network_messages WHERE id = v_message_id;
    IF v_existing.id IS NOT NULL
       AND (v_existing.conversation_id <> v_conversation_id OR v_existing.side <> 'builder'
            -- A message id is bound to what it said: a redelivery or retry that
            -- changes the words, the name or the time is not this message.
            OR v_existing.body <> v_body
            OR v_existing.sender_display_name <> left(v_name, 200)
            OR v_existing.sent_at <> v_sent) THEN
      v_reason := 'message_conflict';
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    PERFORM public.builder_network_message_enqueue(v_connection.id, 'agency.message.receipt',
      'agency.receipt:' || v_message_id || ':' || v_generation,
      jsonb_build_object('schema_version', 1, 'message_id', v_message_id,
        'conversation_id', v_conversation_id, 'generation', v_generation,
        'outcome', 'refused', 'reason', v_reason));
    RETURN 'refused:' || v_reason;
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.builder_network_conversations(
      id, connection_id, stock_item_id, builder_organisation_id, owner_user_id)
    VALUES (v_conversation_id, v_connection.id, v_item, v_connection.builder_organisation_id, v_owner)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.builder_network_messages(
      id, conversation_id, side, sender_display_name, body, sent_at, received_at)
    VALUES (v_message_id, v_conversation_id, 'builder', left(v_name, 200), v_body, v_sent, now())
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
      -- Another sweep stored this id between the lookup and the insert. What
      -- it stored is this message only if it says the same thing; otherwise
      -- the answer is a refusal, never an acknowledgement of words not kept.
      SELECT * INTO v_existing FROM public.builder_network_messages WHERE id = v_message_id;
      IF v_existing.conversation_id <> v_conversation_id OR v_existing.side <> 'builder'
         OR v_existing.body <> v_body OR v_existing.sender_display_name <> left(v_name, 200)
         OR v_existing.sent_at <> v_sent THEN
        v_reason := 'message_conflict';
      END IF;
    END IF;
  END IF;

  IF v_reason IS NOT NULL THEN
    PERFORM public.builder_network_message_enqueue(v_connection.id, 'agency.message.receipt',
      'agency.receipt:' || v_message_id || ':' || v_generation,
      jsonb_build_object('schema_version', 1, 'message_id', v_message_id,
        'conversation_id', v_conversation_id, 'generation', v_generation,
        'outcome', 'refused', 'reason', v_reason));
    RETURN 'refused:' || v_reason;
  END IF;

  IF v_inserted > 0 THEN
    UPDATE public.builder_network_conversations
       SET last_message_at = GREATEST(COALESCE(last_message_at, '-infinity'), v_sent)
     WHERE id = v_conversation_id;
  END IF;

  PERFORM public.builder_network_message_enqueue(v_connection.id, 'agency.message.receipt',
    'agency.receipt:' || v_message_id || ':' || v_generation,
    jsonb_build_object('schema_version', 1, 'message_id', v_message_id,
      'conversation_id', v_conversation_id, 'generation', v_generation,
      'outcome', 'accepted'));
  RETURN 'applied';
END
$fn$;

-- A message whose CURRENT generation reached the builder (its outbox row is
-- delivered) and whose receipt has not come back within the confirmation
-- window is failed as `confirmation_timeout` — never as a refusal, because
-- nobody refused it. Its writer can send it again: the builder stores the
-- message id once and answers every generation, so a message that WAS
-- accepted (its receipt lost on the way back) is simply confirmed by the next
-- generation's receipt. A late receipt of this same generation still makes it
-- Delivered (it is the truth); one of an older generation changes nothing.
-- Deterministic, set-based, and run by the message sweep's own schedule.
CREATE OR REPLACE FUNCTION public.builder_network_expire_unconfirmed(
  _window interval DEFAULT interval '15 minutes')
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $fn$
  WITH expired AS (
    UPDATE public.builder_network_messages m
       SET delivery_state = 'failed', failure_reason = 'confirmation_timeout'
      FROM public.builder_network_outbox o
     WHERE m.side = 'command_centre' AND m.delivery_state = 'queued'
       AND o.dedupe_key = 'agency.message:' || m.id || ':' || m.delivery_generation
       AND o.status = 'delivered'
       AND o.delivered_at < now() - _window
    RETURNING m.id)
  SELECT count(*)::integer FROM expired
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_apply_message_events(_limit integer DEFAULT 50)
RETURNS TABLE(applied integer, refused integer, deferred integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_event record;
  v_result text;
  v_applied integer := 0;
  v_refused integer := 0;
  v_deferred integer := 0;
BEGIN
  FOR v_event IN
    SELECT e.id, e.connection_id, e.event_type, e.message_apply_attempts
      FROM public.builder_network_inbound_events e
     WHERE e.message_applied_at IS NULL
       AND e.event_type IN ('agency.message.posted', 'agency.message.receipt')
       -- A relationship whose two ends disagree is HELD, never consumed —
       -- the main sweep's rule (20261211000000): repaired, it replays.
       AND NOT EXISTS (
         SELECT 1 FROM public.builder_network_connections c
          WHERE c.id = e.connection_id AND c.identity_mismatch_since IS NOT NULL)
     ORDER BY e.received_at, e.id
     LIMIT greatest(1, least(_limit, 500))
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_result := public.builder_network_apply_message_event(v_event.id);
      IF v_result = 'held' THEN
        -- Not an attempt and not an answer: left exactly as it was.
        CONTINUE;
      END IF;
      UPDATE public.builder_network_inbound_events
         SET message_applied_at = now(),
             message_apply_attempts = message_apply_attempts + 1,
             message_apply_error = CASE WHEN v_result = 'applied' THEN NULL ELSE left(v_result, 200) END
       WHERE id = v_event.id;
      IF v_result = 'applied' THEN
        v_applied := v_applied + 1;
      ELSE
        v_refused := v_refused + 1;
        PERFORM public.builder_network_media_note('builder_network_message_refused', 'warning', v_event.id,
          jsonb_build_object('connection_id', v_event.connection_id,
                             'event_type', v_event.event_type, 'reason', v_result));
      END IF;
    EXCEPTION WHEN others THEN
      IF v_event.message_apply_attempts + 1 >= 5 THEN
        UPDATE public.builder_network_inbound_events
           SET message_applied_at = now(), message_apply_attempts = message_apply_attempts + 1,
               message_apply_error = left('dead:' || SQLERRM, 200)
         WHERE id = v_event.id;
        PERFORM public.builder_network_media_note('builder_network_message_apply_dead', 'critical', v_event.id,
          jsonb_build_object('connection_id', v_event.connection_id,
                             'event_type', v_event.event_type, 'error', left(SQLERRM, 200)));
        v_refused := v_refused + 1;
      ELSE
        UPDATE public.builder_network_inbound_events
           SET message_apply_attempts = message_apply_attempts + 1,
               message_apply_error = left(SQLERRM, 200)
         WHERE id = v_event.id;
        v_deferred := v_deferred + 1;
      END IF;
    END;
  END LOOP;

  IF v_applied + v_refused > 0 THEN
    PERFORM public.builder_network_kick_outbox();
  END IF;
  PERFORM public.builder_network_expire_unconfirmed();
  applied := v_applied; refused := v_refused; deferred := v_deferred;
  RETURN NEXT;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The lane, and the transport's verdict.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_message_lane()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $fn$
BEGIN
  NEW.processed_at := COALESCE(NEW.processed_at, now());
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_builder_network_message_lane ON public.builder_network_inbound_events;
CREATE TRIGGER trg_builder_network_message_lane
  BEFORE INSERT ON public.builder_network_inbound_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('agency.message.posted', 'agency.message.receipt'))
  EXECUTE FUNCTION public.builder_network_message_lane();

CREATE OR REPLACE FUNCTION public.builder_network_message_transport_dead()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  BEGIN
    UPDATE public.builder_network_messages
       SET delivery_state = 'failed', failure_reason = 'not_delivered'
     WHERE id = (NEW.payload->>'message_id')::uuid
       AND delivery_generation = (NEW.payload->>'generation')::integer
       AND delivery_state = 'queued';
  EXCEPTION WHEN others THEN NULL;
  END;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_message_route_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- A revoked connection is the end of the relationship: nothing on it will
  -- ever be claimed, including rows held at infinity, so they are dead-lettered
  -- here, and the transport-dead trigger marks each message failed and visible
  -- exactly as the worker's revoked-connection path does.
  IF NEW.state = 'revoked' AND OLD.state IS DISTINCT FROM 'revoked' THEN
    UPDATE public.builder_network_outbox o
       SET status = 'dead', locked_at = NULL, locked_by = NULL, last_error = 'connection_revoked'
     WHERE o.connection_id = NEW.id AND o.status = 'pending' AND o.event_type LIKE 'agency.message.%';
    RETURN NEW;
  END IF;
  -- Each pending message row is held or released by the same rule the
  -- enqueue applies: a dispute holds everything, a withdrawn scope holds
  -- posted content only. A released row goes out now; one that was never
  -- held keeps its own schedule.
  UPDATE public.builder_network_outbox o
     SET available_at = CASE
           WHEN NEW.identity_mismatch_since IS NOT NULL
             OR (o.event_type = 'agency.message.posted'
                 AND NOT ('stock:publish' = ANY (COALESCE(NEW.scopes, ARRAY[]::text[]))))
             THEN 'infinity'::timestamptz
           WHEN o.available_at = 'infinity' THEN now()
           ELSE o.available_at END
   WHERE o.connection_id = NEW.id AND o.status = 'pending' AND o.event_type LIKE 'agency.message.%';
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_builder_network_message_route_changed ON public.builder_network_connections;
CREATE TRIGGER trg_builder_network_message_route_changed
  AFTER UPDATE OF identity_mismatch_since, scopes, state ON public.builder_network_connections
  FOR EACH ROW EXECUTE FUNCTION public.builder_network_message_route_changed();

DROP TRIGGER IF EXISTS trg_builder_network_message_transport_dead ON public.builder_network_outbox;
CREATE TRIGGER trg_builder_network_message_transport_dead
  AFTER UPDATE OF status ON public.builder_network_outbox
  FOR EACH ROW
  WHEN (NEW.status = 'dead' AND OLD.status IS DISTINCT FROM 'dead'
        AND NEW.event_type = 'agency.message.posted')
  EXECUTE FUNCTION public.builder_network_message_transport_dead();

-- ---------------------------------------------------------------------------
-- 6. Grants, and the sweep's schedule.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.builder_network_conversation_id(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_message_payload(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_kick_outbox() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_message_enqueue(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_message_route_held(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_park_held_message(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_defer_message_behind_activation(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_message_route_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_post_message(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_retry_message(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_apply_message_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_apply_message_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_expire_unconfirmed(interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_message_lane() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_message_transport_dead() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_conversation_id(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_post_message(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_retry_message(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_apply_message_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_expire_unconfirmed(interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_park_held_message(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_defer_message_behind_activation(uuid, text) TO service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'builder-network-messages-apply-1min') THEN
      PERFORM cron.schedule('builder-network-messages-apply-1min', '* * * * *',
        $job$SELECT public.builder_network_apply_message_events(50);$job$);
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7. Asserted by effect.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF public.builder_network_conversation_id(
       '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
     IS DISTINCT FROM md5('agency.conversation:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002')::uuid THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the conversation id is not the shared derivation';
  END IF;
  IF has_function_privilege('authenticated', 'public.builder_network_post_message(uuid,uuid,uuid,text)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.builder_network_messages', 'SELECT')
     OR has_table_privilege('anon', 'public.builder_network_messages', 'SELECT') THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: messaging is reachable from a browser role';
  END IF;
END $$;

COMMIT;
