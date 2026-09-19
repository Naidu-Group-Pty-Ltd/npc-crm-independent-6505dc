-- Phase 4: Lock down GHL pipelines, auto-reports, depreciation, bulk generation, and operational tables
-- These tables will only be accessible via service_role (Edge Functions)

-- =====================================================
-- 1. GHL Pipelines
-- =====================================================
DROP POLICY IF EXISTS "Allow all for ghl_pipelines" ON public.ghl_pipelines;
DROP POLICY IF EXISTS "ghl_pipelines_service_role_select" ON public.ghl_pipelines;
DROP POLICY IF EXISTS "ghl_pipelines_service_role_insert" ON public.ghl_pipelines;
DROP POLICY IF EXISTS "ghl_pipelines_service_role_update" ON public.ghl_pipelines;
DROP POLICY IF EXISTS "ghl_pipelines_service_role_delete" ON public.ghl_pipelines;

CREATE POLICY "ghl_pipelines_service_role_select" ON public.ghl_pipelines FOR SELECT TO service_role USING (true);
CREATE POLICY "ghl_pipelines_service_role_insert" ON public.ghl_pipelines FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "ghl_pipelines_service_role_update" ON public.ghl_pipelines FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "ghl_pipelines_service_role_delete" ON public.ghl_pipelines FOR DELETE TO service_role USING (true);

-- =====================================================
-- 2. GHL Pipeline Stages
-- =====================================================
DROP POLICY IF EXISTS "Allow all for ghl_pipeline_stages" ON public.ghl_pipeline_stages;
DROP POLICY IF EXISTS "ghl_pipeline_stages_service_role_select" ON public.ghl_pipeline_stages;
DROP POLICY IF EXISTS "ghl_pipeline_stages_service_role_insert" ON public.ghl_pipeline_stages;
DROP POLICY IF EXISTS "ghl_pipeline_stages_service_role_update" ON public.ghl_pipeline_stages;
DROP POLICY IF EXISTS "ghl_pipeline_stages_service_role_delete" ON public.ghl_pipeline_stages;

CREATE POLICY "ghl_pipeline_stages_service_role_select" ON public.ghl_pipeline_stages FOR SELECT TO service_role USING (true);
CREATE POLICY "ghl_pipeline_stages_service_role_insert" ON public.ghl_pipeline_stages FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "ghl_pipeline_stages_service_role_update" ON public.ghl_pipeline_stages FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "ghl_pipeline_stages_service_role_delete" ON public.ghl_pipeline_stages FOR DELETE TO service_role USING (true);

-- =====================================================
-- 3. Auto Report Switches
-- =====================================================
DROP POLICY IF EXISTS "Allow all for auto_report_switches" ON public.auto_report_switches;
DROP POLICY IF EXISTS "auto_report_switches_service_role_select" ON public.auto_report_switches;
DROP POLICY IF EXISTS "auto_report_switches_service_role_insert" ON public.auto_report_switches;
DROP POLICY IF EXISTS "auto_report_switches_service_role_update" ON public.auto_report_switches;
DROP POLICY IF EXISTS "auto_report_switches_service_role_delete" ON public.auto_report_switches;

CREATE POLICY "auto_report_switches_service_role_select" ON public.auto_report_switches FOR SELECT TO service_role USING (true);
CREATE POLICY "auto_report_switches_service_role_insert" ON public.auto_report_switches FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "auto_report_switches_service_role_update" ON public.auto_report_switches FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auto_report_switches_service_role_delete" ON public.auto_report_switches FOR DELETE TO service_role USING (true);

-- =====================================================
-- 4. Auto Report Master Settings
-- =====================================================
DROP POLICY IF EXISTS "Allow all for auto_report_master_settings" ON public.auto_report_master_settings;
DROP POLICY IF EXISTS "auto_report_master_settings_service_role_select" ON public.auto_report_master_settings;
DROP POLICY IF EXISTS "auto_report_master_settings_service_role_insert" ON public.auto_report_master_settings;
DROP POLICY IF EXISTS "auto_report_master_settings_service_role_update" ON public.auto_report_master_settings;
DROP POLICY IF EXISTS "auto_report_master_settings_service_role_delete" ON public.auto_report_master_settings;

CREATE POLICY "auto_report_master_settings_service_role_select" ON public.auto_report_master_settings FOR SELECT TO service_role USING (true);
CREATE POLICY "auto_report_master_settings_service_role_insert" ON public.auto_report_master_settings FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "auto_report_master_settings_service_role_update" ON public.auto_report_master_settings FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auto_report_master_settings_service_role_delete" ON public.auto_report_master_settings FOR DELETE TO service_role USING (true);

-- =====================================================
-- 5. Auto Report Processed Listings
-- =====================================================
DROP POLICY IF EXISTS "Allow all for auto_report_processed_listings" ON public.auto_report_processed_listings;
DROP POLICY IF EXISTS "auto_report_processed_listings_service_role_select" ON public.auto_report_processed_listings;
DROP POLICY IF EXISTS "auto_report_processed_listings_service_role_insert" ON public.auto_report_processed_listings;
DROP POLICY IF EXISTS "auto_report_processed_listings_service_role_update" ON public.auto_report_processed_listings;
DROP POLICY IF EXISTS "auto_report_processed_listings_service_role_delete" ON public.auto_report_processed_listings;

