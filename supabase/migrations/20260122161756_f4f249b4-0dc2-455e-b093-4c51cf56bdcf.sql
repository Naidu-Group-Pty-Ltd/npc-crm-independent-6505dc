-- Add service_role policies for client_income
DROP POLICY IF EXISTS "service_role_select_client_income" ON public.client_income;
DROP POLICY IF EXISTS "service_role_insert_client_income" ON public.client_income;
DROP POLICY IF EXISTS "service_role_update_client_income" ON public.client_income;
DROP POLICY IF EXISTS "service_role_delete_client_income" ON public.client_income;

CREATE POLICY "service_role_select_client_income"
ON public.client_income FOR SELECT
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_insert_client_income"
ON public.client_income FOR INSERT
WITH CHECK (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_update_client_income"
ON public.client_income FOR UPDATE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_delete_client_income"
ON public.client_income FOR DELETE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

-- Add service_role policies for client_liabilities
DROP POLICY IF EXISTS "service_role_select_client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "service_role_insert_client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "service_role_update_client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "service_role_delete_client_liabilities" ON public.client_liabilities;

CREATE POLICY "service_role_select_client_liabilities"
ON public.client_liabilities FOR SELECT
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_insert_client_liabilities"
ON public.client_liabilities FOR INSERT
WITH CHECK (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_update_client_liabilities"
ON public.client_liabilities FOR UPDATE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_delete_client_liabilities"
ON public.client_liabilities FOR DELETE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

-- Add service_role policies for client_properties
DROP POLICY IF EXISTS "service_role_select_client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "service_role_insert_client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "service_role_update_client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "service_role_delete_client_properties" ON public.client_properties;

CREATE POLICY "service_role_select_client_properties"
ON public.client_properties FOR SELECT
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_insert_client_properties"
ON public.client_properties FOR INSERT
WITH CHECK (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_update_client_properties"
ON public.client_properties FOR UPDATE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_delete_client_properties"
ON public.client_properties FOR DELETE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

-- Add service_role policies for client_import_logs
DROP POLICY IF EXISTS "service_role_select_client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "service_role_insert_client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "service_role_update_client_import_logs" ON public.client_import_logs;
DROP POLICY IF EXISTS "service_role_delete_client_import_logs" ON public.client_import_logs;

CREATE POLICY "service_role_select_client_import_logs"
ON public.client_import_logs FOR SELECT
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_insert_client_import_logs"
ON public.client_import_logs FOR INSERT
WITH CHECK (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_update_client_import_logs"
ON public.client_import_logs FOR UPDATE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');

CREATE POLICY "service_role_delete_client_import_logs"
ON public.client_import_logs FOR DELETE
USING (((current_setting('request.jwt.claims', true))::json->>'role') = 'service_role');