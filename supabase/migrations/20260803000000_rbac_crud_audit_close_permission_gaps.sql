-- RBAC / CRUD audit — close the gaps between the app's permission model and RLS.
--
-- The dashboard has a module permission model (dashboard_modules ×
-- user_permissions.can_view/can_edit/can_delete) that the UI and the
-- edge-function mediation layer both honour. A set of tables never got the
-- database half of it: their policies said `true` for anyone holding the
-- `authenticated` role, and several tables meant to be service-role-only were
-- written `TO public`, which in Postgres includes `anon`.
--
-- Verified against production before writing this migration:
--
--   • as `anon` (no JWT at all): report_versions 1880 rows, checklist_instances
--     77, checklist_templates 3, game_plans 3, game_plan_notes 1, call_tags 6.
--   • as `authenticated` with a JWT whose sub is a UUID that exists in no table
--     (no roles, no permission rows): SELECT returned vapi_call_logs 669,
--     report_versions 1880, charts 99, generated_reports 8,
--     depreciation_comps 22000; and UPDATE global_report_settings, UPDATE
--     whitelabel_settings, DELETE generated_reports, DELETE charts and DELETE
--     depreciation_comps all succeeded (probed inside an aborted transaction).
--
-- Why this is latent rather than actively exploited: every one of the four
-- current users is a superadmin, and superadmin bypasses the check either way.
-- The gap becomes real the moment a workspace provisions an ordinary user —
-- which is precisely what clone onboarding does. Fixing it before that is the
-- cheap version.
--
-- Identity note, because it is counter-intuitive here: this deployment does not
-- use Supabase Auth for its staff users. `_shared/jwt.ts` mints a
-- Supabase-compatible JWT with `sub` = custom_users.id and role
-- 'authenticated'. So auth.uid() returns a custom_users.id, which is exactly
-- what user_permissions.user_id and user_roles.user_id hold — a policy keyed on
-- auth.users would match nothing. Verified: all 95 user_permissions rows and all
-- 4 user_roles rows resolve against custom_users, none against auth.users.
--
-- service_role has rolbypassrls = true (verified), so dropping a mis-scoped
-- "Service role full access" policy costs service_role nothing — every edge
-- function keeps working untouched.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Permission helpers usable from an `authenticated` policy.
--
-- The obvious move — reuse has_module_access(auth.uid(), 'x') — does not work,
-- and finding out why is the reason this section exists. Its ACL is
-- `postgres=X | service_role=X`: an earlier hardening pass revoked PUBLIC
-- EXECUTE, so a policy calling it as `authenticated` fails with
-- `42501 permission denied for function has_module_access` and the table reads
-- as empty. A dry run of this migration caught exactly that — including for
-- superadmins, which would have taken the app down rather than secured it.
--
-- So these take the module key ONLY and resolve auth.uid() internally. Two
-- benefits over granting EXECUTE on the existing arbitrary-_user_id helpers:
-- the hardened grants stay hardened, and there is no signature through which
-- one user can probe another user's permission rows.
--
-- can_view is included alongside edit/delete so every policy below reads the
-- same way, rather than mixing two calling conventions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_user_can_view(_module_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.dashboard_modules dm ON up.module_id = dm.id
    WHERE up.user_id = auth.uid()
      AND dm.module_key = _module_key
      AND up.can_view = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'superadmin'
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_edit(_module_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.dashboard_modules dm ON up.module_id = dm.id
    WHERE up.user_id = auth.uid()
      AND dm.module_key = _module_key
      AND up.can_edit = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'superadmin'
  )
$function$;

CREATE OR REPLACE FUNCTION public.current_user_can_delete(_module_key text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.dashboard_modules dm ON up.module_id = dm.id
    WHERE up.user_id = auth.uid()
      AND dm.module_key = _module_key
      AND up.can_delete = true
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'superadmin'
  )
$function$;

COMMENT ON FUNCTION public.current_user_can_view(text) IS
  'can_view on the module for the calling user (auth.uid()), or superadmin. Self-scoped so it cannot be used to probe another user.';
COMMENT ON FUNCTION public.current_user_can_edit(text) IS
  'can_edit on the module for the calling user (auth.uid()), or superadmin.';
COMMENT ON FUNCTION public.current_user_can_delete(text) IS
  'can_delete on the module for the calling user (auth.uid()), or superadmin.';

-- Called only from policies that are themselves TO authenticated. Leaving
-- EXECUTE on PUBLIC is what the anon_security_definer_function_executable
-- advisory flags, and anon has no permission rows to find anyway.
REVOKE EXECUTE ON FUNCTION public.current_user_can_view(text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_can_edit(text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_can_delete(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_view(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_edit(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_delete(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Anonymous read exposure.
--
-- These carry a single policy named "Service role full access" / "Anyone can
-- view ..." written `TO public` with USING (true). `TO public` is every role,
-- so the anon key alone read them. Replaced with an authenticated read gated on
-- the module that owns the data; service_role bypasses RLS and is unaffected.
-- ---------------------------------------------------------------------------

-- 2a) Checklists → `checklists` module.
REVOKE ALL ON public.checklist_instances            FROM anon;
REVOKE ALL ON public.checklist_instance_items       FROM anon;
REVOKE ALL ON public.checklist_templates            FROM anon;
REVOKE ALL ON public.checklist_template_items       FROM anon;
REVOKE ALL ON public.checklist_template_sections    FROM anon;

DROP POLICY IF EXISTS "Service role full access" ON public.checklist_instances;
DROP POLICY IF EXISTS "Service role full access" ON public.checklist_instance_items;
DROP POLICY IF EXISTS "Service role full access" ON public.checklist_templates;
DROP POLICY IF EXISTS "Service role full access" ON public.checklist_template_items;
DROP POLICY IF EXISTS "Service role full access" ON public.checklist_template_sections;

CREATE POLICY checklist_instances_select_module ON public.checklist_instances
  FOR SELECT TO authenticated USING (public.current_user_can_view('checklists'));
CREATE POLICY checklist_instance_items_select_module ON public.checklist_instance_items
  FOR SELECT TO authenticated USING (public.current_user_can_view('checklists'));
CREATE POLICY checklist_templates_select_module ON public.checklist_templates
  FOR SELECT TO authenticated USING (public.current_user_can_view('checklists'));
CREATE POLICY checklist_template_items_select_module ON public.checklist_template_items
  FOR SELECT TO authenticated USING (public.current_user_can_view('checklists'));
CREATE POLICY checklist_template_sections_select_module ON public.checklist_template_sections
  FOR SELECT TO authenticated USING (public.current_user_can_view('checklists'));

-- 2b) Game plans → `game_plans` module. Client strategy documents; these were
-- readable with no credential whatsoever.
REVOKE ALL ON public.game_plans           FROM anon;
REVOKE ALL ON public.game_plan_actions    FROM anon;
REVOKE ALL ON public.game_plan_kpis       FROM anon;
REVOKE ALL ON public.game_plan_milestones FROM anon;
REVOKE ALL ON public.game_plan_notes      FROM anon;
REVOKE ALL ON public.game_plan_phases     FROM anon;

DROP POLICY IF EXISTS "Service role full access" ON public.game_plans;
DROP POLICY IF EXISTS "Service role full access" ON public.game_plan_actions;
DROP POLICY IF EXISTS "Service role full access" ON public.game_plan_kpis;
DROP POLICY IF EXISTS "Service role full access" ON public.game_plan_milestones;
DROP POLICY IF EXISTS "Service role full access" ON public.game_plan_notes;
DROP POLICY IF EXISTS "Service role full access" ON public.game_plan_phases;

CREATE POLICY game_plans_select_module ON public.game_plans
  FOR SELECT TO authenticated USING (public.current_user_can_view('game_plans'));
CREATE POLICY game_plan_actions_select_module ON public.game_plan_actions
  FOR SELECT TO authenticated USING (public.current_user_can_view('game_plans'));
CREATE POLICY game_plan_kpis_select_module ON public.game_plan_kpis
  FOR SELECT TO authenticated USING (public.current_user_can_view('game_plans'));
CREATE POLICY game_plan_milestones_select_module ON public.game_plan_milestones
  FOR SELECT TO authenticated USING (public.current_user_can_view('game_plans'));
CREATE POLICY game_plan_notes_select_module ON public.game_plan_notes
  FOR SELECT TO authenticated USING (public.current_user_can_view('game_plans'));
CREATE POLICY game_plan_phases_select_module ON public.game_plan_phases
  FOR SELECT TO authenticated USING (public.current_user_can_view('game_plans'));

-- 2c) Call settings → `call_logs` module. Written and read through
-- manage-call-settings / vapi-call-webhook, both service-role.
REVOKE ALL ON public.call_alert_rules   FROM anon;
REVOKE ALL ON public.call_alert_history FROM anon;
REVOKE ALL ON public.call_tags          FROM anon;

DROP POLICY IF EXISTS "Anyone can manage alert rules"   ON public.call_alert_rules;
DROP POLICY IF EXISTS "Anyone can view alert rules"     ON public.call_alert_rules;
DROP POLICY IF EXISTS "Anyone can manage alert history" ON public.call_alert_history;
DROP POLICY IF EXISTS "Anyone can view alert history"   ON public.call_alert_history;
DROP POLICY IF EXISTS "Anyone can manage call tags"     ON public.call_tags;
DROP POLICY IF EXISTS "Anyone can view call tags"       ON public.call_tags;

CREATE POLICY call_alert_rules_select_module ON public.call_alert_rules
  FOR SELECT TO authenticated USING (public.current_user_can_view('call_logs'));
CREATE POLICY call_alert_history_select_module ON public.call_alert_history
  FOR SELECT TO authenticated USING (public.current_user_can_view('call_logs'));
CREATE POLICY call_tags_select_module ON public.call_tags
  FOR SELECT TO authenticated USING (public.current_user_can_view('call_logs'));

-- ---------------------------------------------------------------------------
-- 3) Report artefacts — read and write bound to the owning module.
-- ---------------------------------------------------------------------------

-- 3a) report_versions → `reports`. Anon-readable (1880 rows) via a {public}
-- ALL/true policy plus an anon SELECT grant.
REVOKE ALL ON public.report_versions FROM anon;

DROP POLICY IF EXISTS "Service role can manage report versions"            ON public.report_versions;
DROP POLICY IF EXISTS "All authenticated users can view all report versions" ON public.report_versions;

CREATE POLICY report_versions_select_module ON public.report_versions
  FOR SELECT TO authenticated USING (public.current_user_can_view('reports'));

-- 3b) generated_reports → `generated_reports`. Written by the browser during
-- report generation (useReportGenerator), so this keeps INSERT/UPDATE for users
-- holding can_edit rather than routing it through an edge function.
DROP POLICY IF EXISTS generated_reports_select_authenticated ON public.generated_reports;
DROP POLICY IF EXISTS generated_reports_insert_authenticated ON public.generated_reports;
DROP POLICY IF EXISTS generated_reports_update_authenticated ON public.generated_reports;
DROP POLICY IF EXISTS generated_reports_delete_authenticated ON public.generated_reports;

CREATE POLICY generated_reports_select_module ON public.generated_reports
  FOR SELECT TO authenticated USING (public.current_user_can_view('generated_reports'));
CREATE POLICY generated_reports_insert_module ON public.generated_reports
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_edit('generated_reports'));
CREATE POLICY generated_reports_update_module ON public.generated_reports
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('generated_reports'))
  WITH CHECK (public.current_user_can_edit('generated_reports'));
