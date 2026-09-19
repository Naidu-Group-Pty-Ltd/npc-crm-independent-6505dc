-- ================================================
-- SECURITY FIX: Lock down tables to service_role only
-- Phase 2: Client-related data tables
-- ================================================

-- ========== CLIENT INCOME ==========
DROP POLICY IF EXISTS "Allow all to view client_income" ON public.client_income;
DROP POLICY IF EXISTS "Allow all to create client_income" ON public.client_income;
DROP POLICY IF EXISTS "Allow all to update client_income" ON public.client_income;
DROP POLICY IF EXISTS "Allow all to delete client_income" ON public.client_income;
DROP POLICY IF EXISTS "client_income_service_role_select" ON public.client_income;
DROP POLICY IF EXISTS "client_income_service_role_insert" ON public.client_income;
DROP POLICY IF EXISTS "client_income_service_role_update" ON public.client_income;
DROP POLICY IF EXISTS "client_income_service_role_delete" ON public.client_income;

CREATE POLICY "client_income_service_role_select" ON public.client_income FOR SELECT TO service_role USING (true);
CREATE POLICY "client_income_service_role_insert" ON public.client_income FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_income_service_role_update" ON public.client_income FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_income_service_role_delete" ON public.client_income FOR DELETE TO service_role USING (true);

-- ========== CLIENT EXPENSES ==========
DROP POLICY IF EXISTS "Allow all to view client_expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "Allow all to create client_expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "Allow all to update client_expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "Allow all to delete client_expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "client_expenses_service_role_select" ON public.client_expenses;
DROP POLICY IF EXISTS "client_expenses_service_role_insert" ON public.client_expenses;
DROP POLICY IF EXISTS "client_expenses_service_role_update" ON public.client_expenses;
DROP POLICY IF EXISTS "client_expenses_service_role_delete" ON public.client_expenses;

CREATE POLICY "client_expenses_service_role_select" ON public.client_expenses FOR SELECT TO service_role USING (true);
CREATE POLICY "client_expenses_service_role_insert" ON public.client_expenses FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_expenses_service_role_update" ON public.client_expenses FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_expenses_service_role_delete" ON public.client_expenses FOR DELETE TO service_role USING (true);

-- ========== CLIENT ASSETS ==========
DROP POLICY IF EXISTS "Allow all to view client_assets" ON public.client_assets;
DROP POLICY IF EXISTS "Allow all to create client_assets" ON public.client_assets;
DROP POLICY IF EXISTS "Allow all to update client_assets" ON public.client_assets;
DROP POLICY IF EXISTS "Allow all to delete client_assets" ON public.client_assets;
DROP POLICY IF EXISTS "client_assets_service_role_select" ON public.client_assets;
DROP POLICY IF EXISTS "client_assets_service_role_insert" ON public.client_assets;
DROP POLICY IF EXISTS "client_assets_service_role_update" ON public.client_assets;
DROP POLICY IF EXISTS "client_assets_service_role_delete" ON public.client_assets;

CREATE POLICY "client_assets_service_role_select" ON public.client_assets FOR SELECT TO service_role USING (true);
CREATE POLICY "client_assets_service_role_insert" ON public.client_assets FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_assets_service_role_update" ON public.client_assets FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_assets_service_role_delete" ON public.client_assets FOR DELETE TO service_role USING (true);

-- ========== CLIENT LIABILITIES ==========
DROP POLICY IF EXISTS "Allow all to view client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "Allow all to create client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "Allow all to update client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "Allow all to delete client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "client_liabilities_service_role_select" ON public.client_liabilities;
DROP POLICY IF EXISTS "client_liabilities_service_role_insert" ON public.client_liabilities;
DROP POLICY IF EXISTS "client_liabilities_service_role_update" ON public.client_liabilities;
DROP POLICY IF EXISTS "client_liabilities_service_role_delete" ON public.client_liabilities;

CREATE POLICY "client_liabilities_service_role_select" ON public.client_liabilities FOR SELECT TO service_role USING (true);
CREATE POLICY "client_liabilities_service_role_insert" ON public.client_liabilities FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_liabilities_service_role_update" ON public.client_liabilities FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_liabilities_service_role_delete" ON public.client_liabilities FOR DELETE TO service_role USING (true);

-- ========== CLIENT EMPLOYMENT ==========
DROP POLICY IF EXISTS "Allow all to view client_employment" ON public.client_employment;
DROP POLICY IF EXISTS "Allow all to create client_employment" ON public.client_employment;
DROP POLICY IF EXISTS "Allow all to update client_employment" ON public.client_employment;
DROP POLICY IF EXISTS "Allow all to delete client_employment" ON public.client_employment;
DROP POLICY IF EXISTS "client_employment_service_role_select" ON public.client_employment;
DROP POLICY IF EXISTS "client_employment_service_role_insert" ON public.client_employment;
DROP POLICY IF EXISTS "client_employment_service_role_update" ON public.client_employment;
DROP POLICY IF EXISTS "client_employment_service_role_delete" ON public.client_employment;

