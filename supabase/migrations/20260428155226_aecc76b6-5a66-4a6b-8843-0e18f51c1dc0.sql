CREATE OR REPLACE FUNCTION public.append_migration_upload_records(
  _upload_id uuid,
  _records jsonb,
  _max_records int DEFAULT 200000
)
RETURNS TABLE (id uuid, domain text, file_name text, row_count int, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_count int;
  _added int;
BEGIN
  _added := jsonb_array_length(_records);

  UPDATE public.migration_uploaded_sources s
     SET records   = s.records || _records,
         row_count = s.row_count + _added
   WHERE s.id = _upload_id
   RETURNING s.row_count INTO _new_count;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Upload not found: %', _upload_id USING ERRCODE = 'P0002';
  END IF;

  IF _new_count > _max_records THEN
    -- Roll back by removing the just-added tail
    UPDATE public.migration_uploaded_sources s
       SET records   = (SELECT jsonb_agg(elem) FROM (
                          SELECT elem FROM jsonb_array_elements(s.records) WITH ORDINALITY t(elem, ord)
                          WHERE ord <= s.row_count - _added
                       ) sub),
           row_count = s.row_count - _added
     WHERE s.id = _upload_id;
    RAISE EXCEPTION 'Total rows would exceed cap of %', _max_records USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
    SELECT s.id, s.domain::text, s.file_name, s.row_count, s.created_at
      FROM public.migration_uploaded_sources s
     WHERE s.id = _upload_id;
END;
$$;

REVOKE ALL ON FUNCTION public.append_migration_upload_records(uuid, jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_migration_upload_records(uuid, jsonb, int) TO service_role;

-- Also raise the soft cap on conversation replays — a full export can be 50k+ messages
COMMENT ON FUNCTION public.append_migration_upload_records IS
  'Atomically appends a JSONB array chunk to migration_uploaded_sources.records without round-tripping the full payload. Avoids O(n^2) append behavior.';