-- Phase B: Conversations replay migration support

ALTER TABLE public.ghl_conversations
  ADD COLUMN IF NOT EXISTS new_ghl_conversation_id text,
  ADD COLUMN IF NOT EXISTS replayed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ghl_conversations_new_id
  ON public.ghl_conversations (new_ghl_conversation_id)
  WHERE new_ghl_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ghl_conversations_unreplayed
  ON public.ghl_conversations (id)
  WHERE new_ghl_conversation_id IS NULL;

ALTER TABLE public.ghl_conversation_messages
  ADD COLUMN IF NOT EXISTS new_ghl_message_id text,
  ADD COLUMN IF NOT EXISTS replayed_at timestamptz,
  ADD COLUMN IF NOT EXISTS replay_skipped_reason text;

CREATE INDEX IF NOT EXISTS idx_ghl_messages_new_id
  ON public.ghl_conversation_messages (new_ghl_message_id)
  WHERE new_ghl_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ghl_messages_conversation_chrono
  ON public.ghl_conversation_messages (conversation_id, ghl_date_added);