CREATE POLICY "client_employment_service_role_select" ON public.client_employment FOR SELECT TO service_role USING (true);
CREATE POLICY "client_employment_service_role_insert" ON public.client_employment FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_employment_service_role_update" ON public.client_employment FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_employment_service_role_delete" ON public.client_employment FOR DELETE TO service_role USING (true);

-- ========== CLIENT NOTES ==========
DROP POLICY IF EXISTS "Allow all to view client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Allow all to create client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Allow all to update client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Allow all to delete client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Service role can read client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Service role can insert client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Service role can update client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Service role can delete client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "client_notes_service_role_select" ON public.client_notes;
DROP POLICY IF EXISTS "client_notes_service_role_insert" ON public.client_notes;
DROP POLICY IF EXISTS "client_notes_service_role_update" ON public.client_notes;
DROP POLICY IF EXISTS "client_notes_service_role_delete" ON public.client_notes;

CREATE POLICY "client_notes_service_role_select" ON public.client_notes FOR SELECT TO service_role USING (true);
CREATE POLICY "client_notes_service_role_insert" ON public.client_notes FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_notes_service_role_update" ON public.client_notes FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_notes_service_role_delete" ON public.client_notes FOR DELETE TO service_role USING (true);

-- ========== CLIENT FILES ==========
DROP POLICY IF EXISTS "Allow all to view client_files" ON public.client_files;
DROP POLICY IF EXISTS "Allow all to create client_files" ON public.client_files;
DROP POLICY IF EXISTS "Allow all to update client_files" ON public.client_files;
DROP POLICY IF EXISTS "Allow all to delete client_files" ON public.client_files;
DROP POLICY IF EXISTS "client_files_service_role_select" ON public.client_files;
DROP POLICY IF EXISTS "client_files_service_role_insert" ON public.client_files;
DROP POLICY IF EXISTS "client_files_service_role_update" ON public.client_files;
DROP POLICY IF EXISTS "client_files_service_role_delete" ON public.client_files;

CREATE POLICY "client_files_service_role_select" ON public.client_files FOR SELECT TO service_role USING (true);
CREATE POLICY "client_files_service_role_insert" ON public.client_files FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_files_service_role_update" ON public.client_files FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_files_service_role_delete" ON public.client_files FOR DELETE TO service_role USING (true);

-- ========== CLIENT ACTIVITIES ==========
DROP POLICY IF EXISTS "Allow all to view client_activities" ON public.client_activities;
DROP POLICY IF EXISTS "Allow all to create client_activities" ON public.client_activities;
DROP POLICY IF EXISTS "Allow all to update client_activities" ON public.client_activities;
DROP POLICY IF EXISTS "Allow all to delete client_activities" ON public.client_activities;
DROP POLICY IF EXISTS "client_activities_service_role_select" ON public.client_activities;
DROP POLICY IF EXISTS "client_activities_service_role_insert" ON public.client_activities;
DROP POLICY IF EXISTS "client_activities_service_role_update" ON public.client_activities;
DROP POLICY IF EXISTS "client_activities_service_role_delete" ON public.client_activities;

CREATE POLICY "client_activities_service_role_select" ON public.client_activities FOR SELECT TO service_role USING (true);
CREATE POLICY "client_activities_service_role_insert" ON public.client_activities FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_activities_service_role_update" ON public.client_activities FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_activities_service_role_delete" ON public.client_activities FOR DELETE TO service_role USING (true);

-- ========== CLIENT REMINDERS ==========
DROP POLICY IF EXISTS "Allow all to view client_reminders" ON public.client_reminders;
DROP POLICY IF EXISTS "Allow all to create client_reminders" ON public.client_reminders;
DROP POLICY IF EXISTS "Allow all to update client_reminders" ON public.client_reminders;
DROP POLICY IF EXISTS "Allow all to delete client_reminders" ON public.client_reminders;
DROP POLICY IF EXISTS "client_reminders_service_role_select" ON public.client_reminders;
DROP POLICY IF EXISTS "client_reminders_service_role_insert" ON public.client_reminders;
DROP POLICY IF EXISTS "client_reminders_service_role_update" ON public.client_reminders;
DROP POLICY IF EXISTS "client_reminders_service_role_delete" ON public.client_reminders;

CREATE POLICY "client_reminders_service_role_select" ON public.client_reminders FOR SELECT TO service_role USING (true);
CREATE POLICY "client_reminders_service_role_insert" ON public.client_reminders FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_reminders_service_role_update" ON public.client_reminders FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_reminders_service_role_delete" ON public.client_reminders FOR DELETE TO service_role USING (true);