CREATE POLICY "auto_report_processed_listings_service_role_select" ON public.auto_report_processed_listings FOR SELECT TO service_role USING (true);
CREATE POLICY "auto_report_processed_listings_service_role_insert" ON public.auto_report_processed_listings FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "auto_report_processed_listings_service_role_update" ON public.auto_report_processed_listings FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auto_report_processed_listings_service_role_delete" ON public.auto_report_processed_listings FOR DELETE TO service_role USING (true);

-- =====================================================
-- 6. Auto Report Generation Log
-- =====================================================
DROP POLICY IF EXISTS "Allow all for auto_report_generation_log" ON public.auto_report_generation_log;
DROP POLICY IF EXISTS "auto_report_generation_log_service_role_select" ON public.auto_report_generation_log;
DROP POLICY IF EXISTS "auto_report_generation_log_service_role_insert" ON public.auto_report_generation_log;
DROP POLICY IF EXISTS "auto_report_generation_log_service_role_update" ON public.auto_report_generation_log;
DROP POLICY IF EXISTS "auto_report_generation_log_service_role_delete" ON public.auto_report_generation_log;

CREATE POLICY "auto_report_generation_log_service_role_select" ON public.auto_report_generation_log FOR SELECT TO service_role USING (true);
CREATE POLICY "auto_report_generation_log_service_role_insert" ON public.auto_report_generation_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "auto_report_generation_log_service_role_update" ON public.auto_report_generation_log FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "auto_report_generation_log_service_role_delete" ON public.auto_report_generation_log FOR DELETE TO service_role USING (true);

-- =====================================================
-- 7. Depreciation Comps
-- =====================================================
DROP POLICY IF EXISTS "Allow all for depreciation_comps" ON public.depreciation_comps;
DROP POLICY IF EXISTS "depreciation_comps_service_role_select" ON public.depreciation_comps;
DROP POLICY IF EXISTS "depreciation_comps_service_role_insert" ON public.depreciation_comps;
DROP POLICY IF EXISTS "depreciation_comps_service_role_update" ON public.depreciation_comps;
DROP POLICY IF EXISTS "depreciation_comps_service_role_delete" ON public.depreciation_comps;

CREATE POLICY "depreciation_comps_service_role_select" ON public.depreciation_comps FOR SELECT TO service_role USING (true);
CREATE POLICY "depreciation_comps_service_role_insert" ON public.depreciation_comps FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "depreciation_comps_service_role_update" ON public.depreciation_comps FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "depreciation_comps_service_role_delete" ON public.depreciation_comps FOR DELETE TO service_role USING (true);

-- =====================================================
-- 8. Depreciation Estimator Runs
-- =====================================================
DROP POLICY IF EXISTS "Allow all for depreciation_estimator_runs" ON public.depreciation_estimator_runs;
DROP POLICY IF EXISTS "depreciation_estimator_runs_service_role_select" ON public.depreciation_estimator_runs;
DROP POLICY IF EXISTS "depreciation_estimator_runs_service_role_insert" ON public.depreciation_estimator_runs;
DROP POLICY IF EXISTS "depreciation_estimator_runs_service_role_update" ON public.depreciation_estimator_runs;
DROP POLICY IF EXISTS "depreciation_estimator_runs_service_role_delete" ON public.depreciation_estimator_runs;

CREATE POLICY "depreciation_estimator_runs_service_role_select" ON public.depreciation_estimator_runs FOR SELECT TO service_role USING (true);
CREATE POLICY "depreciation_estimator_runs_service_role_insert" ON public.depreciation_estimator_runs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "depreciation_estimator_runs_service_role_update" ON public.depreciation_estimator_runs FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "depreciation_estimator_runs_service_role_delete" ON public.depreciation_estimator_runs FOR DELETE TO service_role USING (true);

-- =====================================================
-- 9. Bulk Generation Jobs
-- =====================================================
DROP POLICY IF EXISTS "Allow all for bulk_generation_jobs" ON public.bulk_generation_jobs;
DROP POLICY IF EXISTS "bulk_generation_jobs_service_role_select" ON public.bulk_generation_jobs;
DROP POLICY IF EXISTS "bulk_generation_jobs_service_role_insert" ON public.bulk_generation_jobs;
DROP POLICY IF EXISTS "bulk_generation_jobs_service_role_update" ON public.bulk_generation_jobs;
DROP POLICY IF EXISTS "bulk_generation_jobs_service_role_delete" ON public.bulk_generation_jobs;

CREATE POLICY "bulk_generation_jobs_service_role_select" ON public.bulk_generation_jobs FOR SELECT TO service_role USING (true);
CREATE POLICY "bulk_generation_jobs_service_role_insert" ON public.bulk_generation_jobs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "bulk_generation_jobs_service_role_update" ON public.bulk_generation_jobs FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "bulk_generation_jobs_service_role_delete" ON public.bulk_generation_jobs FOR DELETE TO service_role USING (true);

