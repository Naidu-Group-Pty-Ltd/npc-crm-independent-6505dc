ALTER TABLE public.migration_uploaded_sources
  DROP CONSTRAINT IF EXISTS migration_uploaded_sources_domain_check;

ALTER TABLE public.migration_uploaded_sources
  ADD CONSTRAINT migration_uploaded_sources_domain_check
  CHECK (domain IN ('contacts', 'opportunities', 'conversations'));