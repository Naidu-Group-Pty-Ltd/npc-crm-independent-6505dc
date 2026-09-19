
UPDATE public.client_files
SET file_path = (file_path::jsonb ->> 'path')
WHERE file_path LIKE '{%'
  -- Legacy Vownet uploads use fullPath to retain their client-files bucket.
  AND COALESCE(file_path::jsonb ->> 'fullPath', '') NOT LIKE 'client-files/%'
  AND (file_path::jsonb ->> 'path') IS NOT NULL
  AND (file_path::jsonb ->> 'path') <> '';
