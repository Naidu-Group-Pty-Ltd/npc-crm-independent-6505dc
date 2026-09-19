ALTER TABLE public.internal_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.internal_messages
  ALTER COLUMN body DROP NOT NULL;