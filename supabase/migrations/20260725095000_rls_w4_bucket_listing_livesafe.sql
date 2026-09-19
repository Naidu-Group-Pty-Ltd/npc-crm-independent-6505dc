-- =============================================================================
-- RLS-W4 (Warning): stop anonymous listing/enumeration of public asset buckets
-- =============================================================================
--
-- LIVE-SAFE. The `branding-assets` and `lead-magnets` buckets are public
-- (public = true) and each carried a `SELECT TO public` storage.objects policy.
-- On a public bucket the object bytes are served over the public CDN path
-- (/storage/v1/object/public/...), which bypasses RLS — so that broad SELECT
-- policy adds nothing for legitimate reads and only lets the anon role ENUMERATE
-- every object in the bucket via storage `list()` (the linter's
-- public_bucket_allows_listing finding).
--
-- We re-scope both policies to `authenticated`. This removes anonymous
-- enumeration while preserving:
--   * public object reads   — branding logos/banners are consumed via
--     getPublicUrl() (public CDN path, no RLS); unaffected.
--   * lead-magnet downloads — served to anonymous leads through the
--     request-lead-magnet / manage-lead-magnets edge functions (service_role,
--     bypasses RLS); unaffected.
--   * staff admin listing   — LeadMagnetsPanel lists via the manage-lead-magnets
--     edge function; any direct authenticated list() still works.
-- Writes remain service_role-only (unchanged).
-- =============================================================================

DROP POLICY IF EXISTS "public_read_branding_assets" ON storage.objects;
CREATE POLICY "authenticated_read_branding_assets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'branding-assets');

DROP POLICY IF EXISTS "Public read lead magnets" ON storage.objects;
CREATE POLICY "authenticated_read_lead_magnets" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'lead-magnets');
