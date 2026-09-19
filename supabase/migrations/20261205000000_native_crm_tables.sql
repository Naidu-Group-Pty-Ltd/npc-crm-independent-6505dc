-- ============================================================================
-- The CRM this platform can run WITHOUT GoHighLevel.
--
-- Measured on the prime, 19 Sep 2026: 41 edge functions call
-- `services.leadconnectorhq.com` directly, and four product surfaces carry the
-- tie-up. Three of them already have a Supabase mirror to read from
-- (`ghl_conversations`, `ghl_client_opportunities`, `ghl_pipelines`). The
-- fourth does not exist at all:
--
--     SELECT ... FROM information_schema.tables WHERE table_name ~ 'appointment|calendar'
--     -> appointment_secondary_recipients, finance_partner_bookings.  Nothing else.
--
-- **The Calendar page is live GoHighLevel on every read.** `ghl-calendar`
-- (964 lines) answers eleven actions straight out of the vendor's API and no
-- row of it is ever persisted here. That is why this migration is mostly a
-- calendar: the other three surfaces are a substitution, and this one is a
-- build.
--
-- ── Why these tables exist on EVERY deployment, not just the independent one ─
--
-- A clone's backend is not migrated per module. `THE_CLONING_ENGINE.md`:
-- "the drain replicates the prime's **live catalogue** by introspection (641
-- tables, 1,149 policies, …), not per module … `modules.clone_migration_sql`
-- is empty for all 134 rows **by design, not omission**". So a table that is
-- absent from the prime is absent from every clone ever provisioned, and a
-- CRM-independent clone could not be given one later without leaving the
-- engine. These tables therefore land on the prime and on all five existing
-- clones, where they stay EMPTY and unread because `CRM_PROVIDER` is unset and
-- resolves to `ghl`. Empty is the correct state for them there.
--
-- Nothing below alters an existing table, column, policy or function. Read on
-- a GHL deployment this migration is inert.
--
-- ── Why `client_management` and not a new capability key ────────────────────
--
-- Every policy here gates on `current_user_can_view('client_management')` —
-- the key the `clients` table itself already uses — rather than a new
-- `crm_calendar`/`crm_conversations` key. A key nothing grants is a table
-- nobody can read, and this repository has shipped that failure already:
-- STEP_UP_ENFORCEMENT.md records "a control that cannot be satisfied is an
-- outage, not a control", where enforce mode demanded an assurance level no
-- account could mint. Whoever may see a client may see that client's
-- appointments, messages and deals; that is one permission, and it is granted
-- today.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- CALENDAR — the surface with no table at all today.
--
-- Shapes follow `useGHLCalendar.tsx`'s exported interfaces exactly (GHLCalendar,
-- GHLEvent, GHLFreeSlot), because `Calendar.tsx` is 2,306 lines and the whole
-- point of the provider switch is that it does not have to change. A native
-- row must project onto the same object the page already renders.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_calendars (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description     text,
  -- Mirrors GHL's `calendarType` so the page's filters keep working.
  calendar_type   text NOT NULL DEFAULT 'event'
                    CHECK (calendar_type IN ('event','round_robin','collective','class','service')),
  is_active       boolean NOT NULL DEFAULT true,
  slug            text,
  -- Drawn by `buildCalendarColorMap`; null falls back to FALLBACK_CALENDAR_COLOR
  -- rather than to an invented colour.
  event_color     text,
  -- IANA name. The product is Australian and `timezoneUtils` formats in Sydney,
  -- but a calendar that cannot state its own zone is a calendar that silently
  -- assumes one.
  timezone        text NOT NULL DEFAULT 'Australia/Sydney',
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_calendars_slug_key
  ON public.crm_calendars (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_calendars_active_idx
  ON public.crm_calendars (is_active, name);

-- A calendar's team. GHL returns `teamMembers` on every calendar and the page
-- renders them; without this the native provider would have to invent an owner.
CREATE TABLE IF NOT EXISTS public.crm_calendar_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id   uuid NOT NULL REFERENCES public.crm_calendars(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, user_id)
);
CREATE INDEX IF NOT EXISTS crm_calendar_members_calendar_idx
  ON public.crm_calendar_members (calendar_id);
CREATE INDEX IF NOT EXISTS crm_calendar_members_user_idx
  ON public.crm_calendar_members (user_id);

-- Recurring weekly availability, which is what `freeSlots` is computed FROM.
--
-- `ghl-calendar`'s freeSlots action asks the vendor and gets an answer. A
-- native deployment has to derive it, and deriving it from nothing would mean
-- either "every hour is free" or "no hour is free" — the first books staff into
-- their own evenings, the second empties the booking UI. A calendar with no row
-- here is therefore reported as having NO PUBLISHED AVAILABILITY, which is a
-- third answer and the honest one.
CREATE TABLE IF NOT EXISTS public.crm_calendar_availability (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id    uuid NOT NULL REFERENCES public.crm_calendars(id) ON DELETE CASCADE,
  -- 0 = Sunday, matching JS getDay(), because that is what the browser hands us.
  weekday        smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_minute   integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute     integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  slot_minutes   integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 480),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (end_minute > start_minute)
);
CREATE INDEX IF NOT EXISTS crm_calendar_availability_calendar_idx
  ON public.crm_calendar_availability (calendar_id, weekday);

