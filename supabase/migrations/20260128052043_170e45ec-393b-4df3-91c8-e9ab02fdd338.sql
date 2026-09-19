-- Allow plain text uploads (e.g. .txt/.md) to the report-templates bucket
DO $$
BEGIN
  UPDATE storage.buckets
  SET allowed_mime_types = (
    SELECT ARRAY(
      SELECT DISTINCT unnest(
        COALESCE(storage.buckets.allowed_mime_types, ARRAY[]::text[])
        || ARRAY['text/plain','text/markdown']
      )
      ORDER BY 1
    )
  )
  WHERE id = 'report-templates';
END $$;