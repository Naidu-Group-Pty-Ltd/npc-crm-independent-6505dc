-- Re-issue of 20260723150000_conversation_message_delivery_safety.sql, which
-- has never been applied to any database in the fleet.
--
-- WHY A SECOND FILE RATHER THAN A REPLAY
--
-- Mission Control's migration lane — `public.schema_migration_queue` — was
-- built on 28 Aug 2026 and its oldest entry is `20260828020000`. Anything
-- committed before that date has no route to a clone's database, and the
-- prime's own ledger (`supabase_migrations.schema_migrations`) has no
-- `20260723150000` row either. Measured 13 Sep 2026 against the live prime:
-- the three columns below are absent from `information_schema.columns`, and
-- the only applied migration in the whole ledger that so much as mentions
-- `client_request_id` is an AML one, against a different table.
--
-- WHAT THAT COST, WHILE EVERY GATE STAYED GREEN
--
-- The feature is idempotent outbound sending and a retained failure state for
-- the CRM retry action, and it has never worked:
--
--   `send-ghl-message` looks a duplicate up with
--   `.eq('client_request_id', idempotencyKey)` and writes the key back on the
--   way out, so no send has ever been de-duplicated and every send's persist
--   step names a column PostgREST answers PGRST204 for.
--
--   `sync-ghl-conversations` wrote `available_channels` after every
--   conversation's messages, with the error not even destructured — silently
--   nothing, on every conversation, on every run.
--
--   `Conversations.tsx` filters the inbox on `c.available_channels?.some(…)`,
--   which is `undefined` on every row, so that filter has never matched.
--
-- `check-edge-column-names.mjs` cannot see this class: it judges the generated
-- types UNION the migrations, and a column named by a committed migration
-- reads as a column that exists. The schema is what the DATABASE has.
--
-- Everything below is additive and idempotent, so a later replay of the 23 Jul
-- file is a no-op rather than a conflict.

ALTER TABLE public.ghl_conversation_messages
  ADD COLUMN IF NOT EXISTS client_request_id text,
  ADD COLUMN IF NOT EXISTS error_message text;

ALTER TABLE public.ghl_conversations
  ADD COLUMN IF NOT EXISTS available_channels text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_conversation_messages_client_request_id
  ON public.ghl_conversation_messages (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Historical data can contain provider aliases. Normalise it once so inbox
-- summaries and channel filters agree with message history. Going forward
-- `_shared/ghlConversationMap.pure.ts` is the one place that maps them.
UPDATE public.ghl_conversation_messages
SET channel_type = CASE lower(channel_type)
  WHEN 'type_email' THEN 'email'
  WHEN 'mail' THEN 'email'
  WHEN 'type_whatsapp' THEN 'whatsapp'
  WHEN 'whats_app' THEN 'whatsapp'
  WHEN 'type_sms' THEN 'sms'
  WHEN 'type_sms_reaction' THEN 'sms'
  WHEN 'type_phone' THEN 'sms'
  WHEN 'phone' THEN 'sms'
  ELSE lower(channel_type)
END
WHERE lower(channel_type) IN (
  'type_email', 'mail', 'type_whatsapp', 'whats_app',
  'type_sms', 'type_sms_reaction', 'type_phone', 'phone'
);

UPDATE public.ghl_conversations c
SET available_channels = channels.values
FROM (
  SELECT conversation_id, array_agg(DISTINCT channel_type ORDER BY channel_type) AS values
  FROM public.ghl_conversation_messages
  WHERE channel_type IN ('sms', 'email', 'whatsapp')
  GROUP BY conversation_id
) channels
WHERE c.id = channels.conversation_id
  AND c.available_channels IS DISTINCT FROM channels.values;
