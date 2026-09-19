ALTER TABLE public.token_balance_cache
  ADD COLUMN IF NOT EXISTS addon_slugs text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.token_balance_cache.addon_slugs IS
  'Priced add-on slugs the workspace holds, mirrored from Mission Control on each balance refresh. Empty means "none known", which the gate treats as fall-through, never as denial.';

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

REVOKE EXECUTE ON FUNCTION public.current_user_can_view(text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_can_edit(text)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_can_delete(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_can_view(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_edit(text)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_can_delete(text) TO authenticated, service_role;

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

REVOKE ALL ON public.report_versions FROM anon;

DROP POLICY IF EXISTS "Service role can manage report versions"            ON public.report_versions;
DROP POLICY IF EXISTS "All authenticated users can view all report versions" ON public.report_versions;

CREATE POLICY report_versions_select_module ON public.report_versions
  FOR SELECT TO authenticated USING (public.current_user_can_view('reports'));

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

DROP POLICY IF EXISTS "Authenticated users can view call logs" ON public.vapi_call_logs;

CREATE POLICY vapi_call_logs_select_module ON public.vapi_call_logs
  FOR SELECT TO authenticated USING (public.current_user_can_view('call_logs'));

DROP POLICY IF EXISTS global_report_settings_update_authenticated ON public.global_report_settings;

CREATE POLICY global_report_settings_update_module ON public.global_report_settings
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('settings'))
  WITH CHECK (public.current_user_can_edit('settings'));

DROP POLICY IF EXISTS "Authenticated users can insert whitelabel settings" ON public.whitelabel_settings;
DROP POLICY IF EXISTS "Authenticated users can update whitelabel settings" ON public.whitelabel_settings;

CREATE POLICY whitelabel_settings_insert_module ON public.whitelabel_settings
  FOR INSERT TO authenticated WITH CHECK (public.current_user_can_edit('white_label'));
CREATE POLICY whitelabel_settings_update_module ON public.whitelabel_settings
  FOR UPDATE TO authenticated
  USING (public.current_user_can_edit('white_label'))
  WITH CHECK (public.current_user_can_edit('white_label'));

DROP POLICY IF EXISTS "Authenticated can insert components" ON public.template_components;

CREATE POLICY template_components_insert_module ON public.template_components
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.current_user_can_edit('templates'));

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS created_by uuid DEFAULT auth.uid();

COMMENT ON COLUMN public.notifications.created_by IS
  'The custom_users.id that inserted this notification, pinned by RLS. NULL for service-role inserts made by edge functions.';

DROP POLICY IF EXISTS notifications_insert_authenticated ON public.notifications;

CREATE POLICY notifications_insert_attributed ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());