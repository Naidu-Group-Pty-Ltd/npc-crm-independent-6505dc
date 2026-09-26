-- ============================================================================
-- One activation, one private conversation. The Command Centre's half.
--
-- The network's half is `aurixa-builders`'
-- `20260926120000_one_activation_one_private_conversation.sql`; the two share
-- one contract, `docs/builder-portal/52-…` (the network's 62).
--
-- WHAT CHANGES. Step 5 (20261221120000) gave a PROPERTY one conversation and
-- let anyone with Listings access read it. A conversation now belongs to ONE
-- ACTIVATION, and only its participants may read, poll, write, retry, list
-- participants, invite or leave. Nothing about how a message travels changes:
-- `agency.message.posted` and `agency.message.receipt` are exactly Step 5's.
--
-- ITS IDENTITY. md5('agency.activation:' || network connection id || ':' ||
-- remote_selection_ref) — the activation's shared reference, which here is the
-- selection's own id and which already crosses in every `stock.selection.*`
-- event. Nothing new carries the reference: only the derived id travels. The
-- one conversation that exists already keeps the id it was created with; its
-- row records which activation it belongs to (`selection_ref`), so a
-- conversation is found by its row, and a new one is recognised by the
-- derivation.
--
-- MEMBERSHIP IS LOCAL. `builder_network_conversation_participants` holds this
-- side's participants (with the local user) and the builder's (display only,
-- `local_user_id` NULL). Only a row for a local user grants anything, and only
-- to that user. A remote row can never become access here.
--
-- THE ACKNOWLEDGEMENT. The main sweep applies `stock.selection.acknowledged`
-- exactly as before; a trigger then runs ONE idempotent step that opens the
-- conversation, adds the activator, announces them, and — the first time only
-- — writes the activator's notification and queues one email on the existing
-- `integration_outbox`. Its anchor is a row per activation, so a replay adds
-- nothing. A failure there never undoes or blocks the acknowledgement: the
-- message sweep retries it.
--
-- NOTHING IS GUESSED. No existing conversation is bound or seeded here.
-- `builder_network_seed_activation_conversation` does that, called by the
-- `agency-chat-backfill` rollout phase only where BOTH projects agree. Every
-- acknowledgement that exists now is recorded as historical, so none of them
-- is ever notified or emailed.
-- ============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The records.
-- ---------------------------------------------------------------------------
ALTER TABLE public.builder_network_conversations
  ADD COLUMN IF NOT EXISTS selection_ref uuid;
ALTER TABLE public.builder_network_conversations
  DROP CONSTRAINT IF EXISTS builder_network_conversations_pair;
CREATE UNIQUE INDEX IF NOT EXISTS builder_network_conversations_activation_key
  ON public.builder_network_conversations (connection_id, selection_ref)
  WHERE selection_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS builder_network_conversations_item_idx
  ON public.builder_network_conversations (stock_item_id);

ALTER TABLE public.builder_stock_selections
  ADD COLUMN IF NOT EXISTS acknowledged_by_display_name text
    CHECK (acknowledged_by_display_name IS NULL OR length(btrim(acknowledged_by_display_name)) BETWEEN 1 AND 200);

-- A conversation event that arrived ahead of its acknowledgement is HELD:
-- left unconsumed, and passed over by the sweep until this time, so a run of
-- held events at the head of the queue can never keep later ones from
-- applying. The acknowledgement clears it, so held events apply at once.
ALTER TABLE public.builder_network_inbound_events
  ADD COLUMN IF NOT EXISTS message_held_until timestamptz;

-- The builder COMPANY's own public contact details, as its network sends them.
ALTER TABLE public.builder_network_stock_organisations
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS website text;

CREATE TABLE IF NOT EXISTS public.builder_network_conversation_participants (
  conversation_id uuid NOT NULL
    REFERENCES public.builder_network_conversations(id) ON DELETE CASCADE,
  -- Random, minted once per (conversation, person). Never a user id.
  participant_ref uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('command_centre', 'builder')),
  -- This side's user, for this side's participants only. The builder's are
  -- display records and carry none.
  local_user_id uuid,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  state text NOT NULL CHECK (state IN ('joined', 'left')),
  version integer NOT NULL CHECK (version >= 1),
  joined_at timestamptz,
  left_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, participant_ref),
  CONSTRAINT builder_network_participants_local_is_ours
    CHECK ((side = 'command_centre') = (local_user_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS builder_network_participants_local_key
  ON public.builder_network_conversation_participants (conversation_id, local_user_id)
  WHERE local_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS builder_network_participants_user_idx
  ON public.builder_network_conversation_participants (local_user_id)
  WHERE local_user_id IS NOT NULL;

-- One row per activation whose acknowledgement has been handled: the anchor
-- that makes the notification and the email happen once.
CREATE TABLE IF NOT EXISTS public.builder_network_acknowledgement_notices (
  selection_id uuid PRIMARY KEY,
  -- `awaiting_activator`: acknowledged while the activating user was inactive
  -- or removed. The conversation exists and nobody is added in their place;
  -- it completes (joined, notified, emailed) if that user becomes active.
  outcome text NOT NULL CHECK (outcome IN ('notified', 'historical', 'awaiting_activator')),
  conversation_id uuid,
  inbound_event_id uuid,
  email_sent_at timestamptz,
  -- The email's lease. A worker claims it before sending and records the send
  -- only while it still holds it; a worker that dies mid-send leaves a lease
  -- that runs out, so the email is retried rather than silently lost.
  email_claim_token uuid,
  email_claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.builder_network_conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.builder_network_acknowledgement_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.builder_network_conversation_participants, public.builder_network_acknowledgement_notices
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.builder_network_conversation_participants, public.builder_network_acknowledgement_notices
  TO service_role;

-- Every acknowledgement that exists now happened before this step: it is
-- recorded, so it is never notified or emailed.
INSERT INTO public.builder_network_acknowledgement_notices(selection_id, outcome)
SELECT s.id, 'historical' FROM public.builder_stock_selections s
 WHERE s.acknowledged_at IS NOT NULL
ON CONFLICT (selection_id) DO NOTHING;

DROP INDEX IF EXISTS public.builder_network_inbound_events_message_pending_idx;
CREATE INDEX IF NOT EXISTS builder_network_inbound_events_message_pending_idx
  ON public.builder_network_inbound_events (received_at, id)
  WHERE message_applied_at IS NULL
    AND event_type IN ('agency.message.posted', 'agency.message.receipt', 'agency.message.participant');
CREATE INDEX IF NOT EXISTS builder_network_inbound_events_acknowledged_idx
  ON public.builder_network_inbound_events (received_at DESC)
  WHERE event_type = 'stock.selection.acknowledged';

-- ---------------------------------------------------------------------------
-- 2. The derivation, names and participant events.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_activation_conversation_id(
  _network_connection_id uuid, _selection_ref uuid)
RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT
AS $fn$
  SELECT md5('agency.activation:' || _network_connection_id::text || ':' || _selection_ref::text)::uuid
$fn$;

-- The name a Command Centre user writes and is shown under — Step 5's rule.
CREATE OR REPLACE FUNCTION public.builder_network_user_display_name(_user_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT left(COALESCE(
           nullif(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
           nullif(btrim(COALESCE(u.username, '')), '')), 200)
    FROM public.custom_users u
   WHERE u.id = _user_id AND u.is_active = true AND u.deleted_at IS NULL
$fn$;

-- Announce this side's participant as it now stands. The dedupe key names the
-- version, so each change crosses once and a replay is the same row.
CREATE OR REPLACE FUNCTION public.builder_network_announce_participant(
  _conversation_id uuid, _participant_ref uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_p public.builder_network_conversation_participants%ROWTYPE;
  v_c public.builder_network_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.builder_network_conversation_participants
   WHERE conversation_id = _conversation_id AND participant_ref = _participant_ref AND side = 'command_centre';
  SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = _conversation_id;
  IF v_p.participant_ref IS NULL OR v_c.id IS NULL THEN RETURN; END IF;
  PERFORM public.builder_network_message_enqueue(v_c.connection_id, 'agency.message.participant',
    'agency.participant:' || v_c.id || ':' || v_p.participant_ref || ':' || v_p.version,
    jsonb_build_object(
      'schema_version', 1,
      'conversation_id', v_c.id,
      'stock_item_id', v_c.stock_item_id,
      'participant_ref', v_p.participant_ref,
      'display_name', v_p.display_name,
      'side', 'command_centre',
      'state', v_p.state,
      'version', v_p.version));
END
$fn$;

-- Join a local user: new under a fresh reference, or back under the one they
-- had. Returns whether anything changed.
CREATE OR REPLACE FUNCTION public.builder_network_join_local(
  _conversation_id uuid, _user_id uuid, _display_name text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_p public.builder_network_conversation_participants%ROWTYPE;
BEGIN
  SELECT * INTO v_p FROM public.builder_network_conversation_participants
   WHERE conversation_id = _conversation_id AND local_user_id = _user_id
   FOR UPDATE;
  IF v_p.participant_ref IS NULL THEN
    INSERT INTO public.builder_network_conversation_participants(
      conversation_id, participant_ref, side, local_user_id, display_name, state, version, joined_at)
    VALUES (_conversation_id, gen_random_uuid(), 'command_centre', _user_id, _display_name, 'joined', 1, now())
    ON CONFLICT (conversation_id, local_user_id) WHERE local_user_id IS NOT NULL DO NOTHING
    RETURNING * INTO v_p;
    IF v_p.participant_ref IS NULL THEN RETURN false; END IF;
  ELSIF v_p.state = 'joined' THEN
    RETURN false;
  ELSE
    UPDATE public.builder_network_conversation_participants
       SET state = 'joined', version = version + 1, display_name = _display_name,
           joined_at = now(), left_at = NULL, updated_at = now()
     WHERE conversation_id = _conversation_id AND participant_ref = v_p.participant_ref;
  END IF;
  PERFORM public.builder_network_announce_participant(_conversation_id, v_p.participant_ref);
  RETURN true;
END
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_is_participant(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_network_conversation_participants p
     WHERE p.conversation_id = _conversation_id AND p.local_user_id = _user_id
       AND p.side = 'command_centre' AND p.state = 'joined')
$fn$;

-- Why a conversation takes nothing new right now, or NULL when it does. Reads
-- (and holds, for the caller's transaction) the rows that decide it.
CREATE OR REPLACE FUNCTION public.builder_network_conversation_closed_reason(_conversation_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_c public.builder_network_conversations%ROWTYPE;
  v_conn record;
BEGIN
  SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = _conversation_id;
  IF v_c.id IS NULL THEN RETURN 'not_found'; END IF;
  SELECT c.state, c.scopes, c.identity_mismatch_since INTO v_conn
    FROM public.builder_network_connections c WHERE c.id = v_c.connection_id FOR SHARE;
  PERFORM 1 FROM public.builder_network_stock_items i WHERE i.id = v_c.stock_item_id FOR SHARE;
  IF v_c.selection_ref IS NOT NULL THEN
    PERFORM 1 FROM public.builder_stock_selections s WHERE s.id = v_c.selection_ref FOR SHARE;
  END IF;
  IF v_conn.state IS DISTINCT FROM 'active' THEN RETURN 'not_connected'; END IF;
  -- A conversation that was never bound to its activation takes nothing new
  -- until it is: which activation it belongs to decides who may write.
  IF v_c.selection_ref IS NULL THEN RETURN 'not_activated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.builder_stock_selections s
     WHERE s.id = v_c.selection_ref AND s.organisation_id = v_c.builder_organisation_id
       AND s.stock_item_id = v_c.stock_item_id AND s.status <> 'withdrawn') THEN
    RETURN 'withdrawn';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.builder_stock_selections s
     WHERE s.id = v_c.selection_ref AND s.acknowledged_at IS NOT NULL) THEN
    RETURN 'not_acknowledged';
  END IF;
  -- The route, after the activation (Step 5's order): restoring a route alone
  -- would not open a withdrawn activation's conversation.
  IF v_conn.identity_mismatch_since IS NOT NULL THEN RETURN 'connection_halted'; END IF;
  IF NOT ('stock:publish' = ANY (COALESCE(v_conn.scopes, ARRAY[]::text[]))) THEN RETURN 'connection_paused'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.builder_network_stock_items i
     WHERE i.id = v_c.stock_item_id AND i.lifecycle_status = 'active'
       AND i.organisation_id = v_c.builder_organisation_id) THEN
    RETURN 'delisted';
  END IF;
  RETURN NULL;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Writing (the Command Centre's side). The same function name as Step 5,
--    now naming a CONVERSATION; the old per-property form is gone.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.builder_network_post_message(uuid, uuid, uuid, text);
CREATE FUNCTION public.builder_network_post_message(
  _conversation_id uuid,
  _sender_user_id uuid,
  _client_message_id uuid,
  _body text)
RETURNS SETOF public.builder_network_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_body text := btrim(COALESCE(_body, ''));
  v_flag boolean;
  v_c public.builder_network_conversations%ROWTYPE;
  v_existing public.builder_network_messages%ROWTYPE;
  v_closed text;
  v_name text;
  v_id uuid;
BEGIN
  IF _client_message_id IS NULL OR length(v_body) = 0 OR length(v_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_INVALID';
  END IF;

  -- The same send again is the same row, answered first and writing nothing
  -- (Step 5's rule). The key is bound to its text and its conversation.
  SELECT * INTO v_existing FROM public.builder_network_messages m
   WHERE m.sender_user_id = _sender_user_id AND m.client_message_id = _client_message_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.body <> v_body OR v_existing.conversation_id <> _conversation_id THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_ID_REUSED';
    END IF;
    -- Answered only to someone still in the conversation: repeating an
    -- earlier send is never a way back in after leaving.
    IF NOT public.builder_network_is_participant(v_existing.conversation_id, _sender_user_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NOT_A_PARTICIPANT';
    END IF;
    RETURN NEXT v_existing;
    RETURN;
  END IF;

  SELECT (value = 'true'::jsonb) INTO v_flag
    FROM public.feature_flags WHERE key = 'builder_network_enabled';
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NETWORK_DISABLED';
  END IF;

  -- The conversation is taken before the participant, the order leaving takes
  -- them in, so a post and a leave by the same person cannot deadlock. The
  -- post updates this row below, so it takes the lock that update needs.
  SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = _conversation_id
   FOR NO KEY UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_FOUND';
  END IF;
  -- Membership is held until the message is written: a leave that lands now
  -- either commits first (and is seen) or waits for this message.
  PERFORM 1 FROM public.builder_network_conversation_participants p
   WHERE p.conversation_id = v_c.id AND p.local_user_id = _sender_user_id FOR SHARE;
  IF NOT public.builder_network_is_participant(v_c.id, _sender_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NOT_A_PARTICIPANT';
  END IF;
  v_closed := public.builder_network_conversation_closed_reason(v_c.id);
  IF v_closed = 'connection_halted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONNECTION_HALTED';
  ELSIF v_closed IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_OPEN';
  END IF;

  v_name := public.builder_network_user_display_name(_sender_user_id);
  IF v_name IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_SENDER_NOT_A_MEMBER';
  END IF;

  v_id := gen_random_uuid();
  BEGIN
    INSERT INTO public.builder_network_messages(
      id, conversation_id, side, sender_user_id, client_message_id,
      sender_display_name, body, sent_at, delivery_state, delivery_generation)
    VALUES (v_id, v_c.id, 'command_centre', _sender_user_id, _client_message_id,
            v_name, v_body, clock_timestamp(), 'queued', 1);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing FROM public.builder_network_messages m
     WHERE m.sender_user_id = _sender_user_id AND m.client_message_id = _client_message_id;
    IF v_existing.id IS NULL THEN
      RAISE;
    END IF;
    IF v_existing.conversation_id <> v_c.id OR v_existing.body <> v_body THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_ID_REUSED';
    END IF;
    RETURN NEXT v_existing;
    RETURN;
  END;

  UPDATE public.builder_network_conversations
     SET last_message_at = GREATEST(COALESCE(last_message_at, '-infinity'), now()),
         started_by_user_id = COALESCE(started_by_user_id, _sender_user_id)
   WHERE id = v_c.id;

  PERFORM public.builder_network_message_enqueue(v_c.connection_id, 'agency.message.posted',
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
  v_c public.builder_network_conversations%ROWTYPE;
  v_flag boolean;
  v_closed text;
BEGIN
  SELECT (value = 'true'::jsonb) INTO v_flag
    FROM public.feature_flags WHERE key = 'builder_network_enabled';
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NETWORK_DISABLED';
  END IF;

  SELECT * INTO v_message FROM public.builder_network_messages
   WHERE id = _message_id AND side = 'command_centre' AND sender_user_id = _sender_user_id
   FOR UPDATE;
  IF v_message.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_NOT_RETRYABLE';
  END IF;
  SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = v_message.conversation_id;
  -- Sending again is writing, and writing is for participants: someone who
  -- has left cannot send again even what they wrote.
  PERFORM 1 FROM public.builder_network_conversation_participants p
   WHERE p.conversation_id = v_c.id AND p.local_user_id = _sender_user_id FOR SHARE;
  IF NOT public.builder_network_is_participant(v_c.id, _sender_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NOT_A_PARTICIPANT';
  END IF;
  IF v_message.delivery_state <> 'failed' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_MESSAGE_NOT_RETRYABLE';
  END IF;
  v_closed := public.builder_network_conversation_closed_reason(v_c.id);
  IF v_closed = 'connection_halted' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONNECTION_HALTED';
  ELSIF v_closed IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_OPEN';
  END IF;

  UPDATE public.builder_network_messages
     SET delivery_state = 'queued', delivery_generation = delivery_generation + 1,
         failure_reason = NULL
   WHERE id = _message_id;
  PERFORM public.builder_network_message_enqueue(v_c.connection_id, 'agency.message.posted',
    'agency.message:' || _message_id || ':' || (v_message.delivery_generation + 1),
    public.builder_network_message_payload(_message_id));
  PERFORM public.builder_network_kick_outbox();

  RETURN QUERY SELECT * FROM public.builder_network_messages WHERE id = _message_id;
END
$fn$;

-- ---------------------------------------------------------------------------
-- 4. Inviting and leaving. There is no operation that removes anyone.
-- ---------------------------------------------------------------------------
-- A colleague may be invited when they are an active Command Centre user who
-- holds Listings view — read from this side's own rows, never the caller's.
CREATE OR REPLACE FUNCTION public.builder_network_invitee_eligible(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.custom_users u
                  WHERE u.id = _user_id AND u.is_active = true AND u.deleted_at IS NULL)
     AND public.has_module_access(_user_id, 'listings')
     AND public.builder_network_user_display_name(_user_id) IS NOT NULL
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_invite_participant(
  _conversation_id uuid, _actor_user_id uuid, _invitee_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_c public.builder_network_conversations%ROWTYPE;
  v_closed text;
  v_flag boolean;
BEGIN
  -- The network kill switch stops invitations as it stops sending: an
  -- invitation is a participant event that would cross when it is restored.
  SELECT (value = 'true'::jsonb) INTO v_flag
    FROM public.feature_flags WHERE key = 'builder_network_enabled';
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NETWORK_DISABLED';
  END IF;
  SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = _conversation_id FOR UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_FOUND';
  END IF;
  IF NOT public.builder_network_is_participant(v_c.id, _actor_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NOT_A_PARTICIPANT';
  END IF;
  v_closed := public.builder_network_conversation_closed_reason(v_c.id);
  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_OPEN';
  END IF;
  IF _invitee_user_id IS NULL OR NOT public.builder_network_invitee_eligible(_invitee_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_INVITEE_NOT_ELIGIBLE';
  END IF;
  IF public.builder_network_is_participant(v_c.id, _invitee_user_id) THEN
    RETURN 'already_participant';
  END IF;
  PERFORM public.builder_network_join_local(v_c.id, _invitee_user_id,
    public.builder_network_user_display_name(_invitee_user_id));
  PERFORM public.builder_network_kick_outbox();
  RETURN 'joined';
END
$fn$;

-- Who a participant may invite: every eligible user not already in it.
CREATE OR REPLACE FUNCTION public.builder_network_invite_candidates(
  _conversation_id uuid, _actor_user_id uuid)
RETURNS TABLE(user_id uuid, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF NOT public.builder_network_is_participant(_conversation_id, _actor_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NOT_A_PARTICIPANT';
  END IF;
  RETURN QUERY
    SELECT u.id, public.builder_network_user_display_name(u.id)
      FROM public.custom_users u
     WHERE u.is_active = true AND u.deleted_at IS NULL
       AND public.has_module_access(u.id, 'listings')
       AND public.builder_network_user_display_name(u.id) IS NOT NULL
       AND NOT public.builder_network_is_participant(_conversation_id, u.id)
     -- Every eligible colleague, in a stable order: the caller reads them a
     -- page at a time, so nobody past a fixed count is left uninvitable.
     ORDER BY 2, 1;
END
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_leave_conversation(
  _conversation_id uuid, _actor_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_c public.builder_network_conversations%ROWTYPE;
  v_p public.builder_network_conversation_participants%ROWTYPE;
  v_live boolean;
BEGIN
  -- One leave at a time per conversation, so two colleagues cannot both leave
  -- believing the other stays.
  SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = _conversation_id FOR UPDATE;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_CONVERSATION_NOT_FOUND';
  END IF;
  SELECT * INTO v_p FROM public.builder_network_conversation_participants
   WHERE conversation_id = v_c.id AND local_user_id = _actor_user_id AND state = 'joined'
   FOR UPDATE;
  IF v_p.participant_ref IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_NOT_A_PARTICIPANT';
  END IF;
  -- A live conversation keeps someone on this side; a closed one, for ANY
  -- reason, can be left freely, and leaving never erases what was said.
  -- "Live" is the same decision every other act reads, so nobody can be held
  -- in a conversation that no act can reopen from their side.
  v_live := public.builder_network_conversation_closed_reason(v_c.id) IS NULL;
  IF v_live AND NOT EXISTS (
    SELECT 1 FROM public.builder_network_conversation_participants o
     WHERE o.conversation_id = v_c.id AND o.side = 'command_centre' AND o.state = 'joined'
       AND o.participant_ref <> v_p.participant_ref) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_LAST_PARTICIPANT';
  END IF;
  UPDATE public.builder_network_conversation_participants
     SET state = 'left', version = version + 1, left_at = now(), updated_at = now()
   WHERE conversation_id = v_c.id AND participant_ref = v_p.participant_ref;
  PERFORM public.builder_network_announce_participant(v_c.id, v_p.participant_ref);
  PERFORM public.builder_network_kick_outbox();
  RETURN 'left';
END
$fn$;

-- ---------------------------------------------------------------------------
-- 5. The acknowledgement: open the conversation, add the activator, notify
--    once, email once.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_after_acknowledgement(_event_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_event public.builder_network_inbound_events%ROWTYPE;
  v_conn record;
  v_ref uuid;
  v_item uuid;
  v_s public.builder_stock_selections%ROWTYPE;
  v_name text;
  v_conversation uuid;
  v_activator text;
  v_builder text;
  v_property text;
  v_notice_id uuid;
BEGIN
  SELECT * INTO v_event FROM public.builder_network_inbound_events WHERE id = _event_id;
  IF v_event.id IS NULL OR v_event.event_type <> 'stock.selection.acknowledged'
     OR v_event.processed_at IS NULL OR v_event.apply_error IS NOT NULL THEN
    RETURN 'skipped';
  END IF;
  BEGIN
    v_ref := (v_event.payload->>'remote_selection_ref')::uuid;
    v_item := (v_event.payload->>'stock_item_id')::uuid;
  EXCEPTION WHEN others THEN v_ref := NULL; END;
  IF v_ref IS NULL THEN RETURN 'skipped'; END IF;

  SELECT c.id, c.network_connection_id, c.builder_organisation_id INTO v_conn
    FROM public.builder_network_connections c WHERE c.id = v_event.connection_id;
  -- Only the connection's OWN builder acknowledges its activation, for the
  -- property it names, while the activation is live.
  SELECT * INTO v_s FROM public.builder_stock_selections s
   WHERE s.id = v_ref AND s.organisation_id = v_conn.builder_organisation_id
     AND (v_item IS NULL OR s.stock_item_id = v_item)
     AND s.acknowledged_at IS NOT NULL AND s.status <> 'withdrawn'
   FOR UPDATE;
  IF v_s.id IS NULL OR v_conn.id IS NULL THEN RETURN 'skipped'; END IF;
  IF EXISTS (SELECT 1 FROM public.builder_network_acknowledgement_notices n
              WHERE n.selection_id = v_s.id AND n.outcome <> 'awaiting_activator') THEN
    RETURN 'already';
  END IF;

  -- Who acknowledged it, by the name the builder sent. Never an id; an
  -- acknowledgement that named nobody is left naming nobody.
  IF jsonb_typeof(v_event.payload->'acknowledged_by_display_name') = 'string' THEN
    v_name := btrim(v_event.payload->>'acknowledged_by_display_name');
    IF length(v_name) BETWEEN 1 AND 200 AND v_s.acknowledged_by_display_name IS NULL THEN
      UPDATE public.builder_stock_selections SET acknowledged_by_display_name = v_name WHERE id = v_s.id;
    END IF;
  END IF;
  v_name := COALESCE(v_s.acknowledged_by_display_name, nullif(v_name, ''));

  SELECT c.id INTO v_conversation FROM public.builder_network_conversations c
   WHERE c.connection_id = v_conn.id AND c.selection_ref = v_s.id;
  IF v_conversation IS NULL THEN
    v_conversation := public.builder_network_activation_conversation_id(v_conn.network_connection_id, v_s.id);
    INSERT INTO public.builder_network_conversations(
      id, connection_id, stock_item_id, builder_organisation_id, owner_user_id, selection_ref)
    VALUES (v_conversation, v_conn.id, v_s.stock_item_id, v_s.organisation_id, v_s.selected_by_user_id, v_s.id)
    ON CONFLICT (id) DO UPDATE SET selection_ref = COALESCE(public.builder_network_conversations.selection_ref, EXCLUDED.selection_ref);
  END IF;
  -- Events held for this acknowledgement may apply at once now.
  UPDATE public.builder_network_inbound_events
     SET message_held_until = NULL
   WHERE connection_id = v_conn.id AND message_applied_at IS NULL AND message_held_until IS NOT NULL;

  -- The activator is the Command Centre's one initial participant, and
  -- nobody is ever added in their place. An activator who is inactive or
  -- removed is not joined, notified or emailed: the acknowledgement is
  -- recorded as awaiting them, and the sweep completes it if they return.
  IF NOT EXISTS (SELECT 1 FROM public.custom_users u
                  WHERE u.id = v_s.selected_by_user_id AND u.is_active = true AND u.deleted_at IS NULL) THEN
    INSERT INTO public.builder_network_acknowledgement_notices(selection_id, outcome, conversation_id, inbound_event_id)
    VALUES (v_s.id, 'awaiting_activator', v_conversation, v_event.id)
    ON CONFLICT (selection_id) DO NOTHING;
    RETURN 'awaiting_activator';
  END IF;
  -- An active user with no name on record still joins, under a neutral one.
  v_activator := COALESCE(public.builder_network_user_display_name(v_s.selected_by_user_id), 'Command Centre user');
  PERFORM public.builder_network_join_local(v_conversation, v_s.selected_by_user_id, v_activator);

  SELECT COALESCE(nullif(btrim(o.trading_name), ''), o.legal_name) INTO v_builder
    FROM public.builder_network_stock_organisations o WHERE o.id = v_s.organisation_id;
  SELECT concat_ws(', ', nullif('Lot ' || nullif(btrim(i.lot_number), ''), 'Lot '), nullif(btrim(i.address_line), ''))
    INTO v_property FROM public.builder_network_stock_items i WHERE i.id = v_s.stock_item_id;
  v_builder := COALESCE(nullif(v_builder, ''), 'The builder');
  v_property := COALESCE(nullif(v_property, ''), 'your activated property');

  -- The bell and the badge: one notification, for the activator only, naming
  -- the builder company, the property and who acknowledged it. No client.
  BEGIN
    INSERT INTO public.notifications(type, title, message, link, target_user_id, entity_id, metadata)
    VALUES ('builder_activation_acknowledged',
            'Activation acknowledged by ' || v_builder,
            v_builder || ' acknowledged ' || v_property
              || CASE WHEN v_name IS NOT NULL THEN ' (acknowledged by ' || v_name || ')' ELSE '' END || '.',
            '/admin/builder-portal/activated', v_s.selected_by_user_id, v_conversation::text,
            jsonb_build_object('conversation_id', v_conversation, 'stock_item_id', v_s.stock_item_id))
    RETURNING id INTO v_notice_id;
    -- One email on the existing transactional outbox; the worker reads the
    -- rest at send time. It carries only which activation to describe.
    PERFORM public.enqueue_integration_event('builder_stock_selection', v_s.id,
      'builder_activation_acknowledged', 1, jsonb_build_object('selection_id', v_s.id),
      'builder_activation_acknowledged:' || v_s.id, NULL);
  END;

  INSERT INTO public.builder_network_acknowledgement_notices(selection_id, outcome, conversation_id, inbound_event_id)
  VALUES (v_s.id, 'notified', v_conversation, v_event.id)
  ON CONFLICT (selection_id) DO UPDATE
    SET outcome = 'notified', inbound_event_id = EXCLUDED.inbound_event_id
    WHERE public.builder_network_acknowledgement_notices.outcome = 'awaiting_activator';
  PERFORM public.builder_network_kick_outbox();
  RETURN 'notified';
END
$fn$;

-- The retry of any acknowledgement whose step did not complete. Run by the
-- message sweep's own schedule, never as the primary path.
CREATE OR REPLACE FUNCTION public.builder_network_process_acknowledgements(_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_event record;
  v_done integer := 0;
BEGIN
  FOR v_event IN
    SELECT e.id
      FROM public.builder_network_inbound_events e
      JOIN public.builder_network_connections c ON c.id = e.connection_id
      JOIN public.builder_stock_selections s
        ON s.id::text = e.payload->>'remote_selection_ref'
       AND s.organisation_id = c.builder_organisation_id
     WHERE e.event_type = 'stock.selection.acknowledged'
       AND e.processed_at IS NOT NULL AND e.apply_error IS NULL
       AND s.acknowledged_at IS NOT NULL AND s.status <> 'withdrawn'
       AND (
         NOT EXISTS (SELECT 1 FROM public.builder_network_acknowledgement_notices n WHERE n.selection_id = s.id)
         -- One awaiting its activator is retried only once that user is
         -- active again, so a departed user's never crowds out new work.
         OR EXISTS (SELECT 1 FROM public.builder_network_acknowledgement_notices n
                     JOIN public.custom_users u ON u.id = s.selected_by_user_id
                    WHERE n.selection_id = s.id AND n.outcome = 'awaiting_activator'
                      AND u.is_active = true AND u.deleted_at IS NULL))
     ORDER BY e.received_at
     LIMIT greatest(1, least(_limit, 200))
  LOOP
    BEGIN
      IF public.builder_network_after_acknowledgement(v_event.id) = 'notified' THEN
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN others THEN
      PERFORM public.builder_network_media_note('builder_network_acknowledgement_step_failed', 'warning', v_event.id,
        jsonb_build_object('error', left(SQLERRM, 200)));
    END;
  END LOOP;
  RETURN v_done;
END
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_acknowledgement_applied()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  -- Never able to fail the acknowledgement it follows: a fault here is
  -- recorded and retried by the message sweep.
  BEGIN
    PERFORM public.builder_network_after_acknowledgement(NEW.id);
  EXCEPTION WHEN others THEN
    PERFORM public.builder_network_media_note('builder_network_acknowledgement_step_failed', 'warning', NEW.id,
      jsonb_build_object('error', left(SQLERRM, 200)));
  END;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_builder_network_acknowledgement_applied ON public.builder_network_inbound_events;
CREATE TRIGGER trg_builder_network_acknowledgement_applied
  AFTER UPDATE OF processed_at ON public.builder_network_inbound_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'stock.selection.acknowledged' AND NEW.processed_at IS NOT NULL
        AND OLD.processed_at IS NULL AND NEW.apply_error IS NULL)
  EXECUTE FUNCTION public.builder_network_acknowledgement_applied();

-- The builder company's own public contact details arrive with its property,
-- and are kept where the main sweep's own version rule kept its name.
CREATE OR REPLACE FUNCTION public.builder_network_organisation_contact_applied()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_org uuid;
  v_o jsonb := NEW.payload->'organisation';
  v_email text; v_phone text; v_site text;
BEGIN
  BEGIN
    v_org := (NEW.payload->>'organisation_id')::uuid;
  EXCEPTION WHEN others THEN RETURN NEW; END;
  IF jsonb_typeof(v_o) <> 'object' THEN RETURN NEW; END IF;
  v_email := CASE WHEN jsonb_typeof(v_o->'contact_email') = 'string' THEN nullif(btrim(v_o->>'contact_email'), '') END;
  v_phone := CASE WHEN jsonb_typeof(v_o->'contact_phone') = 'string' THEN nullif(btrim(v_o->>'contact_phone'), '') END;
  v_site := CASE WHEN jsonb_typeof(v_o->'website') = 'string' THEN nullif(btrim(v_o->>'website'), '') END;
  IF v_email IS NOT NULL AND (length(v_email) > 320 OR v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') THEN v_email := NULL; END IF;
  IF v_phone IS NOT NULL AND length(v_phone) > 50 THEN v_phone := NULL; END IF;
  IF v_site IS NOT NULL AND (length(v_site) > 500 OR v_site !~* '^https?://') THEN v_site := NULL; END IF;
  UPDATE public.builder_network_stock_organisations o
     SET contact_email = v_email, contact_phone = v_phone, website = v_site
   WHERE o.id = v_org AND o.source_version = COALESCE(NEW.source_version, 0)
     AND ROW(o.contact_email, o.contact_phone, o.website) IS DISTINCT FROM ROW(v_email, v_phone, v_site);
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_builder_network_organisation_contact_applied ON public.builder_network_inbound_events;
CREATE TRIGGER trg_builder_network_organisation_contact_applied
  AFTER UPDATE OF processed_at ON public.builder_network_inbound_events
  FOR EACH ROW
  WHEN (NEW.event_type = 'stock.item.upserted' AND NEW.processed_at IS NOT NULL
        AND OLD.processed_at IS NULL AND NEW.apply_error IS NULL)
  EXECUTE FUNCTION public.builder_network_organisation_contact_applied();

-- ---------------------------------------------------------------------------
-- 6. Binding a conversation that already existed. Called only by the
--    `agency-chat-backfill` phase, where both projects agree; nothing here
--    notifies or emails.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_seed_activation_conversation(
  _selection_id uuid, _conversation_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_s public.builder_stock_selections%ROWTYPE;
  v_c public.builder_network_conversations%ROWTYPE;
  v_conn record;
  v_activator text;
BEGIN
  SELECT * INTO v_s FROM public.builder_stock_selections WHERE id = _selection_id FOR UPDATE;
  IF v_s.id IS NULL OR v_s.acknowledged_at IS NULL OR v_s.status = 'withdrawn' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_SEED_NOT_ACKNOWLEDGED';
  END IF;
  SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = _conversation_id FOR UPDATE;
  IF v_c.id IS NOT NULL THEN
    -- An existing conversation is bound only to an activation of ITS property
    -- by ITS builder, and never re-bound.
    IF v_c.stock_item_id <> v_s.stock_item_id OR v_c.builder_organisation_id <> v_s.organisation_id
       OR (v_c.selection_ref IS NOT NULL AND v_c.selection_ref <> v_s.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_SEED_MISMATCH';
    END IF;
    IF EXISTS (SELECT 1 FROM public.builder_network_conversations o
                WHERE o.selection_ref = v_s.id AND o.id <> v_c.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_SEED_MISMATCH';
    END IF;
  ELSE
    -- A new one must be the derivation of this activation on its builder's
    -- connection.
    SELECT c.id, c.network_connection_id INTO v_conn
      FROM public.builder_network_connections c
     WHERE c.builder_organisation_id = v_s.organisation_id
       AND public.builder_network_activation_conversation_id(c.network_connection_id, v_s.id) = _conversation_id;
    IF v_conn.id IS NULL OR EXISTS (SELECT 1 FROM public.builder_network_conversations o WHERE o.selection_ref = v_s.id) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_SEED_MISMATCH';
    END IF;
  END IF;

  v_activator := public.builder_network_user_display_name(v_s.selected_by_user_id);
  IF v_activator IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'AGENCY_SEED_ACTIVATOR_INACTIVE';
  END IF;

  IF v_c.id IS NOT NULL AND v_c.selection_ref = v_s.id AND EXISTS (
    SELECT 1 FROM public.builder_network_conversation_participants p
     WHERE p.conversation_id = v_c.id AND p.local_user_id = v_s.selected_by_user_id) THEN
    RETURN 'already_seeded';
  END IF;

  IF v_c.id IS NULL THEN
    INSERT INTO public.builder_network_conversations(
      id, connection_id, stock_item_id, builder_organisation_id, owner_user_id, selection_ref)
    VALUES (_conversation_id, v_conn.id, v_s.stock_item_id, v_s.organisation_id, v_s.selected_by_user_id, v_s.id);
  ELSE
    UPDATE public.builder_network_conversations SET selection_ref = v_s.id WHERE id = v_c.id;
  END IF;
  PERFORM public.builder_network_join_local(_conversation_id, v_s.selected_by_user_id, v_activator);
  INSERT INTO public.builder_network_acknowledgement_notices(selection_id, outcome, conversation_id)
  VALUES (v_s.id, 'historical', _conversation_id)
  ON CONFLICT (selection_id) DO NOTHING;
  PERFORM public.builder_network_kick_outbox();
  RETURN 'seeded';
END
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Receiving: the builder's messages, receipts and participants.
-- ---------------------------------------------------------------------------
-- Which conversation an event names, as this side knows it: its row, on this
-- connection and property; or, new, the derivation of a live, ACKNOWLEDGED
-- activation of this property on this connection (created then). NULL for
-- anything else: the acknowledgement is what opens a conversation, so nothing
-- signed can open one, or put anybody or anything in it, ahead of it.
CREATE OR REPLACE FUNCTION public.builder_network_resolve_conversation(
  _connection_id uuid, _conversation_id uuid, _stock_item_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_conn record;
  v_s public.builder_stock_selections%ROWTYPE;
BEGIN
  IF EXISTS (SELECT 1 FROM public.builder_network_conversations c
              WHERE c.id = _conversation_id AND c.connection_id = _connection_id
                AND c.stock_item_id = _stock_item_id) THEN
    RETURN _conversation_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.builder_network_conversations c WHERE c.id = _conversation_id) THEN
    RETURN NULL;
  END IF;
  SELECT c.id, c.network_connection_id, c.builder_organisation_id INTO v_conn
    FROM public.builder_network_connections c WHERE c.id = _connection_id;
  SELECT * INTO v_s FROM public.builder_stock_selections s
   WHERE s.stock_item_id = _stock_item_id AND s.organisation_id = v_conn.builder_organisation_id
     AND s.status <> 'withdrawn' AND s.acknowledged_at IS NOT NULL
     AND public.builder_network_activation_conversation_id(v_conn.network_connection_id, s.id) = _conversation_id
     AND NOT EXISTS (SELECT 1 FROM public.builder_network_conversations o
                      WHERE o.connection_id = _connection_id AND o.selection_ref = s.id)
   LIMIT 1;
  IF v_s.id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.builder_network_conversations(
    id, connection_id, stock_item_id, builder_organisation_id, owner_user_id, selection_ref)
  VALUES (_conversation_id, _connection_id, _stock_item_id, v_s.organisation_id, v_s.selected_by_user_id, v_s.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN _conversation_id;
END
$fn$;

-- A builder's participant: a display record, settled on its highest version.
-- An event naming the conversation of one of this side's own live
-- activations that is not acknowledged here YET: the builder emits it only
-- after acknowledging, and the two events travel separately, so it can land
-- first. It waits (held, unconsumed) for the acknowledgement rather than
-- being refused and lost; once the activation is withdrawn it no longer
-- waits and is refused as before.
CREATE OR REPLACE FUNCTION public.builder_network_awaiting_acknowledgement(
  _connection_id uuid, _conversation_id uuid, _stock_item_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_network_connections c
      JOIN public.builder_stock_selections s
        ON s.organisation_id = c.builder_organisation_id AND s.stock_item_id = _stock_item_id
     WHERE c.id = _connection_id
       AND s.status <> 'withdrawn' AND s.acknowledged_at IS NULL
       AND public.builder_network_activation_conversation_id(c.network_connection_id, s.id) = _conversation_id
       AND NOT EXISTS (SELECT 1 FROM public.builder_network_conversations v WHERE v.id = _conversation_id))
$fn$;

CREATE OR REPLACE FUNCTION public.builder_network_apply_participant_event(
  _event_id uuid, _connection record, _payload jsonb)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_conversation uuid;
  v_ref uuid;
  v_item uuid;
  v_version integer;
  v_name text := btrim(COALESCE(_payload->>'display_name', ''));
  v_state text := _payload->>'state';
  v_existing public.builder_network_conversation_participants%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(_payload) k
     WHERE k <> ALL (ARRAY['conversation_id', 'display_name', 'participant_ref', 'schema_version',
                           'side', 'state', 'stock_item_id', 'version']))
     OR (SELECT count(*) FROM jsonb_object_keys(_payload)) <> 8
     OR EXISTS (
    SELECT 1 FROM jsonb_each(_payload) kv
     WHERE jsonb_typeof(kv.value) <> CASE WHEN kv.key IN ('version', 'schema_version') THEN 'number' ELSE 'string' END) THEN
    RETURN 'refused:invalid_payload';
  END IF;
  BEGIN
    v_conversation := (_payload->>'conversation_id')::uuid;
    v_ref := (_payload->>'participant_ref')::uuid;
    v_item := (_payload->>'stock_item_id')::uuid;
    v_version := (_payload->>'version')::integer;
  EXCEPTION WHEN others THEN
    RETURN 'refused:invalid_payload';
  END;
  IF (_payload->>'schema_version') <> '1' OR v_version IS NULL OR v_version < 1
     OR (_payload->>'version') !~ '^[0-9]+$'
     OR v_state NOT IN ('joined', 'left') OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    RETURN 'refused:invalid_payload';
  END IF;
  -- Always the SENDER's own side: a builder announces builder participants.
  IF _payload->>'side' <> 'builder' THEN
    RETURN 'refused:side_mismatch';
  END IF;
  IF _connection.state <> 'active' THEN
    RETURN 'refused:connection_not_active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.builder_network_stock_items i
                  WHERE i.id = v_item AND i.organisation_id = _connection.builder_organisation_id) THEN
    RETURN 'refused:stock_item_not_ours';
  END IF;
  IF public.builder_network_resolve_conversation(_connection.id, v_conversation, v_item) IS NULL THEN
    IF public.builder_network_awaiting_acknowledgement(_connection.id, v_conversation, v_item) THEN
      RETURN 'held';
    END IF;
    RETURN 'refused:conversation_mismatch';
  END IF;

  SELECT * INTO v_existing FROM public.builder_network_conversation_participants
   WHERE conversation_id = v_conversation AND participant_ref = v_ref FOR UPDATE;
  IF v_existing.participant_ref IS NOT NULL AND (v_existing.side <> 'builder' OR v_existing.local_user_id IS NOT NULL) THEN
    RETURN 'refused:participant_conflict';
  END IF;
  INSERT INTO public.builder_network_conversation_participants(
    conversation_id, participant_ref, side, local_user_id, display_name, state, version, joined_at, left_at)
  VALUES (v_conversation, v_ref, 'builder', NULL, v_name, v_state, v_version,
          CASE WHEN v_state = 'joined' THEN now() END, CASE WHEN v_state = 'left' THEN now() END)
  ON CONFLICT (conversation_id, participant_ref) DO UPDATE
     SET display_name = EXCLUDED.display_name, state = EXCLUDED.state, version = EXCLUDED.version,
         joined_at = COALESCE(EXCLUDED.joined_at, public.builder_network_conversation_participants.joined_at),
         left_at = EXCLUDED.left_at, updated_at = now()
   WHERE EXCLUDED.version > public.builder_network_conversation_participants.version
     AND public.builder_network_conversation_participants.side = 'builder'
     AND public.builder_network_conversation_participants.local_user_id IS NULL;
  RETURN 'applied';
END
$fn$;

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
  v_c public.builder_network_conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_event FROM public.builder_network_inbound_events WHERE id = _event_id;
  v_payload := COALESCE(v_event.payload, '{}'::jsonb);

  SELECT c.id, c.state, c.builder_organisation_id, c.network_connection_id, c.identity_mismatch_since
    INTO v_connection
    FROM public.builder_network_connections c WHERE c.id = v_event.connection_id
   FOR SHARE;
  IF v_connection.id IS NULL THEN
    RETURN 'refused:connection_not_active';
  END IF;
  IF v_connection.identity_mismatch_since IS NOT NULL THEN
    RETURN 'held';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RETURN 'refused:invalid_payload';
  END IF;

  -- ── A builder participant: display only ─────────────────────────────────
  IF v_event.event_type = 'agency.message.participant' THEN
    RETURN public.builder_network_apply_participant_event(_event_id, v_connection, v_payload);
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_payload) k
     WHERE k <> ALL (CASE WHEN v_event.event_type = 'agency.message.posted'
                          THEN ARRAY['body', 'conversation_id', 'generation', 'message_id', 'schema_version',
                                     'sender_display_name', 'sent_at', 'stock_item_id']
                          ELSE ARRAY['conversation_id', 'generation', 'message_id', 'outcome', 'reason',
                                     'schema_version'] END)) THEN
    RETURN 'refused:invalid_payload';
  END IF;
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

  -- ── A receipt for something this side sent (unchanged) ──────────────────
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

  -- ── The builder's message ───────────────────────────────────────────────
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

  IF v_item IS NOT NULL THEN
    PERFORM 1 FROM public.builder_network_stock_items i WHERE i.id = v_item FOR SHARE;
  END IF;
  IF v_item IS NULL OR v_sent IS NULL OR NOT isfinite(v_sent)
     OR (v_payload->>'sent_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
     OR v_sent > now() + interval '5 minutes'
     OR length(v_body) NOT BETWEEN 1 AND 4000
     OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    v_reason := 'invalid_message';
  ELSIF NOT EXISTS (SELECT 1 FROM public.builder_network_connections c
                     WHERE c.id = v_connection.id AND 'stock:publish' = ANY (c.scopes)) THEN
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
    SELECT * INTO v_existing FROM public.builder_network_messages WHERE id = v_message_id;
    IF v_existing.id IS NULL
       OR v_existing.conversation_id <> v_conversation_id OR v_existing.side <> 'builder'
       OR v_existing.body <> v_body OR v_existing.sender_display_name <> left(v_name, 200)
       OR v_existing.sent_at <> v_sent THEN
      v_reason := 'stock_item_not_ours';
    END IF;
    v_existing := NULL;
  ELSIF public.builder_network_resolve_conversation(v_connection.id, v_conversation_id, v_item) IS NULL THEN
    IF public.builder_network_awaiting_acknowledgement(v_connection.id, v_conversation_id, v_item) THEN
      RETURN 'held';
    END IF;
    v_reason := 'conversation_mismatch';
  ELSE
    SELECT * INTO v_c FROM public.builder_network_conversations WHERE id = v_conversation_id;
    IF v_c.selection_ref IS NOT NULL THEN
      PERFORM 1 FROM public.builder_stock_selections s WHERE s.id = v_c.selection_ref FOR SHARE;
    ELSE
      PERFORM 1 FROM public.builder_stock_selections s
       WHERE s.stock_item_id = v_item AND s.organisation_id = v_connection.builder_organisation_id
         AND s.status <> 'withdrawn'
       FOR SHARE OF s;
    END IF;
    -- Open while ITS activation is live (a conversation never bound to one
    -- keeps Step 5's rule until it is), and the property still listed.
    IF NOT (CASE WHEN v_c.selection_ref IS NOT NULL
                 THEN EXISTS (SELECT 1 FROM public.builder_stock_selections s
                               WHERE s.id = v_c.selection_ref AND s.status <> 'withdrawn'
                                 AND s.acknowledged_at IS NOT NULL)
                 ELSE EXISTS (SELECT 1 FROM public.builder_stock_selections s
                               WHERE s.stock_item_id = v_item
                                 AND s.organisation_id = v_connection.builder_organisation_id
                                 AND s.status <> 'withdrawn') END)
       OR NOT EXISTS (SELECT 1 FROM public.builder_network_stock_items i
                       WHERE i.id = v_item AND i.lifecycle_status = 'active') THEN
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
    INSERT INTO public.builder_network_messages(
      id, conversation_id, side, sender_display_name, body, sent_at, received_at)
    VALUES (v_message_id, v_conversation_id, 'builder', left(v_name, 200), v_body, v_sent, now())
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
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
       AND e.event_type IN ('agency.message.posted', 'agency.message.receipt', 'agency.message.participant')
       AND (e.message_held_until IS NULL OR e.message_held_until <= now())
       AND NOT EXISTS (
         SELECT 1 FROM public.builder_network_connections c
          WHERE c.id = e.connection_id AND c.identity_mismatch_since IS NOT NULL)
       -- An event about a conversation never overtakes the activation it
       -- depends on: it waits, unconsumed, while an activation event that
       -- landed before it on the same connection is still unapplied.
       AND NOT EXISTS (
         SELECT 1 FROM public.builder_network_inbound_events p
          WHERE p.connection_id = e.connection_id AND p.processed_at IS NULL
            AND p.event_type LIKE 'stock.selection.%'
            AND (p.received_at, p.id) < (e.received_at, e.id))
     ORDER BY e.received_at, e.id
     LIMIT greatest(1, least(_limit, 500))
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      v_result := public.builder_network_apply_message_event(v_event.id);
      IF v_result = 'held' THEN
        -- Passed over for a while rather than re-taken at the head of every sweep.
        UPDATE public.builder_network_inbound_events
           SET message_held_until = now() + interval '5 minutes'
         WHERE id = v_event.id;
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
  -- The retry for an acknowledgement whose step did not complete.
  BEGIN
    PERFORM public.builder_network_process_acknowledgements(50);
  EXCEPTION WHEN others THEN NULL;
  END;
  applied := v_applied; refused := v_refused; deferred := v_deferred;
  RETURN NEXT;
END
$fn$;

DROP TRIGGER IF EXISTS trg_builder_network_message_lane ON public.builder_network_inbound_events;
CREATE TRIGGER trg_builder_network_message_lane
  BEFORE INSERT ON public.builder_network_inbound_events
  FOR EACH ROW
  WHEN (NEW.event_type IN ('agency.message.posted', 'agency.message.receipt', 'agency.message.participant'))
  EXECUTE FUNCTION public.builder_network_message_lane();

-- ---------------------------------------------------------------------------
-- 7b. The acknowledgement email's lease.
--
-- `email_sent_at` is written only AFTER the email has gone, by the holder of
-- the current lease. A claim that is still fresh answers `held` (the caller
-- retries later); a claim whose lease has run out was abandoned by a worker
-- that died, and is taken over with a new token, so the dead worker can no
-- longer record anything.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.builder_network_claim_acknowledgement_email(
  _selection_id uuid, _lease_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n public.builder_network_acknowledgement_notices%ROWTYPE;
  v_token uuid;
BEGIN
  SELECT * INTO v_n FROM public.builder_network_acknowledgement_notices
   WHERE selection_id = _selection_id FOR UPDATE;
  IF NOT FOUND OR v_n.outcome <> 'notified' THEN
    RETURN jsonb_build_object('state', 'not_owed');
  END IF;
  IF v_n.email_sent_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'sent');
  END IF;
  IF v_n.email_claim_token IS NOT NULL
     AND v_n.email_claimed_at > now() - make_interval(secs => greatest(coalesce(_lease_seconds, 0), 0)) THEN
    RETURN jsonb_build_object('state', 'held',
      'until', v_n.email_claimed_at + make_interval(secs => greatest(coalesce(_lease_seconds, 0), 0)));
  END IF;
  v_token := gen_random_uuid();
  UPDATE public.builder_network_acknowledgement_notices
     SET email_claim_token = v_token, email_claimed_at = clock_timestamp()
   WHERE selection_id = _selection_id;
  RETURN jsonb_build_object('state', 'claimed', 'token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION public.builder_network_settle_acknowledgement_email(
  _selection_id uuid, _token uuid, _sent boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.builder_network_acknowledgement_notices
     SET email_sent_at = CASE WHEN _sent THEN now() ELSE email_sent_at END,
         email_claim_token = NULL,
         email_claimed_at = NULL
   WHERE selection_id = _selection_id
     AND email_claim_token = _token
     AND email_sent_at IS NULL;
  RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.builder_network_activation_conversation_id(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_user_display_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_announce_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_join_local(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_is_participant(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_conversation_closed_reason(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_post_message(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_retry_message(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_invitee_eligible(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_invite_participant(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_invite_candidates(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_leave_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_after_acknowledgement(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_process_acknowledgements(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_acknowledgement_applied() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_organisation_contact_applied() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_seed_activation_conversation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_resolve_conversation(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_awaiting_acknowledgement(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_apply_participant_event(uuid, record, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_apply_message_event(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_apply_message_events(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_claim_acknowledgement_email(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.builder_network_settle_acknowledgement_email(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.builder_network_is_participant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_conversation_closed_reason(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_post_message(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_retry_message(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_invite_participant(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_invite_candidates(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_leave_conversation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_claim_acknowledgement_email(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_settle_acknowledgement_email(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_process_acknowledgements(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_seed_activation_conversation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_apply_message_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.builder_network_activation_conversation_id(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. Asserted by effect.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF public.builder_network_activation_conversation_id(
       '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')
     IS DISTINCT FROM md5('agency.activation:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000002')::uuid THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the conversation id is not the shared derivation';
  END IF;
  IF has_table_privilege('authenticated', 'public.builder_network_conversation_participants', 'SELECT')
     OR has_table_privilege('anon', 'public.builder_network_conversation_participants', 'SELECT')
     OR has_function_privilege('authenticated', 'public.builder_network_invite_participant(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.builder_network_post_message(uuid,uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: a private conversation is reachable from a browser role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname ~ '^builder_network_.*(remove|kick_participant|evict)') THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: something can remove a participant';
  END IF;
  IF EXISTS (SELECT 1 FROM public.builder_stock_selections s
              WHERE s.acknowledged_at IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.builder_network_acknowledgement_notices n WHERE n.selection_id = s.id)) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: an existing acknowledgement could still be notified';
  END IF;
END $$;

COMMIT;
