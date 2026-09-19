-- Repair legacy Vownet rows normalized before their storage bucket was stored.
-- The retained vownet-forms/ prefix is the object key in the client-files bucket.
UPDATE public.client_files
SET storage_bucket = 'client-files'
WHERE storage_bucket IS NULL
  AND file_path LIKE 'vownet-forms/%';
