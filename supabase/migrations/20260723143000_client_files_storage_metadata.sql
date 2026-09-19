-- Durable, private storage metadata for Client Forms.  New imports record the
-- authoritative bucket rather than relying on the display filename or a
-- temporary signed URL.  Existing rows remain readable through the scoped
-- legacy resolver in ClientVownetForms.
ALTER TABLE public.client_files
  ADD COLUMN IF NOT EXISTS storage_bucket text;

ALTER TABLE public.client_files
  ADD CONSTRAINT client_files_storage_bucket_check
  CHECK (storage_bucket IS NULL OR storage_bucket IN ('client-files', 'client-documents', 'vownet-forms'));

COMMENT ON COLUMN public.client_files.storage_bucket IS
  'Private Supabase Storage bucket containing the client file; never a public URL.';
