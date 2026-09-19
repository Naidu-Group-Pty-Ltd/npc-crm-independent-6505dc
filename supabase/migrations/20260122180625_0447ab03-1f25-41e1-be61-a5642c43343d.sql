-- Phase 5: Lock down cache tables, API health logs, and remaining operational tables
-- These tables will only be accessible via service_role (Edge Functions)

-- =====================================================
-- 1. ABS Census Cache
-- =====================================================
DROP POLICY IF EXISTS "Allow all for abs_census_cache" ON public.abs_census_cache;
DROP POLICY IF EXISTS "abs_census_cache_service_role_select" ON public.abs_census_cache;
DROP POLICY IF EXISTS "abs_census_cache_service_role_insert" ON public.abs_census_cache;
DROP POLICY IF EXISTS "abs_census_cache_service_role_update" ON public.abs_census_cache;
DROP POLICY IF EXISTS "abs_census_cache_service_role_delete" ON public.abs_census_cache;

CREATE POLICY "abs_census_cache_service_role_select" ON public.abs_census_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "abs_census_cache_service_role_insert" ON public.abs_census_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "abs_census_cache_service_role_update" ON public.abs_census_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "abs_census_cache_service_role_delete" ON public.abs_census_cache FOR DELETE TO service_role USING (true);

-- =====================================================
-- 2. Bank Lending Rates Cache
-- =====================================================
DROP POLICY IF EXISTS "Allow all for bank_lending_rates_cache" ON public.bank_lending_rates_cache;
DROP POLICY IF EXISTS "bank_lending_rates_cache_service_role_select" ON public.bank_lending_rates_cache;
DROP POLICY IF EXISTS "bank_lending_rates_cache_service_role_insert" ON public.bank_lending_rates_cache;
DROP POLICY IF EXISTS "bank_lending_rates_cache_service_role_update" ON public.bank_lending_rates_cache;
DROP POLICY IF EXISTS "bank_lending_rates_cache_service_role_delete" ON public.bank_lending_rates_cache;

CREATE POLICY "bank_lending_rates_cache_service_role_select" ON public.bank_lending_rates_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "bank_lending_rates_cache_service_role_insert" ON public.bank_lending_rates_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "bank_lending_rates_cache_service_role_update" ON public.bank_lending_rates_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "bank_lending_rates_cache_service_role_delete" ON public.bank_lending_rates_cache FOR DELETE TO service_role USING (true);

-- =====================================================
-- 3. Climate Data Cache
-- =====================================================
DROP POLICY IF EXISTS "Allow all for climate_data_cache" ON public.climate_data_cache;
DROP POLICY IF EXISTS "climate_data_cache_service_role_select" ON public.climate_data_cache;
DROP POLICY IF EXISTS "climate_data_cache_service_role_insert" ON public.climate_data_cache;
DROP POLICY IF EXISTS "climate_data_cache_service_role_update" ON public.climate_data_cache;
DROP POLICY IF EXISTS "climate_data_cache_service_role_delete" ON public.climate_data_cache;

CREATE POLICY "climate_data_cache_service_role_select" ON public.climate_data_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "climate_data_cache_service_role_insert" ON public.climate_data_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "climate_data_cache_service_role_update" ON public.climate_data_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "climate_data_cache_service_role_delete" ON public.climate_data_cache FOR DELETE TO service_role USING (true);

-- =====================================================
-- 4. Crime Statistics Cache
-- =====================================================
DROP POLICY IF EXISTS "Allow all for crime_statistics_cache" ON public.crime_statistics_cache;
DROP POLICY IF EXISTS "crime_statistics_cache_service_role_select" ON public.crime_statistics_cache;
DROP POLICY IF EXISTS "crime_statistics_cache_service_role_insert" ON public.crime_statistics_cache;
DROP POLICY IF EXISTS "crime_statistics_cache_service_role_update" ON public.crime_statistics_cache;
DROP POLICY IF EXISTS "crime_statistics_cache_service_role_delete" ON public.crime_statistics_cache;

CREATE POLICY "crime_statistics_cache_service_role_select" ON public.crime_statistics_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "crime_statistics_cache_service_role_insert" ON public.crime_statistics_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "crime_statistics_cache_service_role_update" ON public.crime_statistics_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "crime_statistics_cache_service_role_delete" ON public.crime_statistics_cache FOR DELETE TO service_role USING (true);

