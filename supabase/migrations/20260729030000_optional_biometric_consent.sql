-- Biometric collection is an optional verification path. It must not be part
-- of the portal-wide consent gate because clients may instead complete
-- document-based verification.
--
-- Keep this corrective migration for environments where catalogue v2026.2
-- was published before biometric_collection was marked optional.
--
-- ROLLBACK:
--   UPDATE aml.consent_documents
--   SET required = true
--   WHERE code = 'biometric_collection' AND version = '2026.2';

UPDATE aml.consent_documents
SET required = false
WHERE code = 'biometric_collection'
  AND version = '2026.2'
  AND required = true;
