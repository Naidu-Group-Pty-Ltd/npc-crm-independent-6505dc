-- Normalize legacy Vownet upload responses to the object key used in storage.
-- The matching binding may already exist; fresh databases can instead have a
-- binding whose object_path is the unparsed JSON value.
CREATE OR REPLACE FUNCTION pg_temp.safe_jsonb(input text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  RETURN input::jsonb;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

WITH parsed_client_files AS (
  SELECT client_files.*,
         pg_temp.safe_jsonb(file_path) AS parsed_file_path
  FROM public.client_files
  WHERE file_path LIKE '{%'
),
legacy_vownet_files AS (
  SELECT id,
         client_id,
         uploaded_by,
         is_vownet_form,
         (parsed_file_path ->> 'path') AS object_path
  FROM parsed_client_files
  WHERE (parsed_file_path ->> 'path') LIKE 'vownet-forms/%'
    AND (parsed_file_path ->> 'fullPath') =
        'client-files/' || (parsed_file_path ->> 'path')
)
INSERT INTO public.storage_object_bindings (
  bucket,
  object_path,
  resource_type,
  resource_id,
  client_id,
  owner_user_id,
  sensitivity,
  created_by
)
SELECT 'client-files',
       object_path,
       CASE WHEN is_vownet_form THEN 'vownet_form' ELSE 'client_file' END,
       id,
       client_id,
       uploaded_by,
       'sensitive',
       uploaded_by
FROM legacy_vownet_files
ON CONFLICT (bucket, object_path) DO NOTHING;

UPDATE public.client_files AS client_files
SET file_path = (parsed.parsed_file_path ->> 'path'),
    storage_bucket = 'client-files'
FROM (
  SELECT id,
         pg_temp.safe_jsonb(file_path) AS parsed_file_path
  FROM public.client_files
  WHERE file_path LIKE '{%'
) AS parsed
WHERE client_files.id = parsed.id
  AND (parsed.parsed_file_path ->> 'path') LIKE 'vownet-forms/%'
  AND (parsed.parsed_file_path ->> 'fullPath') =
      'client-files/' || (parsed.parsed_file_path ->> 'path');