CREATE POLICY generated_reports_delete_module ON public.generated_reports
  FOR DELETE TO authenticated USING (public.current_user_can_delete('generated_reports'));

-- 3c) charts → `charts`. Inserted by the report generator in the browser.
DROP POLICY IF EXISTS charts_select_authenticated ON public.charts;
DROP POLICY IF EXISTS charts_insert_authenticated ON public.charts;
DROP POLICY IF EXISTS charts_update_authenticated ON public.charts;
DROP POLICY IF EXISTS charts_delete_authenticated ON public.charts;

CREATE POLICY charts_select_module ON public.charts
  FOR SELECT TO authenticated USING (public.current_user_can_view('charts'));
CREATE POLICY charts_insert_module ON public.charts
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_edit('charts'));
CREATE POLICY charts_update_module ON public.charts
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('charts'))
  WITH CHECK (public.current_user_can_edit('charts'));
CREATE POLICY charts_delete_module ON public.charts
  FOR DELETE TO authenticated USING (public.current_user_can_delete('charts'));

-- 3d) depreciation_comps → `depreciation_comps`. 22,000 rows of comparables
-- behind an admin-only surface (DepreciationCompsAdmin), yet any authenticated
-- user could truncate the table one DELETE at a time.
DROP POLICY IF EXISTS depreciation_comps_select_authenticated ON public.depreciation_comps;
DROP POLICY IF EXISTS depreciation_comps_insert_authenticated ON public.depreciation_comps;
DROP POLICY IF EXISTS depreciation_comps_update_authenticated ON public.depreciation_comps;
DROP POLICY IF EXISTS depreciation_comps_delete_authenticated ON public.depreciation_comps;

