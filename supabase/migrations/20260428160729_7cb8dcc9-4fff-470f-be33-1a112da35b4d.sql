
-- Add status/progress columns to parent table
ALTER TABLE public.migration_uploaded_sources
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS progress_percent int NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS expected_rows int;

-- Chunks table — one row per uploaded chunk, avoids JSONB TOAST rewrite on every append
CREATE TABLE IF NOT EXISTS public.migration_uploaded_source_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id uuid NOT NULL REFERENCES public.migration_uploaded_sources(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  records jsonb NOT NULL,
  row_count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (upload_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_migration_uploaded_source_chunks_upload_id
  ON public.migration_uploaded_source_chunks(upload_id, chunk_index);

ALTER TABLE public.migration_uploaded_source_chunks ENABLE ROW LEVEL SECURITY;

-- No client-side policies → only service_role can read/write.

-- RPC: append a chunk (O(1), no JSONB rewrite of large blob)
CREATE OR REPLACE FUNCTION public.append_migration_upload_chunk(
  _upload_id uuid,
  _chunk_index int,
  _records jsonb,
  _expected_rows int DEFAULT NULL,
  _max_records int DEFAULT 200000
)
RETURNS TABLE (id uuid, row_count int, progress_percent int, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _chunk_rows int;
  _new_total int;
  _expected int;
  _new_progress int;
BEGIN
  IF jsonb_typeof(_records) <> 'array' THEN
    RAISE EXCEPTION 'records must be a JSON array';
  END IF;

  _chunk_rows := jsonb_array_length(_records);

  -- Insert the chunk (idempotent on (upload_id, chunk_index))
  INSERT INTO public.migration_uploaded_source_chunks (upload_id, chunk_index, records, row_count)
  VALUES (_upload_id, _chunk_index, _records, _chunk_rows)
  ON CONFLICT (upload_id, chunk_index) DO NOTHING;

  -- Update parent row count + progress
  UPDATE public.migration_uploaded_sources s
     SET row_count = COALESCE((
           SELECT SUM(row_count)::int FROM public.migration_uploaded_source_chunks WHERE upload_id = s.id
         ), 0),
         expected_rows = COALESCE(_expected_rows, s.expected_rows)
   WHERE s.id = _upload_id
   RETURNING s.row_count, COALESCE(s.expected_rows, _expected_rows) INTO _new_total, _expected;

  IF _new_total IS NULL THEN
    RAISE EXCEPTION 'upload not found: %', _upload_id;
  END IF;

  IF _new_total > _max_records THEN
    RAISE EXCEPTION 'append would exceed cap of % records (current=%)', _max_records, _new_total;
  END IF;

  IF _expected IS NOT NULL AND _expected > 0 THEN
    _new_progress := LEAST(99, GREATEST(1, (_new_total * 100) / _expected));
  ELSE
    _new_progress := 50;
  END IF;

  UPDATE public.migration_uploaded_sources
     SET progress_percent = _new_progress,
         status = 'uploading'
   WHERE id = _upload_id;

  RETURN QUERY
    SELECT s.id, s.row_count, s.progress_percent, s.status
    FROM public.migration_uploaded_sources s WHERE s.id = _upload_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_migration_upload_chunk(uuid, int, jsonb, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_migration_upload_chunk(uuid, int, jsonb, int, int) TO service_role;

-- RPC: finalize — consolidate chunks into records JSONB so existing workers keep working
CREATE OR REPLACE FUNCTION public.finalize_migration_upload(
  _upload_id uuid
)
RETURNS TABLE (id uuid, row_count int, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consolidated jsonb;
  _total int;
BEGIN
  SELECT COALESCE(jsonb_agg(rec ORDER BY chunk_index, ord), '[]'::jsonb), COALESCE(SUM(row_count)::int, 0)
    INTO _consolidated, _total
  FROM (
    SELECT c.chunk_index, c.row_count,
           rec, ord
    FROM public.migration_uploaded_source_chunks c,
         LATERAL jsonb_array_elements(c.records) WITH ORDINALITY AS t(rec, ord)
    WHERE c.upload_id = _upload_id
  ) x
  GROUP BY ();

  UPDATE public.migration_uploaded_sources
     SET records = COALESCE(_consolidated, '[]'::jsonb),
         row_count = _total,
         progress_percent = 100,
         status = 'ready'
   WHERE id = _upload_id;

  -- Free the chunk storage now that records is consolidated
  DELETE FROM public.migration_uploaded_source_chunks WHERE upload_id = _upload_id;

  RETURN QUERY
    SELECT s.id, s.row_count, s.status
    FROM public.migration_uploaded_sources s WHERE s.id = _upload_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_migration_upload(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_migration_upload(uuid) TO service_role;

-- RPC: progress polling
CREATE OR REPLACE FUNCTION public.get_migration_upload_progress(
  _upload_id uuid
)
RETURNS TABLE (id uuid, row_count int, expected_rows int, progress_percent int, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, row_count, expected_rows, progress_percent, status
  FROM public.migration_uploaded_sources
  WHERE id = _upload_id;
$$;

REVOKE ALL ON FUNCTION public.get_migration_upload_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_migration_upload_progress(uuid) TO service_role;

-- Mark any stuck uploads as failed for cleanup
UPDATE public.migration_uploaded_sources
   SET status = 'failed'
 WHERE status = 'uploading'
   AND created_at < now() - interval '5 minutes';
