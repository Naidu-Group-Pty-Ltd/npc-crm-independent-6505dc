ALTER TABLE public.internal_message_threads
  DROP CONSTRAINT IF EXISTS internal_message_threads_kind_check;

ALTER TABLE public.internal_message_threads
  ADD CONSTRAINT internal_message_threads_kind_check
  CHECK (kind = ANY (ARRAY['direct'::text, 'group'::text, 'broadcast'::text]));

ALTER TABLE public.internal_thread_participants
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member';

CREATE INDEX IF NOT EXISTS internal_thread_participants_user_archived_idx
  ON public.internal_thread_participants (user_id, archived_at);