CREATE POLICY depreciation_comps_select_module ON public.depreciation_comps
  FOR SELECT TO authenticated USING (public.current_user_can_view('depreciation_comps'));
CREATE POLICY depreciation_comps_insert_module ON public.depreciation_comps
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_edit('depreciation_comps'));
CREATE POLICY depreciation_comps_update_module ON public.depreciation_comps
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('depreciation_comps'))
  WITH CHECK (public.current_user_can_edit('depreciation_comps'));
CREATE POLICY depreciation_comps_delete_module ON public.depreciation_comps
  FOR DELETE TO authenticated USING (public.current_user_can_delete('depreciation_comps'));

-- 3e) vapi_call_logs → `call_logs`. Call transcripts and recordings metadata:
-- 669 rows, previously readable by anyone holding the `authenticated` role.
-- get-call-recording already gates its own reads on this module (with
-- requireRegistered=true); this makes the table agree with the function.
DROP POLICY IF EXISTS "Authenticated users can view call logs" ON public.vapi_call_logs;

CREATE POLICY vapi_call_logs_select_module ON public.vapi_call_logs
  FOR SELECT TO authenticated USING (public.current_user_can_view('call_logs'));

-- ---------------------------------------------------------------------------
-- 4) Workspace-wide settings — writes restricted to the owning module.
--
-- Reads stay open where the product needs them open: report rendering reads the
-- global settings, and the unauthenticated login screen reads branding.
-- ---------------------------------------------------------------------------

