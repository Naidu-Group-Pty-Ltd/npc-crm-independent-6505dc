ALTER TABLE public.internal_messages
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';

ALTER TABLE public.internal_messages
  DROP CONSTRAINT IF EXISTS internal_messages_priority_check;

ALTER TABLE public.internal_messages
  ADD CONSTRAINT internal_messages_priority_check
  CHECK (priority IN ('normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS internal_messages_priority_idx
  ON public.internal_messages (thread_id, priority, created_at DESC);