-- =====================================================
-- 5. Economic Data Cache
-- =====================================================
DROP POLICY IF EXISTS "Allow all for economic_data_cache" ON public.economic_data_cache;
DROP POLICY IF EXISTS "economic_data_cache_service_role_select" ON public.economic_data_cache;
DROP POLICY IF EXISTS "economic_data_cache_service_role_insert" ON public.economic_data_cache;
DROP POLICY IF EXISTS "economic_data_cache_service_role_update" ON public.economic_data_cache;
DROP POLICY IF EXISTS "economic_data_cache_service_role_delete" ON public.economic_data_cache;

CREATE POLICY "economic_data_cache_service_role_select" ON public.economic_data_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "economic_data_cache_service_role_insert" ON public.economic_data_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "economic_data_cache_service_role_update" ON public.economic_data_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "economic_data_cache_service_role_delete" ON public.economic_data_cache FOR DELETE TO service_role USING (true);

-- =====================================================
-- 6. API Health Log
-- =====================================================
DROP POLICY IF EXISTS "Allow all for api_health_log" ON public.api_health_log;
DROP POLICY IF EXISTS "api_health_log_service_role_select" ON public.api_health_log;
DROP POLICY IF EXISTS "api_health_log_service_role_insert" ON public.api_health_log;
DROP POLICY IF EXISTS "api_health_log_service_role_update" ON public.api_health_log;
DROP POLICY IF EXISTS "api_health_log_service_role_delete" ON public.api_health_log;

CREATE POLICY "api_health_log_service_role_select" ON public.api_health_log FOR SELECT TO service_role USING (true);
CREATE POLICY "api_health_log_service_role_insert" ON public.api_health_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "api_health_log_service_role_update" ON public.api_health_log FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "api_health_log_service_role_delete" ON public.api_health_log FOR DELETE TO service_role USING (true);

-- =====================================================
-- 7. Client Branding Profiles
-- =====================================================
DROP POLICY IF EXISTS "Allow all for client_branding_profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_select" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_insert" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_update" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "client_branding_profiles_service_role_delete" ON public.client_branding_profiles;

CREATE POLICY "client_branding_profiles_service_role_select" ON public.client_branding_profiles FOR SELECT TO service_role USING (true);
CREATE POLICY "client_branding_profiles_service_role_insert" ON public.client_branding_profiles FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_branding_profiles_service_role_update" ON public.client_branding_profiles FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_branding_profiles_service_role_delete" ON public.client_branding_profiles FOR DELETE TO service_role USING (true);

-- =====================================================
-- 8. Client Import Logs
-- =====================================================
DROP POLICY IF EXISTS "Allow all for client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_select" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_insert" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_update" ON public.client_import_logs;
DROP POLICY IF EXISTS "client_import_logs_service_role_delete" ON public.client_import_logs;

CREATE POLICY "client_import_logs_service_role_select" ON public.client_import_logs FOR SELECT TO service_role USING (true);
CREATE POLICY "client_import_logs_service_role_insert" ON public.client_import_logs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_import_logs_service_role_update" ON public.client_import_logs FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_import_logs_service_role_delete" ON public.client_import_logs FOR DELETE TO service_role USING (true);

-- =====================================================
-- 9. User Roles (Critical security table)
-- =====================================================
DROP POLICY IF EXISTS "Allow all for user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_select" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_delete" ON public.user_roles;

CREATE POLICY "user_roles_service_role_select" ON public.user_roles FOR SELECT TO service_role USING (true);
CREATE POLICY "user_roles_service_role_insert" ON public.user_roles FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "user_roles_service_role_update" ON public.user_roles FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "user_roles_service_role_delete" ON public.user_roles FOR DELETE TO service_role USING (true);

-- =====================================================
-- 10. User Permissions
-- =====================================================
DROP POLICY IF EXISTS "Allow all for user_permissions" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_select" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_insert" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_update" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_delete" ON public.user_permissions;

CREATE POLICY "user_permissions_service_role_select" ON public.user_permissions FOR SELECT TO service_role USING (true);
CREATE POLICY "user_permissions_service_role_insert" ON public.user_permissions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "user_permissions_service_role_update" ON public.user_permissions FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "user_permissions_service_role_delete" ON public.user_permissions FOR DELETE TO service_role USING (true);