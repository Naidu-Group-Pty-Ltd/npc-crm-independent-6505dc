-- =============================================================================
-- RLS-W1 (Warning): remove anonymous (public-internet) exposure — live-safe set
-- =============================================================================
--
-- These three tables carried SELECT/INSERT policies bound to the `public`/`anon`
-- role with USING(true)/WITH CHECK(true), so anyone holding the (publicly
-- embedded) anon key could read or write them WITHOUT logging in:
--
--   * activity_logs                — "Anyone can view activity logs"  (SELECT, anon)
--   * depreciation_estimator_runs  — "Anyone can view/create ..."     (SELECT+INSERT, anon)
--   * charts                       — "Anyone can view/create/update/delete" (ALL, anon)
--
-- This migration drops the anon grants and re-scopes them to `authenticated`
-- (staff) + `service_role`. It is LIVE-SAFE — verified against the frontend:
--
--   - Every realtime subscription on these tables runs on the shared client,
--     which useAuth() authorizes with the staff JWT via
--     `supabase.realtime.setAuth(accessToken)`, so it already connects as
--     `authenticated` and keeps working under authenticated SELECT.
--   - The only REST write from the browser is charts INSERT in
--     useReportGenerator.tsx, which uses the JWT-bearing (`authenticated`)
--     client — not the anon client.
--   - activity_logs and depreciation_estimator_runs are never written or read
--     via a direct browser `.from()` REST call; all reads/writes go through the
--     get-activity-logs / log-activity / manage-templates / estimator edge
--     functions, which run as service_role (bypass RLS).
--
-- The companion migration RLS-W2 covers the tables whose browser REST access
-- still uses the anon client (generated_reports, global_report_settings,
-- depreciation_comps, gamma_agreement_templates); those are applied only after
-- the frontend is republished onto the JWT-bearing client.
-- =============================================================================

-- ── activity_logs: SELECT anon → authenticated ───────────────────────────────
DROP POLICY IF EXISTS "Anyone can view activity logs" ON public.activity_logs;

CREATE POLICY "activity_logs_select_authenticated" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (true);

-- ── depreciation_estimator_runs: SELECT + INSERT anon → authenticated/svc ─────
DROP POLICY IF EXISTS "Anyone can view estimator runs"   ON public.depreciation_estimator_runs;
DROP POLICY IF EXISTS "Anyone can create estimator runs" ON public.depreciation_estimator_runs;

-- Reads: authenticated staff (realtime + any future authed query). Writes remain
-- service_role-only (runs are created by the estimator edge function).
CREATE POLICY "depreciation_estimator_runs_select_authenticated" ON public.depreciation_estimator_runs
  FOR SELECT TO authenticated
  USING (true);

-- ── charts: ALL anon+authenticated → authenticated + service_role ────────────
DROP POLICY IF EXISTS "Anyone can view charts"   ON public.charts;
DROP POLICY IF EXISTS "Anyone can create charts" ON public.charts;
DROP POLICY IF EXISTS "Anyone can update charts" ON public.charts;
DROP POLICY IF EXISTS "Anyone can delete charts" ON public.charts;

CREATE POLICY "charts_select_authenticated" ON public.charts
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "charts_insert_authenticated" ON public.charts
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "charts_update_authenticated" ON public.charts
  FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "charts_delete_authenticated" ON public.charts
  FOR DELETE TO authenticated
  USING (true);
