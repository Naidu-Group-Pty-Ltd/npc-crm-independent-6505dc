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

  INSERT INTO public.migration_uploaded_source_chunks (upload_id, chunk_index, records, row_count)
  VALUES (_upload_id, _chunk_index, _records, _chunk_rows)
  ON CONFLICT (upload_id, chunk_index) DO UPDATE
    SET records = EXCLUDED.records,
        row_count = EXCLUDED.row_count,
        created_at = now();

  UPDATE public.migration_uploaded_sources AS s
     SET row_count = COALESCE((
           SELECT SUM(c.row_count)::int
           FROM public.migration_uploaded_source_chunks AS c
           WHERE c.upload_id = s.id
         ), 0),
         expected_rows = COALESCE(_expected_rows, s.expected_rows)
   WHERE s.id = _upload_id
   RETURNING s.row_count, COALESCE(s.expected_rows, _expected_rows)
        INTO _new_total, _expected;

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

  UPDATE public.migration_uploaded_sources AS s
     SET progress_percent = _new_progress,
         status = 'uploading'
   WHERE s.id = _upload_id;

  RETURN QUERY
    SELECT s.id, s.row_count, s.progress_percent, s.status
    FROM public.migration_uploaded_sources AS s
    WHERE s.id = _upload_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_migration_upload_chunk(uuid, int, jsonb, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_migration_upload_chunk(uuid, int, jsonb, int, int) TO service_role;

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
  SELECT COALESCE(jsonb_agg(x.rec ORDER BY x.chunk_index, x.ord), '[]'::jsonb),
         COALESCE(SUM(x.chunk_row_count)::int, 0)
    INTO _consolidated, _total
  FROM (
    SELECT c.chunk_index,
           c.row_count AS chunk_row_count,
           t.rec,
           t.ord
    FROM public.migration_uploaded_source_chunks AS c
    CROSS JOIN LATERAL jsonb_array_elements(c.records) WITH ORDINALITY AS t(rec, ord)
    WHERE c.upload_id = _upload_id
  ) AS x;

  UPDATE public.migration_uploaded_sources AS s
     SET records = COALESCE(_consolidated, '[]'::jsonb),
         row_count = COALESCE(_total, 0),
         progress_percent = 100,
         status = 'ready'
   WHERE s.id = _upload_id;

  DELETE FROM public.migration_uploaded_source_chunks AS c
  WHERE c.upload_id = _upload_id;

  RETURN QUERY
    SELECT s.id, s.row_count, s.status
    FROM public.migration_uploaded_sources AS s
    WHERE s.id = _upload_id;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_migration_upload(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_migration_upload(uuid) TO service_role;