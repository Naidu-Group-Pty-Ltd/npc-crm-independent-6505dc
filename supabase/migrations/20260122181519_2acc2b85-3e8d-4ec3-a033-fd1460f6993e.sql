-- Phase 8: Final phase - secure remaining 6 tables
-- Tables: global_report_settings, integration_configs, land_tax_addons, 
-- land_tax_quarterly_splits, land_tax_rates, suburb_directory

-- 1. global_report_settings
DROP POLICY IF EXISTS "Allow all for global_report_settings" ON public.global_report_settings;
DROP POLICY IF EXISTS "global_report_settings_service_role_select" ON public.global_report_settings;
DROP POLICY IF EXISTS "global_report_settings_service_role_insert" ON public.global_report_settings;
DROP POLICY IF EXISTS "global_report_settings_service_role_update" ON public.global_report_settings;
DROP POLICY IF EXISTS "global_report_settings_service_role_delete" ON public.global_report_settings;

CREATE POLICY "global_report_settings_service_role_select" ON public.global_report_settings FOR SELECT TO service_role USING (true);
CREATE POLICY "global_report_settings_service_role_insert" ON public.global_report_settings FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "global_report_settings_service_role_update" ON public.global_report_settings FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "global_report_settings_service_role_delete" ON public.global_report_settings FOR DELETE TO service_role USING (true);

-- 2. integration_configs
DROP POLICY IF EXISTS "Allow all for integration_configs" ON public.integration_configs;
DROP POLICY IF EXISTS "integration_configs_service_role_select" ON public.integration_configs;
DROP POLICY IF EXISTS "integration_configs_service_role_insert" ON public.integration_configs;
DROP POLICY IF EXISTS "integration_configs_service_role_update" ON public.integration_configs;
DROP POLICY IF EXISTS "integration_configs_service_role_delete" ON public.integration_configs;

CREATE POLICY "integration_configs_service_role_select" ON public.integration_configs FOR SELECT TO service_role USING (true);
CREATE POLICY "integration_configs_service_role_insert" ON public.integration_configs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "integration_configs_service_role_update" ON public.integration_configs FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "integration_configs_service_role_delete" ON public.integration_configs FOR DELETE TO service_role USING (true);

-- 3. land_tax_addons
DROP POLICY IF EXISTS "Allow all for land_tax_addons" ON public.land_tax_addons;
DROP POLICY IF EXISTS "land_tax_addons_service_role_select" ON public.land_tax_addons;
DROP POLICY IF EXISTS "land_tax_addons_service_role_insert" ON public.land_tax_addons;
DROP POLICY IF EXISTS "land_tax_addons_service_role_update" ON public.land_tax_addons;
DROP POLICY IF EXISTS "land_tax_addons_service_role_delete" ON public.land_tax_addons;

CREATE POLICY "land_tax_addons_service_role_select" ON public.land_tax_addons FOR SELECT TO service_role USING (true);
CREATE POLICY "land_tax_addons_service_role_insert" ON public.land_tax_addons FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "land_tax_addons_service_role_update" ON public.land_tax_addons FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "land_tax_addons_service_role_delete" ON public.land_tax_addons FOR DELETE TO service_role USING (true);

-- 4. land_tax_quarterly_splits
DROP POLICY IF EXISTS "Allow all for land_tax_quarterly_splits" ON public.land_tax_quarterly_splits;
DROP POLICY IF EXISTS "land_tax_quarterly_splits_service_role_select" ON public.land_tax_quarterly_splits;
DROP POLICY IF EXISTS "land_tax_quarterly_splits_service_role_insert" ON public.land_tax_quarterly_splits;
DROP POLICY IF EXISTS "land_tax_quarterly_splits_service_role_update" ON public.land_tax_quarterly_splits;
DROP POLICY IF EXISTS "land_tax_quarterly_splits_service_role_delete" ON public.land_tax_quarterly_splits;

CREATE POLICY "land_tax_quarterly_splits_service_role_select" ON public.land_tax_quarterly_splits FOR SELECT TO service_role USING (true);
CREATE POLICY "land_tax_quarterly_splits_service_role_insert" ON public.land_tax_quarterly_splits FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "land_tax_quarterly_splits_service_role_update" ON public.land_tax_quarterly_splits FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "land_tax_quarterly_splits_service_role_delete" ON public.land_tax_quarterly_splits FOR DELETE TO service_role USING (true);

-- 5. land_tax_rates
DROP POLICY IF EXISTS "Allow all for land_tax_rates" ON public.land_tax_rates;
DROP POLICY IF EXISTS "land_tax_rates_service_role_select" ON public.land_tax_rates;
DROP POLICY IF EXISTS "land_tax_rates_service_role_insert" ON public.land_tax_rates;
DROP POLICY IF EXISTS "land_tax_rates_service_role_update" ON public.land_tax_rates;
DROP POLICY IF EXISTS "land_tax_rates_service_role_delete" ON public.land_tax_rates;

CREATE POLICY "land_tax_rates_service_role_select" ON public.land_tax_rates FOR SELECT TO service_role USING (true);
CREATE POLICY "land_tax_rates_service_role_insert" ON public.land_tax_rates FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "land_tax_rates_service_role_update" ON public.land_tax_rates FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "land_tax_rates_service_role_delete" ON public.land_tax_rates FOR DELETE TO service_role USING (true);

-- 6. suburb_directory
DROP POLICY IF EXISTS "Allow all for suburb_directory" ON public.suburb_directory;
DROP POLICY IF EXISTS "suburb_directory_service_role_select" ON public.suburb_directory;
DROP POLICY IF EXISTS "suburb_directory_service_role_insert" ON public.suburb_directory;
DROP POLICY IF EXISTS "suburb_directory_service_role_update" ON public.suburb_directory;
DROP POLICY IF EXISTS "suburb_directory_service_role_delete" ON public.suburb_directory;

CREATE POLICY "suburb_directory_service_role_select" ON public.suburb_directory FOR SELECT TO service_role USING (true);
CREATE POLICY "suburb_directory_service_role_insert" ON public.suburb_directory FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "suburb_directory_service_role_update" ON public.suburb_directory FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "suburb_directory_service_role_delete" ON public.suburb_directory FOR DELETE TO service_role USING (true);