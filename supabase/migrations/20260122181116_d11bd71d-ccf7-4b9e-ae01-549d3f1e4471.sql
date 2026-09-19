-- Phase 6: Secure only confirmed existing tables
-- Tables: schools_directory, stamp_duty_rates_cache, transport_data_cache, 
-- risk_assessment_cache, median_rent_cache, report_versions, 
-- report_qa_conversations, report_qa_messages

-- 1. schools_directory
DROP POLICY IF EXISTS "Allow all for schools_directory" ON public.schools_directory;
DROP POLICY IF EXISTS "schools_directory_service_role_select" ON public.schools_directory;
DROP POLICY IF EXISTS "schools_directory_service_role_insert" ON public.schools_directory;
DROP POLICY IF EXISTS "schools_directory_service_role_update" ON public.schools_directory;
DROP POLICY IF EXISTS "schools_directory_service_role_delete" ON public.schools_directory;

CREATE POLICY "schools_directory_service_role_select" ON public.schools_directory FOR SELECT TO service_role USING (true);
CREATE POLICY "schools_directory_service_role_insert" ON public.schools_directory FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "schools_directory_service_role_update" ON public.schools_directory FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "schools_directory_service_role_delete" ON public.schools_directory FOR DELETE TO service_role USING (true);

-- 2. stamp_duty_rates_cache
DROP POLICY IF EXISTS "Allow all for stamp_duty_rates_cache" ON public.stamp_duty_rates_cache;
DROP POLICY IF EXISTS "stamp_duty_rates_cache_service_role_select" ON public.stamp_duty_rates_cache;
DROP POLICY IF EXISTS "stamp_duty_rates_cache_service_role_insert" ON public.stamp_duty_rates_cache;
DROP POLICY IF EXISTS "stamp_duty_rates_cache_service_role_update" ON public.stamp_duty_rates_cache;
DROP POLICY IF EXISTS "stamp_duty_rates_cache_service_role_delete" ON public.stamp_duty_rates_cache;

CREATE POLICY "stamp_duty_rates_cache_service_role_select" ON public.stamp_duty_rates_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "stamp_duty_rates_cache_service_role_insert" ON public.stamp_duty_rates_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "stamp_duty_rates_cache_service_role_update" ON public.stamp_duty_rates_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "stamp_duty_rates_cache_service_role_delete" ON public.stamp_duty_rates_cache FOR DELETE TO service_role USING (true);

-- 3. transport_data_cache
DROP POLICY IF EXISTS "Allow all for transport_data_cache" ON public.transport_data_cache;
DROP POLICY IF EXISTS "transport_data_cache_service_role_select" ON public.transport_data_cache;
DROP POLICY IF EXISTS "transport_data_cache_service_role_insert" ON public.transport_data_cache;
DROP POLICY IF EXISTS "transport_data_cache_service_role_update" ON public.transport_data_cache;
DROP POLICY IF EXISTS "transport_data_cache_service_role_delete" ON public.transport_data_cache;

CREATE POLICY "transport_data_cache_service_role_select" ON public.transport_data_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "transport_data_cache_service_role_insert" ON public.transport_data_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "transport_data_cache_service_role_update" ON public.transport_data_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "transport_data_cache_service_role_delete" ON public.transport_data_cache FOR DELETE TO service_role USING (true);

-- 4. risk_assessment_cache
DROP POLICY IF EXISTS "Allow all for risk_assessment_cache" ON public.risk_assessment_cache;
DROP POLICY IF EXISTS "risk_assessment_cache_service_role_select" ON public.risk_assessment_cache;
DROP POLICY IF EXISTS "risk_assessment_cache_service_role_insert" ON public.risk_assessment_cache;
DROP POLICY IF EXISTS "risk_assessment_cache_service_role_update" ON public.risk_assessment_cache;
DROP POLICY IF EXISTS "risk_assessment_cache_service_role_delete" ON public.risk_assessment_cache;

CREATE POLICY "risk_assessment_cache_service_role_select" ON public.risk_assessment_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "risk_assessment_cache_service_role_insert" ON public.risk_assessment_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "risk_assessment_cache_service_role_update" ON public.risk_assessment_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "risk_assessment_cache_service_role_delete" ON public.risk_assessment_cache FOR DELETE TO service_role USING (true);

-- 5. median_rent_cache
DROP POLICY IF EXISTS "Allow all for median_rent_cache" ON public.median_rent_cache;
DROP POLICY IF EXISTS "median_rent_cache_service_role_select" ON public.median_rent_cache;
DROP POLICY IF EXISTS "median_rent_cache_service_role_insert" ON public.median_rent_cache;
DROP POLICY IF EXISTS "median_rent_cache_service_role_update" ON public.median_rent_cache;
DROP POLICY IF EXISTS "median_rent_cache_service_role_delete" ON public.median_rent_cache;

CREATE POLICY "median_rent_cache_service_role_select" ON public.median_rent_cache FOR SELECT TO service_role USING (true);
CREATE POLICY "median_rent_cache_service_role_insert" ON public.median_rent_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "median_rent_cache_service_role_update" ON public.median_rent_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "median_rent_cache_service_role_delete" ON public.median_rent_cache FOR DELETE TO service_role USING (true);

-- 6. report_versions
DROP POLICY IF EXISTS "Allow all for report_versions" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_select" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_insert" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_update" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_delete" ON public.report_versions;

CREATE POLICY "report_versions_service_role_select" ON public.report_versions FOR SELECT TO service_role USING (true);
CREATE POLICY "report_versions_service_role_insert" ON public.report_versions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "report_versions_service_role_update" ON public.report_versions FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "report_versions_service_role_delete" ON public.report_versions FOR DELETE TO service_role USING (true);

-- 7. report_qa_conversations
DROP POLICY IF EXISTS "Allow all for report_qa_conversations" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_select" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_insert" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_update" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_delete" ON public.report_qa_conversations;

CREATE POLICY "report_qa_conversations_service_role_select" ON public.report_qa_conversations FOR SELECT TO service_role USING (true);
CREATE POLICY "report_qa_conversations_service_role_insert" ON public.report_qa_conversations FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "report_qa_conversations_service_role_update" ON public.report_qa_conversations FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "report_qa_conversations_service_role_delete" ON public.report_qa_conversations FOR DELETE TO service_role USING (true);

-- 8. report_qa_messages
DROP POLICY IF EXISTS "Allow all for report_qa_messages" ON public.report_qa_messages;
DROP POLICY IF EXISTS "report_qa_messages_service_role_select" ON public.report_qa_messages;
DROP POLICY IF EXISTS "report_qa_messages_service_role_insert" ON public.report_qa_messages;
DROP POLICY IF EXISTS "report_qa_messages_service_role_update" ON public.report_qa_messages;
DROP POLICY IF EXISTS "report_qa_messages_service_role_delete" ON public.report_qa_messages;

CREATE POLICY "report_qa_messages_service_role_select" ON public.report_qa_messages FOR SELECT TO service_role USING (true);
CREATE POLICY "report_qa_messages_service_role_insert" ON public.report_qa_messages FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "report_qa_messages_service_role_update" ON public.report_qa_messages FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "report_qa_messages_service_role_delete" ON public.report_qa_messages FOR DELETE TO service_role USING (true);