CREATE TABLE IF NOT EXISTS public.crm_appointments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id         uuid NOT NULL REFERENCES public.crm_calendars(id) ON DELETE CASCADE,
  title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  start_time          timestamptz NOT NULL,
  end_time            timestamptz NOT NULL,
  -- `status` is the row's lifecycle; `appointment_status` is the attendee's.
  -- GHL carries both and the page reads both; collapsing them loses the
  -- difference between "this booking exists" and "they turned up".
  status              text NOT NULL DEFAULT 'booked'
                        CHECK (status IN ('booked','cancelled','blocked')),
  appointment_status  text
                        CHECK (appointment_status IS NULL OR appointment_status IN
                          ('confirmed','showed','noshow','cancelled','invalid')),
  -- The customer, when there is one. A blocked slot has none, which is exactly
  -- why this is nullable and why `blocked_reason` exists beside it.
  client_id           uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  contact_name        text,
  contact_email       text,
  contact_phone       text,
  notes               text,
  address             text,
  blocked_reason      text,
  -- Outlook is the external sync this deployment keeps (Microsoft Graph is
  -- already wired across 42 edge functions). Null means this row has never
  -- been mirrored out, which is different from "mirrored and deleted there".
  outlook_event_id    text,
  outlook_synced_at   timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  -- A blocked slot names why it is blocked; a booking does not borrow the field.
  CHECK ((status = 'blocked') = (blocked_reason IS NOT NULL))
);
-- The Calendar page's only hot query is a window over one or all calendars.
CREATE INDEX IF NOT EXISTS crm_appointments_window_idx
  ON public.crm_appointments (start_time, end_time);
CREATE INDEX IF NOT EXISTS crm_appointments_calendar_window_idx
  ON public.crm_appointments (calendar_id, start_time);
CREATE INDEX IF NOT EXISTS crm_appointments_client_idx
  ON public.crm_appointments (client_id) WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_appointments_outlook_event_key
  ON public.crm_appointments (outlook_event_id) WHERE outlook_event_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- CONVERSATIONS — a substitution, not a build.