-- =====================================================
-- 10. Bulk Generation Items
-- =====================================================
DROP POLICY IF EXISTS "Allow all for bulk_generation_items" ON public.bulk_generation_items;
DROP POLICY IF EXISTS "bulk_generation_items_service_role_select" ON public.bulk_generation_items;
DROP POLICY IF EXISTS "bulk_generation_items_service_role_insert" ON public.bulk_generation_items;
DROP POLICY IF EXISTS "bulk_generation_items_service_role_update" ON public.bulk_generation_items;
DROP POLICY IF EXISTS "bulk_generation_items_service_role_delete" ON public.bulk_generation_items;

CREATE POLICY "bulk_generation_items_service_role_select" ON public.bulk_generation_items FOR SELECT TO service_role USING (true);
CREATE POLICY "bulk_generation_items_service_role_insert" ON public.bulk_generation_items FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "bulk_generation_items_service_role_update" ON public.bulk_generation_items FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "bulk_generation_items_service_role_delete" ON public.bulk_generation_items FOR DELETE TO service_role USING (true);

-- =====================================================
-- 11. Dashboard Modules
-- =====================================================
DROP POLICY IF EXISTS "Allow all for dashboard_modules" ON public.dashboard_modules;
DROP POLICY IF EXISTS "dashboard_modules_service_role_select" ON public.dashboard_modules;
DROP POLICY IF EXISTS "dashboard_modules_service_role_insert" ON public.dashboard_modules;
DROP POLICY IF EXISTS "dashboard_modules_service_role_update" ON public.dashboard_modules;
DROP POLICY IF EXISTS "dashboard_modules_service_role_delete" ON public.dashboard_modules;

CREATE POLICY "dashboard_modules_service_role_select" ON public.dashboard_modules FOR SELECT TO service_role USING (true);
CREATE POLICY "dashboard_modules_service_role_insert" ON public.dashboard_modules FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "dashboard_modules_service_role_update" ON public.dashboard_modules FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "dashboard_modules_service_role_delete" ON public.dashboard_modules FOR DELETE TO service_role USING (true);

-- =====================================================
-- 12. Chart Configurations
-- =====================================================
DROP POLICY IF EXISTS "Allow all for chart_configurations" ON public.chart_configurations;
DROP POLICY IF EXISTS "chart_configurations_service_role_select" ON public.chart_configurations;
DROP POLICY IF EXISTS "chart_configurations_service_role_insert" ON public.chart_configurations;
DROP POLICY IF EXISTS "chart_configurations_service_role_update" ON public.chart_configurations;
DROP POLICY IF EXISTS "chart_configurations_service_role_delete" ON public.chart_configurations;

CREATE POLICY "chart_configurations_service_role_select" ON public.chart_configurations FOR SELECT TO service_role USING (true);
CREATE POLICY "chart_configurations_service_role_insert" ON public.chart_configurations FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "chart_configurations_service_role_update" ON public.chart_configurations FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chart_configurations_service_role_delete" ON public.chart_configurations FOR DELETE TO service_role USING (true);

-- =====================================================
-- 13. Finance Agent Contacts
-- =====================================================
DROP POLICY IF EXISTS "Allow all for finance_agent_contacts" ON public.finance_agent_contacts;
DROP POLICY IF EXISTS "finance_agent_contacts_service_role_select" ON public.finance_agent_contacts;
DROP POLICY IF EXISTS "finance_agent_contacts_service_role_insert" ON public.finance_agent_contacts;
DROP POLICY IF EXISTS "finance_agent_contacts_service_role_update" ON public.finance_agent_contacts;
DROP POLICY IF EXISTS "finance_agent_contacts_service_role_delete" ON public.finance_agent_contacts;

CREATE POLICY "finance_agent_contacts_service_role_select" ON public.finance_agent_contacts FOR SELECT TO service_role USING (true);
CREATE POLICY "finance_agent_contacts_service_role_insert" ON public.finance_agent_contacts FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "finance_agent_contacts_service_role_update" ON public.finance_agent_contacts FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "finance_agent_contacts_service_role_delete" ON public.finance_agent_contacts FOR DELETE TO service_role USING (true);

-- =====================================================
-- 14. Borrowing Capacity Assessments
-- =====================================================
DROP POLICY IF EXISTS "Allow all for borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_select" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_insert" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_update" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_delete" ON public.borrowing_capacity_assessments;

CREATE POLICY "borrowing_capacity_assessments_service_role_select" ON public.borrowing_capacity_assessments FOR SELECT TO service_role USING (true);
CREATE POLICY "borrowing_capacity_assessments_service_role_insert" ON public.borrowing_capacity_assessments FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "borrowing_capacity_assessments_service_role_update" ON public.borrowing_capacity_assessments FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "borrowing_capacity_assessments_service_role_delete" ON public.borrowing_capacity_assessments FOR DELETE TO service_role USING (true);