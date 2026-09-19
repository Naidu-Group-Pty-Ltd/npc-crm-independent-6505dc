-- =============================================================================
-- STOR-006: Storage object lockdown — remove over-broad direct-access policies
-- =============================================================================
--
-- Defense-in-depth for storage.objects. Three private, sensitive buckets carried
-- RLS policies that granted direct access to the anon/authenticated roles even
-- though EVERY legitimate code path reaches them only through service-role edge
-- functions (which bypass RLS). With the public anon key embedded in the client,
-- those policies let anyone read/write/delete their objects directly:
--
--   * vownet-forms       — anon SELECT/INSERT/UPDATE/DELETE (client VOW forms/PII)
--   * agency-agreements  — anon SELECT/INSERT/UPDATE (signed agency agreements)
--   * marketing-reports  — authenticated SELECT/INSERT (any staff, unscoped)
--
-- All access is proxied: vownet-forms via secure-storage; agency-agreements via
-- manage-agency-agreements; marketing-reports via dispatch-marketing-reports.
-- None are read/written directly from the frontend, so dropping these policies
-- has no functional impact — service_role continues to work (BYPASSRLS) — and
-- closes the direct-access hole. Explicit service_role policies are (re)created
-- for parity/self-documentation with the other locked buckets.
--
-- Safe to apply immediately: no code change depends on it.
-- =============================================================================

-- ── vownet-forms: drop anon CRUD (service_role_* policies already exist) ──────
DROP POLICY IF EXISTS "vownet_forms_public_select" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_public_insert" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_public_update" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_public_delete" ON storage.objects;

-- ── agency-agreements: drop mislabeled "public" policies, add service-role-only
DROP POLICY IF EXISTS "Allow authenticated users to read agreements" ON storage.objects;
DROP POLICY IF EXISTS "Allow service updates to agreements" ON storage.objects;
DROP POLICY IF EXISTS "Allow service uploads to agreements" ON storage.objects;

DROP POLICY IF EXISTS "service_role_select_agency_agreements" ON storage.objects;
CREATE POLICY "service_role_select_agency_agreements" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'agency-agreements' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');
DROP POLICY IF EXISTS "service_role_insert_agency_agreements" ON storage.objects;
CREATE POLICY "service_role_insert_agency_agreements" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (bucket_id = 'agency-agreements' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');
DROP POLICY IF EXISTS "service_role_update_agency_agreements" ON storage.objects;
CREATE POLICY "service_role_update_agency_agreements" ON storage.objects
  FOR UPDATE TO public
  USING (bucket_id = 'agency-agreements' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');
DROP POLICY IF EXISTS "service_role_delete_agency_agreements" ON storage.objects;
CREATE POLICY "service_role_delete_agency_agreements" ON storage.objects
  FOR DELETE TO public
  USING (bucket_id = 'agency-agreements' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');

-- ── marketing-reports: drop broad authenticated access, add service-role-only ─
DROP POLICY IF EXISTS "Authenticated users can read marketing reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload marketing reports" ON storage.objects;

DROP POLICY IF EXISTS "service_role_select_marketing_reports" ON storage.objects;
CREATE POLICY "service_role_select_marketing_reports" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'marketing-reports' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');
DROP POLICY IF EXISTS "service_role_insert_marketing_reports" ON storage.objects;
CREATE POLICY "service_role_insert_marketing_reports" ON storage.objects
  FOR INSERT TO public
  WITH CHECK (bucket_id = 'marketing-reports' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');
DROP POLICY IF EXISTS "service_role_update_marketing_reports" ON storage.objects;
CREATE POLICY "service_role_update_marketing_reports" ON storage.objects
  FOR UPDATE TO public
  USING (bucket_id = 'marketing-reports' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');
DROP POLICY IF EXISTS "service_role_delete_marketing_reports" ON storage.objects;
CREATE POLICY "service_role_delete_marketing_reports" ON storage.objects
  FOR DELETE TO public
  USING (bucket_id = 'marketing-reports' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');
