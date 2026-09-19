
-- 1. Optional client_id link on conversations
ALTER TABLE public.report_qa_conversations
  ADD COLUMN IF NOT EXISTS client_id uuid;

CREATE INDEX IF NOT EXISTS report_qa_conversations_client_id_idx
  ON public.report_qa_conversations (client_id);

-- 2. Per-client memory store
CREATE TABLE IF NOT EXISTS public.client_qa_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  user_id uuid,
  kind text NOT NULL CHECK (kind IN ('goal','preference','risk','decision','fact')),
  content text NOT NULL,
  importance smallint NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  source_conversation_id uuid,
  source_message_id uuid,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS client_qa_memory_dedupe_idx
  ON public.client_qa_memory (client_id, kind, content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_qa_memory_client_idx
  ON public.client_qa_memory (client_id, importance DESC, updated_at DESC);

ALTER TABLE public.client_qa_memory ENABLE ROW LEVEL SECURITY;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.client_qa_memory_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_qa_memory_updated ON public.client_qa_memory;
CREATE TRIGGER trg_client_qa_memory_updated
BEFORE UPDATE ON public.client_qa_memory
FOR EACH ROW EXECUTE FUNCTION public.client_qa_memory_touch_updated_at();
