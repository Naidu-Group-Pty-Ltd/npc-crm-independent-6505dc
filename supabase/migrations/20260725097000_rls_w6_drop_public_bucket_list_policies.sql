-- =============================================================================
-- RLS-W6 (Warning): fully clear public_bucket_allows_listing on asset buckets
-- =============================================================================
--
-- LIVE-SAFE. RLS-W4 re-scoped the branding-assets / lead-magnets storage.objects
-- SELECT policies from `public` to `authenticated`, which removed anonymous
-- enumeration. The linter still flagged them: on a PUBLIC bucket, object URL
-- reads are served over the public CDN path (/storage/v1/object/public/...) with
-- no RLS, so ANY broad SELECT policy — even `authenticated` — is unnecessary and
-- only enables `list()` enumeration.
--
-- These buckets need no client-side SELECT policy:
--   * branding-assets — read via getPublicUrl() (public CDN path).
--   * lead-magnets    — listed/served through the manage-lead-magnets and
--                       request-lead-magnet edge functions (service_role, which
--                       bypasses RLS).
--
-- Drop both policies outright. Public object reads and edge-served downloads are
-- unaffected; writes remain service_role-only.
-- =============================================================================

DROP POLICY IF EXISTS "authenticated_read_branding_assets" ON storage.objects;
DROP POLICY IF EXISTS "authenticated_read_lead_magnets" ON storage.objects;
