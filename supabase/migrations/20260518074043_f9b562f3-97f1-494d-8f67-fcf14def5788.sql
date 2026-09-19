
-- 1. New columns
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS suburb text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postcode text,
  ADD COLUMN IF NOT EXISTS report_type text,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS tsv tsvector;

-- 2. Backfill tsv for existing rows
UPDATE public.document_chunks
SET tsv = to_tsvector('english', coalesce(chunk_text, ''))
WHERE tsv IS NULL;

-- 3. Trigger to maintain tsv
CREATE OR REPLACE FUNCTION public.document_chunks_tsv_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.tsv := to_tsvector('english', coalesce(NEW.chunk_text, ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_chunks_tsv ON public.document_chunks;
CREATE TRIGGER trg_document_chunks_tsv
BEFORE INSERT OR UPDATE OF chunk_text ON public.document_chunks
FOR EACH ROW EXECUTE FUNCTION public.document_chunks_tsv_update();

-- 4. Indexes
CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx
  ON public.document_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS document_chunks_suburb_idx
  ON public.document_chunks (lower(suburb));
CREATE INDEX IF NOT EXISTS document_chunks_state_idx
  ON public.document_chunks (lower(state));
CREATE INDEX IF NOT EXISTS document_chunks_postcode_idx
  ON public.document_chunks (postcode);
CREATE INDEX IF NOT EXISTS document_chunks_report_type_idx
  ON public.document_chunks (report_type);
CREATE INDEX IF NOT EXISTS document_chunks_content_hash_idx
  ON public.document_chunks (content_hash);
CREATE INDEX IF NOT EXISTS document_chunks_document_name_idx
  ON public.document_chunks (document_name);

-- 5. Hybrid match function (semantic + keyword + filters)
CREATE OR REPLACE FUNCTION public.match_document_chunks_hybrid(
  query_embedding vector,
  query_text text DEFAULT NULL,
  match_conversation_id uuid DEFAULT NULL,
  match_document_names text[] DEFAULT NULL,
  match_suburb text DEFAULT NULL,
  match_state text DEFAULT NULL,
  match_postcode text DEFAULT NULL,
  match_report_type text DEFAULT NULL,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 12,
  semantic_weight double precision DEFAULT 0.7,
  keyword_weight double precision DEFAULT 0.3
)
RETURNS TABLE(
  id uuid,
  conversation_id uuid,
  document_name text,
  chunk_index integer,
  chunk_text text,
  paragraph_index integer,
  page_number integer,
  suburb text,
  state text,
  postcode text,
  report_type text,
  similarity double precision,
  keyword_rank double precision,
  hybrid_score double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ts_query tsquery := NULL;
BEGIN
  IF query_text IS NOT NULL AND length(trim(query_text)) > 0 THEN
    BEGIN
      ts_query := websearch_to_tsquery('english', query_text);
    EXCEPTION WHEN OTHERS THEN
      ts_query := plainto_tsquery('english', query_text);
    END;
  END IF;

  RETURN QUERY
  SELECT
    dc.id,
    dc.conversation_id,
    dc.document_name,
    dc.chunk_index,
    dc.chunk_text,
    dc.paragraph_index,
    dc.page_number,
    dc.suburb,
    dc.state,
    dc.postcode,
    dc.report_type,
    (1 - (dc.embedding <=> query_embedding))::double precision AS similarity,
    COALESCE(
      CASE WHEN ts_query IS NOT NULL AND dc.tsv IS NOT NULL
           THEN ts_rank_cd(dc.tsv, ts_query)::double precision
           ELSE 0::double precision END,
      0::double precision
    ) AS keyword_rank,
    (
      semantic_weight * (1 - (dc.embedding <=> query_embedding))
      + keyword_weight * COALESCE(
          CASE WHEN ts_query IS NOT NULL AND dc.tsv IS NOT NULL
               THEN LEAST(ts_rank_cd(dc.tsv, ts_query) * 4, 1)
               ELSE 0 END,
          0
        )
    )::double precision AS hybrid_score
  FROM public.document_chunks dc
  WHERE
    dc.embedding IS NOT NULL
    AND (match_conversation_id IS NULL OR dc.conversation_id = match_conversation_id)
    AND (match_document_names IS NULL OR dc.document_name = ANY(match_document_names))
    AND (match_suburb IS NULL OR lower(dc.suburb) = lower(match_suburb))
    AND (match_state IS NULL OR lower(dc.state) = lower(match_state))
    AND (match_postcode IS NULL OR dc.postcode = match_postcode)
    AND (match_report_type IS NULL OR dc.report_type = match_report_type)
    AND (1 - (dc.embedding <=> query_embedding)) > match_threshold
  ORDER BY hybrid_score DESC
  LIMIT match_count;
END;
$$;