-- 4a) global_report_settings → `settings` for writes; read stays authenticated.
DROP POLICY IF EXISTS global_report_settings_update_authenticated ON public.global_report_settings;

CREATE POLICY global_report_settings_update_module ON public.global_report_settings
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('settings'))
  WITH CHECK (public.current_user_can_edit('settings'));

-- 4b) whitelabel_settings → `white_label` for writes. "Anyone can view" is kept
-- deliberately: BrandProvider reads branding before login, so the pre-auth
-- screen has to be able to see it.
DROP POLICY IF EXISTS "Authenticated users can insert whitelabel settings" ON public.whitelabel_settings;
DROP POLICY IF EXISTS "Authenticated users can update whitelabel settings" ON public.whitelabel_settings;

CREATE POLICY whitelabel_settings_insert_module ON public.whitelabel_settings
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_edit('white_label'));
CREATE POLICY whitelabel_settings_update_module ON public.whitelabel_settings
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('white_label'))
  WITH CHECK (public.current_user_can_edit('white_label'));

-- 4c) template_components → `templates`. UPDATE and DELETE were already scoped
-- to created_by; INSERT alone was WITH CHECK (true), so a row could be inserted
-- attributed to somebody else — and then only that somebody could remove it.
DROP POLICY IF EXISTS "Authenticated can insert components" ON public.template_components;

CREATE POLICY template_components_insert_module ON public.template_components
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.current_user_can_edit('templates'));

-- ---------------------------------------------------------------------------
-- 5) notifications — make an inserted notification attributable.
--
-- INSERT was WITH CHECK (true) and target_user_id is nullable, where NULL means
-- broadcast; the SELECT policy shows NULL-target rows to every user. So any
-- authenticated user could push arbitrary text to everyone's notification bell,
-- which is a workable phishing surface ("your session expired, re-enter your
-- password at ...").
--
-- Locking the target down is not available: assigning a deal or a reminder
-- legitimately notifies another user (DealDetailView, DealTrackerTab,
-- ClientReminders), and most other call sites deliberately broadcast. What was
-- missing is not authority but attribution — there was no record of who wrote
-- the row. created_by defaults to auth.uid() and the policy pins it there, so
-- the insert stays as permissive as the product needs while ceasing to be
-- anonymous. Service-role inserts from edge functions leave it NULL.
-- ---------------------------------------------------------------------------

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

COMMENT ON COLUMN public.notifications.created_by IS
  'The custom_users.id that inserted this notification, pinned by RLS. NULL for service-role inserts made by edge functions.';

DROP POLICY IF EXISTS notifications_insert_authenticated ON public.notifications;

CREATE POLICY notifications_insert_attributed ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

COMMIT;
