-- =============================================================================
-- RLS-W2 (Warning): remove anonymous exposure — APPLY AFTER FRONTEND REPUBLISH
-- =============================================================================
--
-- ⚠️  STAGED MIGRATION — DO NOT APPLY UNTIL THE ACCOMPANYING FRONTEND HAS SHIPPED ⚠️
--
-- These four tables granted the `public`/`anon` role broad USING(true) access,
-- so anyone holding the publicly embedded anon key could read (and in most
-- cases write) them WITHOUT authenticating:
--
--   * generated_reports          — ALL to {anon, authenticated}
--   * global_report_settings     — INSERT/UPDATE/SELECT to public(anon)
--   * depreciation_comps         — ALL to public(anon)
--   * gamma_agreement_templates  — ALL + SELECT to {anon, authenticated}
--
-- Unlike RLS-W1, the browser reaches these tables via direct PostgREST `.from()`
-- REST calls that (until this PR) ran on the ANON-key client. This PR migrates
-- those call sites onto the JWT-bearing (`authenticated`) client:
--
--   * generated_reports         -> src/pages/QuantitativeReports.tsx (history read)
--   * global_report_settings    -> src/components/templates/GlobalReportSettings.tsx (read)
--   * depreciation_comps        -> src/components/admin/DepreciationCompsAdmin.tsx (read + writes)
--   * gamma_agreement_templates -> src/components/agreements/GammaTemplateManager.tsx (CRUD)
--                                  src/components/agreements/SendAgreementDialog.tsx (read)
--
-- Applying this migration BEFORE that frontend is live would break those views
-- for signed-in staff (the old anon-key requests would be denied). So apply it
-- ONLY AFTER the Lovable republish carrying this PR's frontend is in production.
--
-- Writes are kept at `authenticated` (these are staff-only admin surfaces that
-- the app already gates by module permission); tightening them further to an
-- explicit admin/service_role path is tracked as a follow-up. service_role
-- (edge functions) bypasses RLS and is unaffected.
-- =============================================================================

-- ── generated_reports: ALL anon+authenticated → authenticated + service_role ─
DROP POLICY IF EXISTS "Anyone can view generated reports"   ON public.generated_reports;
DROP POLICY IF EXISTS "Anyone can create generated reports" ON public.generated_reports;
DROP POLICY IF EXISTS "Anyone can update generated reports" ON public.generated_reports;
DROP POLICY IF EXISTS "Anyone can delete generated reports" ON public.generated_reports;

CREATE POLICY "generated_reports_select_authenticated" ON public.generated_reports
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "generated_reports_insert_authenticated" ON public.generated_reports
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "generated_reports_update_authenticated" ON public.generated_reports
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "generated_reports_delete_authenticated" ON public.generated_reports
  FOR DELETE TO authenticated USING (true);

-- ── global_report_settings: anon → authenticated read/update, svc-only insert ─
DROP POLICY IF EXISTS "Anyone can view global report settings"   ON public.global_report_settings;
DROP POLICY IF EXISTS "Anyone can insert global report settings" ON public.global_report_settings;
DROP POLICY IF EXISTS "Anyone can update global report settings" ON public.global_report_settings;

CREATE POLICY "global_report_settings_select_authenticated" ON public.global_report_settings
  FOR SELECT TO authenticated USING (true);
-- Staff edit the settings from the templates admin surface; inserts (seeding new
-- setting keys) stay service_role-only.
CREATE POLICY "global_report_settings_update_authenticated" ON public.global_report_settings
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ── depreciation_comps: ALL anon → authenticated + service_role ──────────────
DROP POLICY IF EXISTS "Anyone can view depreciation comps"   ON public.depreciation_comps;
DROP POLICY IF EXISTS "Anyone can insert depreciation comps" ON public.depreciation_comps;
DROP POLICY IF EXISTS "Anyone can update depreciation comps" ON public.depreciation_comps;
DROP POLICY IF EXISTS "Anyone can delete depreciation comps" ON public.depreciation_comps;

CREATE POLICY "depreciation_comps_select_authenticated" ON public.depreciation_comps
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "depreciation_comps_insert_authenticated" ON public.depreciation_comps
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "depreciation_comps_update_authenticated" ON public.depreciation_comps
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "depreciation_comps_delete_authenticated" ON public.depreciation_comps
  FOR DELETE TO authenticated USING (true);

-- ── gamma_agreement_templates: anon+authenticated → authenticated + svc ──────
DROP POLICY IF EXISTS "Allow manage gamma templates" ON public.gamma_agreement_templates;
DROP POLICY IF EXISTS "Allow read gamma templates"   ON public.gamma_agreement_templates;

ALTER TABLE public.gamma_agreement_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gamma_agreement_templates_select_authenticated" ON public.gamma_agreement_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "gamma_agreement_templates_insert_authenticated" ON public.gamma_agreement_templates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "gamma_agreement_templates_update_authenticated" ON public.gamma_agreement_templates
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "gamma_agreement_templates_delete_authenticated" ON public.gamma_agreement_templates
  FOR DELETE TO authenticated USING (true);
CREATE POLICY "gamma_agreement_templates_service_role_all" ON public.gamma_agreement_templates
  FOR ALL TO public
  USING (((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role')
  WITH CHECK (((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');

-- ── retry_failed_bulk_items: drop anon EXECUTE (staff action) ────────────────
-- The retry button (src/components/listings/BulkGenerationModal.tsx) now invokes
-- this SECURITY DEFINER action with the JWT-bearing client, so anon no longer
-- needs EXECUTE. Kept on authenticated. Grouped here (not RLS-W3) because the
-- live frontend must ship the JWT-client change before anon is revoked.
REVOKE EXECUTE ON FUNCTION public.retry_failed_bulk_items(uuid) FROM anon;
