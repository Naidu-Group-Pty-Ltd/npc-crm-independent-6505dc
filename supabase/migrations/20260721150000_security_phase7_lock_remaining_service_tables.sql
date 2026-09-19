-- Applied to production 2026-07-21 via MCP (security_phase7_lock_remaining_service_tables).
--
-- Phase 7 (F-07): lock down the remaining service-managed always-true tables.
-- Writes on all of these flow through service-role edge functions (data
-- mediation via invoke(), sync jobs, etc.) — none are written directly by the
-- frontend. Access patterns were classified per table:
--   * zero string references in src            -> REVOKE ALL (full lockdown)
--   * realtime subscription / invoke() / direct
--     SELECT reference                          -> REVOKE writes, keep SELECT
-- Keeping SELECT preserves client-portal realtime (messages/notifications),
-- agent chat, report-QA and call-alert live updates, plus reference-data reads.
-- service_role retains all grants and bypasses RLS.
--
-- NOTE: several realtime tables (client_portal_messages/notifications,
-- report_qa_*, agent_messages) retain permissive SELECT and are readable with
-- the anon key. Ownership-predicate SELECT scoping for those is tracked as
-- follow-up (requires the portal/agent realtime auth model).

-- Zero frontend references anywhere -> full lockdown
REVOKE ALL ON public.agent_conversations FROM anon, authenticated;
REVOKE ALL ON public.bank_lending_rates_cache FROM anon, authenticated;
REVOKE ALL ON public.brand_kits FROM anon, authenticated;
REVOKE ALL ON public.design_tokens FROM anon, authenticated;
REVOKE ALL ON public.gamma_agreement_templates FROM anon, authenticated;
REVOKE ALL ON public.land_tax_addons FROM anon, authenticated;
REVOKE ALL ON public.land_tax_quarterly_splits FROM anon, authenticated;
REVOKE ALL ON public.market_update_questions FROM anon, authenticated;
REVOKE ALL ON public.marketing_report_distribution_log FROM anon, authenticated;
REVOKE ALL ON public.marketing_report_schedules FROM anon, authenticated;
REVOKE ALL ON public.marketing_reports FROM anon, authenticated;
REVOKE ALL ON public.template_approvals FROM anon, authenticated;

-- Realtime / invoke / read-only reference tables -> revoke writes, keep SELECT
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.abs_census_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.agent_messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.call_alert_history FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.call_alert_rules FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.call_tags FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.checklist_instance_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.checklist_instances FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.checklist_template_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.checklist_template_sections FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.checklist_templates FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.client_portal_messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.client_portal_notifications FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.climate_data_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.comparison_analysis_templates FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cover_page_overlays FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.crime_statistics_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.deal_stages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.depreciation_estimator_runs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.economic_data_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.game_plan_actions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.game_plan_kpis FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.game_plan_milestones FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.game_plan_notes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.game_plan_phases FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.game_plans FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.land_tax_rates FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.marketing_intelligence_reports FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.median_rent_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.report_qa_conversations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.report_qa_messages FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.report_versions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.risk_assessment_cache FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.schools_directory FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.suburb_directory FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.transport_data_cache FROM anon, authenticated;
