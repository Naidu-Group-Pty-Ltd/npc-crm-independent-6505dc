
-- 1) Paragraph + page metadata on document_chunks
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS paragraph_index INTEGER,
  ADD COLUMN IF NOT EXISTS page_number INTEGER;

CREATE INDEX IF NOT EXISTS idx_document_chunks_doc_para
  ON public.document_chunks (conversation_id, document_name, paragraph_index);

-- 2) Citations + comparison metadata on report_qa_messages
ALTER TABLE public.report_qa_messages
  ADD COLUMN IF NOT EXISTS citations JSONB,
  ADD COLUMN IF NOT EXISTS comparison_mode BOOLEAN NOT NULL DEFAULT false;

-- 3) Replace match_document_chunks to return paragraph_index + page_number
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, uuid, double precision, integer);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector,
  match_conversation_id uuid DEFAULT NULL,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 10
)
RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  document_name text,
  chunk_index integer,
  chunk_text text,
  paragraph_index integer,
  page_number integer,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.conversation_id,
    dc.document_name,
    dc.chunk_index,
    dc.chunk_text,
    dc.paragraph_index,
    dc.page_number,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM public.document_chunks dc
  WHERE
    (match_conversation_id IS NULL OR dc.conversation_id = match_conversation_id)
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 4) Stream checkpoint table for resumable SSE
CREATE TABLE IF NOT EXISTS public.report_qa_stream_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id TEXT NOT NULL UNIQUE,
  conversation_id UUID,
  user_id UUID,
  question TEXT,
  partial_content TEXT NOT NULL DEFAULT '',
  citations JSONB,
  model_provider TEXT,
  comparison_mode BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'streaming',
  error_message TEXT,
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stream_ckpt_conv ON public.report_qa_stream_checkpoints (conversation_id);
CREATE INDEX IF NOT EXISTS idx_stream_ckpt_status ON public.report_qa_stream_checkpoints (status, last_event_at DESC);

ALTER TABLE public.report_qa_stream_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only - stream checkpoints"
  ON public.report_qa_stream_checkpoints;
CREATE POLICY "Service role only - stream checkpoints"
  ON public.report_qa_stream_checkpoints
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Touch updated_at on update
CREATE OR REPLACE FUNCTION public.touch_stream_checkpoint_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stream_ckpt_touch ON public.report_qa_stream_checkpoints;
CREATE TRIGGER trg_stream_ckpt_touch
  BEFORE UPDATE ON public.report_qa_stream_checkpoints
  FOR EACH ROW EXECUTE FUNCTION public.touch_stream_checkpoint_updated_at();