-- ========== CLIENT SCORES ==========
DROP POLICY IF EXISTS "Allow all to view client_scores" ON public.client_scores;
DROP POLICY IF EXISTS "Allow all to create client_scores" ON public.client_scores;
DROP POLICY IF EXISTS "Allow all to update client_scores" ON public.client_scores;
DROP POLICY IF EXISTS "Allow all to delete client_scores" ON public.client_scores;
DROP POLICY IF EXISTS "client_scores_service_role_select" ON public.client_scores;
DROP POLICY IF EXISTS "client_scores_service_role_insert" ON public.client_scores;
DROP POLICY IF EXISTS "client_scores_service_role_update" ON public.client_scores;
DROP POLICY IF EXISTS "client_scores_service_role_delete" ON public.client_scores;

CREATE POLICY "client_scores_service_role_select" ON public.client_scores FOR SELECT TO service_role USING (true);
CREATE POLICY "client_scores_service_role_insert" ON public.client_scores FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_scores_service_role_update" ON public.client_scores FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_scores_service_role_delete" ON public.client_scores FOR DELETE TO service_role USING (true);

-- ========== CLIENT TAG ASSIGNMENTS ==========
DROP POLICY IF EXISTS "Allow all to view client_tag_assignments" ON public.client_tag_assignments;
DROP POLICY IF EXISTS "Allow all to create client_tag_assignments" ON public.client_tag_assignments;
DROP POLICY IF EXISTS "Allow all to update client_tag_assignments" ON public.client_tag_assignments;
DROP POLICY IF EXISTS "Allow all to delete client_tag_assignments" ON public.client_tag_assignments;
DROP POLICY IF EXISTS "client_tag_assignments_service_role_select" ON public.client_tag_assignments;
DROP POLICY IF EXISTS "client_tag_assignments_service_role_insert" ON public.client_tag_assignments;
DROP POLICY IF EXISTS "client_tag_assignments_service_role_update" ON public.client_tag_assignments;
DROP POLICY IF EXISTS "client_tag_assignments_service_role_delete" ON public.client_tag_assignments;

CREATE POLICY "client_tag_assignments_service_role_select" ON public.client_tag_assignments FOR SELECT TO service_role USING (true);
CREATE POLICY "client_tag_assignments_service_role_insert" ON public.client_tag_assignments FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_tag_assignments_service_role_update" ON public.client_tag_assignments FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_tag_assignments_service_role_delete" ON public.client_tag_assignments FOR DELETE TO service_role USING (true);

-- ========== CLIENT TAGS ==========
DROP POLICY IF EXISTS "Allow all to view client_tags" ON public.client_tags;
DROP POLICY IF EXISTS "Allow all to create client_tags" ON public.client_tags;
DROP POLICY IF EXISTS "Allow all to update client_tags" ON public.client_tags;
DROP POLICY IF EXISTS "Allow all to delete client_tags" ON public.client_tags;
DROP POLICY IF EXISTS "client_tags_service_role_select" ON public.client_tags;
DROP POLICY IF EXISTS "client_tags_service_role_insert" ON public.client_tags;
DROP POLICY IF EXISTS "client_tags_service_role_update" ON public.client_tags;
DROP POLICY IF EXISTS "client_tags_service_role_delete" ON public.client_tags;

CREATE POLICY "client_tags_service_role_select" ON public.client_tags FOR SELECT TO service_role USING (true);
CREATE POLICY "client_tags_service_role_insert" ON public.client_tags FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_tags_service_role_update" ON public.client_tags FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_tags_service_role_delete" ON public.client_tags FOR DELETE TO service_role USING (true);

-- ========== CLIENT IMPORT LOGS ==========
DROP POLICY IF EXISTS "Allow all to view client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "Allow all to create client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "Allow all to update client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "Allow all to delete client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_select" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_insert" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_update" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_delete" ON public.client_import_logs;

CREATE POLICY "client_import_logs_service_role_select" ON public.client_import_logs FOR SELECT TO service_role USING (true);
CREATE POLICY "client_import_logs_service_role_insert" ON public.client_import_logs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_import_logs_service_role_update" ON public.client_import_logs FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_import_logs_service_role_delete" ON public.client_import_logs FOR DELETE TO service_role USING (true);

-- ========== CLIENT BRANDING PROFILES ==========
DROP POLICY IF EXISTS "Allow all to view client_branding_profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "Allow all to create client_branding_profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "Allow all to update client_branding_profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "Allow all to delete client_branding_profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_select" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_insert" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_update" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_delete" ON public.client_branding_profiles;

CREATE POLICY "client_branding_profiles_service_role_select" ON public.client_branding_profiles FOR SELECT TO service_role USING (true);
CREATE POLICY "client_branding_profiles_service_role_insert" ON public.client_branding_profiles FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_branding_profiles_service_role_update" ON public.client_branding_profiles FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_branding_profiles_service_role_delete" ON public.client_branding_profiles FOR DELETE TO service_role USING (true);