--
-- NOTE the name. `public.conversations` already exists and is the SOLICITOR
-- transaction-case thread system (scope IN ('npc_solicitor','client_solicitor',
-- …), keyed on `transaction_cases`). It is not the CRM inbox and must never be
-- conflated with it; these tables are `crm_` for that reason alone.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_conversations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  -- Denormalised so an inbound message from somebody who is not yet a client
  -- still lands in the inbox instead of being dropped for want of a foreign key.
  contact_name     text,
  contact_email    text,
  contact_phone    text,
  -- The channel this thread is carried on. `voice` is a call log, which is a
  -- conversation with no body, and it belongs here rather than in a second list.
  channel          text NOT NULL CHECK (channel IN ('email','sms','voice','note')),
  subject          text,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','spam')),
  last_message_at  timestamptz,
  -- Counted, not derived on read: the inbox lists hundreds of threads and a
  -- per-row subquery is how a list page becomes a timeout.
  unread_count     integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  assigned_to      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_conversations_inbox_idx
  ON public.crm_conversations (status, last_message_at DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS crm_conversations_client_idx
  ON public.crm_conversations (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_conversations_email_idx
  ON public.crm_conversations (lower(contact_email)) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_conversations_phone_idx
  ON public.crm_conversations (contact_phone) WHERE contact_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_conversations_assigned_idx
  ON public.crm_conversations (assigned_to) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.crm_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      uuid NOT NULL REFERENCES public.crm_conversations(id) ON DELETE CASCADE,
  direction            text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel              text NOT NULL CHECK (channel IN ('email','sms','voice','note')),
  subject              text,
  body                 text NOT NULL DEFAULT '',
  from_address         text,
  to_address           text,
  -- The vendor that actually carried it. Null for a note, which is carried by
  -- nobody. Recorded per MESSAGE rather than per deployment because a thread
  -- can legitimately move channel mid-way.
  provider             text CHECK (provider IS NULL OR provider IN ('resend','twilio','vapi','manual')),
  provider_message_id  text,
  -- `queued` is a real state and not a synonym for `sent`: a message this
  -- platform accepted but the vendor has not confirmed must never be shown to
  -- an operator as delivered.
  delivery_status      text NOT NULL DEFAULT 'queued'
                         CHECK (delivery_status IN ('queued','sent','delivered','failed','received')),
  delivery_error       text,
  -- Voice only. Seconds; null on every other channel.
  duration_seconds     integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  recording_url        text,
  sent_by              uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- What makes a redelivered webhook idempotent. Twilio and Resend both retry.
  idempotency_key      text,
  CHECK (direction = 'inbound' OR delivery_status <> 'received')
);
CREATE INDEX IF NOT EXISTS crm_messages_thread_idx
  ON public.crm_messages (conversation_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_idempotency_key
  ON public.crm_messages (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_provider_message_key
  ON public.crm_messages (provider, provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- PIPELINES — what Client Tracker drags cards across.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.crm_pipelines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  position    integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_pipelines_order_idx
  ON public.crm_pipelines (is_active, position, name);

CREATE TABLE IF NOT EXISTS public.crm_pipeline_stages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id  uuid NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, name)
);
CREATE INDEX IF NOT EXISTS crm_pipeline_stages_pipeline_idx
  ON public.crm_pipeline_stages (pipeline_id, position);

CREATE TABLE IF NOT EXISTS public.crm_opportunities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  pipeline_id      uuid NOT NULL REFERENCES public.crm_pipelines(id) ON DELETE CASCADE,
  stage_id         uuid NOT NULL REFERENCES public.crm_pipeline_stages(id) ON DELETE RESTRICT,
  name             text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 300),
  -- Cents. A dollar stored as a float is a rounding argument with a customer.
  monetary_value_cents bigint CHECK (monetary_value_cents IS NULL OR monetary_value_cents >= 0),
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','won','lost','abandoned')),
  assigned_to      uuid,
  -- Set by the stage-change path, so "how long in this stage" is answerable
  -- without reconstructing it from an event log that may have been pruned.
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_opportunities_board_idx
  ON public.crm_opportunities (pipeline_id, stage_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_opportunities_client_idx
  ON public.crm_opportunities (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_opportunities_stage_idx
  ON public.crm_opportunities (stage_id);
CREATE INDEX IF NOT EXISTS crm_opportunities_assigned_idx
  ON public.crm_opportunities (assigned_to) WHERE assigned_to IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- Row level security.
--
-- `check-migration-security.mjs` rule `table_rls` requires it on every new
-- table in `public`, and the reason is this project's own: the publishable key
-- ships in the browser bundle and `anon` inherits PUBLIC.
--
-- Read and write both gate on `client_management`, the key `clients` uses.
-- `service_role` bypasses RLS entirely and needs no policy; the edge functions
-- below run as service role and do their own authorisation, which is the
-- pattern every other table here follows.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.crm_calendars             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_calendar_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_calendar_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_appointments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_conversations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_pipelines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_pipeline_stages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunities         ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_calendars','crm_calendar_members','crm_calendar_availability',
    'crm_appointments','crm_conversations','crm_messages',
    'crm_pipelines','crm_pipeline_stages','crm_opportunities'
  ] LOOP
    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I ON public.%2$I;
      CREATE POLICY %1$I ON public.%2$I FOR SELECT TO authenticated
        USING (public.current_user_can_view('client_management'));
    $f$, t || '_select', t);

    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I ON public.%2$I;
      CREATE POLICY %1$I ON public.%2$I FOR INSERT TO authenticated
        WITH CHECK (public.current_user_can_edit('client_management'));
    $f$, t || '_insert', t);

    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I ON public.%2$I;
      CREATE POLICY %1$I ON public.%2$I FOR UPDATE TO authenticated
        USING (public.current_user_can_edit('client_management'))
        WITH CHECK (public.current_user_can_edit('client_management'));
    $f$, t || '_update', t);

    EXECUTE format($f$
      DROP POLICY IF EXISTS %1$I ON public.%2$I;
      CREATE POLICY %1$I ON public.%2$I FOR DELETE TO authenticated
        USING (public.current_user_can_delete('client_management'));
    $f$, t || '_delete', t);
  END LOOP;
END $$;

COMMIT;
