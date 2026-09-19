-- Phase 3: Lock down email, reports, call management, and remaining sensitive tables
-- Excludes vapi_call_tag_assignments (does not exist)

-- ============================================
-- 1. email_copilot_emails - Contains email content
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.email_copilot_emails;
DROP POLICY IF EXISTS "email_copilot_emails_service_role_select" ON public.email_copilot_emails;
DROP POLICY IF EXISTS "email_copilot_emails_service_role_insert" ON public.email_copilot_emails;
DROP POLICY IF EXISTS "email_copilot_emails_service_role_update" ON public.email_copilot_emails;
DROP POLICY IF EXISTS "email_copilot_emails_service_role_delete" ON public.email_copilot_emails;

CREATE POLICY "email_copilot_emails_service_role_select" ON public.email_copilot_emails FOR SELECT TO service_role USING (true);
CREATE POLICY "email_copilot_emails_service_role_insert" ON public.email_copilot_emails FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "email_copilot_emails_service_role_update" ON public.email_copilot_emails FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "email_copilot_emails_service_role_delete" ON public.email_copilot_emails FOR DELETE TO service_role USING (true);

-- ============================================
-- 2. email_copilot_sent_replies - Contains sent email content
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS "email_copilot_sent_replies_service_role_select" ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS "email_copilot_sent_replies_service_role_insert" ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS "email_copilot_sent_replies_service_role_update" ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS "email_copilot_sent_replies_service_role_delete" ON public.email_copilot_sent_replies;

CREATE POLICY "email_copilot_sent_replies_service_role_select" ON public.email_copilot_sent_replies FOR SELECT TO service_role USING (true);
CREATE POLICY "email_copilot_sent_replies_service_role_insert" ON public.email_copilot_sent_replies FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "email_copilot_sent_replies_service_role_update" ON public.email_copilot_sent_replies FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "email_copilot_sent_replies_service_role_delete" ON public.email_copilot_sent_replies FOR DELETE TO service_role USING (true);

-- ============================================
-- 3. investment_reports - Contains sensitive financial reports
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.investment_reports;
DROP POLICY IF EXISTS "investment_reports_service_role_select" ON public.investment_reports;
DROP POLICY IF EXISTS "investment_reports_service_role_insert" ON public.investment_reports;
DROP POLICY IF EXISTS "investment_reports_service_role_update" ON public.investment_reports;
DROP POLICY IF EXISTS "investment_reports_service_role_delete" ON public.investment_reports;

CREATE POLICY "investment_reports_service_role_select" ON public.investment_reports FOR SELECT TO service_role USING (true);
CREATE POLICY "investment_reports_service_role_insert" ON public.investment_reports FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "investment_reports_service_role_update" ON public.investment_reports FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "investment_reports_service_role_delete" ON public.investment_reports FOR DELETE TO service_role USING (true);

-- ============================================
-- 4. report_versions - Contains report history
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_select" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_insert" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_update" ON public.report_versions;
DROP POLICY IF EXISTS "report_versions_service_role_delete" ON public.report_versions;

CREATE POLICY "report_versions_service_role_select" ON public.report_versions FOR SELECT TO service_role USING (true);
CREATE POLICY "report_versions_service_role_insert" ON public.report_versions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "report_versions_service_role_update" ON public.report_versions FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "report_versions_service_role_delete" ON public.report_versions FOR DELETE TO service_role USING (true);

-- ============================================
-- 5. report_qa_conversations - Contains QA conversations
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_select" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_insert" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_update" ON public.report_qa_conversations;
DROP POLICY IF EXISTS "report_qa_conversations_service_role_delete" ON public.report_qa_conversations;

CREATE POLICY "report_qa_conversations_service_role_select" ON public.report_qa_conversations FOR SELECT TO service_role USING (true);
CREATE POLICY "report_qa_conversations_service_role_insert" ON public.report_qa_conversations FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "report_qa_conversations_service_role_update" ON public.report_qa_conversations FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "report_qa_conversations_service_role_delete" ON public.report_qa_conversations FOR DELETE TO service_role USING (true);

-- ============================================
-- 6. generated_reports - Contains generated report data
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.generated_reports;
DROP POLICY IF EXISTS "generated_reports_service_role_select" ON public.generated_reports;
DROP POLICY IF EXISTS "generated_reports_service_role_insert" ON public.generated_reports;
DROP POLICY IF EXISTS "generated_reports_service_role_update" ON public.generated_reports;
DROP POLICY IF EXISTS "generated_reports_service_role_delete" ON public.generated_reports;

CREATE POLICY "generated_reports_service_role_select" ON public.generated_reports FOR SELECT TO service_role USING (true);
CREATE POLICY "generated_reports_service_role_insert" ON public.generated_reports FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "generated_reports_service_role_update" ON public.generated_reports FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "generated_reports_service_role_delete" ON public.generated_reports FOR DELETE TO service_role USING (true);

-- ============================================
-- 7. charts - Contains chart data linked to reports
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.charts;
DROP POLICY IF EXISTS "charts_service_role_select" ON public.charts;
DROP POLICY IF EXISTS "charts_service_role_insert" ON public.charts;
DROP POLICY IF EXISTS "charts_service_role_update" ON public.charts;
DROP POLICY IF EXISTS "charts_service_role_delete" ON public.charts;

CREATE POLICY "charts_service_role_select" ON public.charts FOR SELECT TO service_role USING (true);
CREATE POLICY "charts_service_role_insert" ON public.charts FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "charts_service_role_update" ON public.charts FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "charts_service_role_delete" ON public.charts FOR DELETE TO service_role USING (true);

-- ============================================
-- 8. chart_analysis - Contains chart analysis data
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.chart_analysis;
DROP POLICY IF EXISTS "chart_analysis_service_role_select" ON public.chart_analysis;
DROP POLICY IF EXISTS "chart_analysis_service_role_insert" ON public.chart_analysis;
DROP POLICY IF EXISTS "chart_analysis_service_role_update" ON public.chart_analysis;
DROP POLICY IF EXISTS "chart_analysis_service_role_delete" ON public.chart_analysis;

CREATE POLICY "chart_analysis_service_role_select" ON public.chart_analysis FOR SELECT TO service_role USING (true);
CREATE POLICY "chart_analysis_service_role_insert" ON public.chart_analysis FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "chart_analysis_service_role_update" ON public.chart_analysis FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "chart_analysis_service_role_delete" ON public.chart_analysis FOR DELETE TO service_role USING (true);

-- ============================================
-- 9. call_alert_history - Contains call alert records
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.call_alert_history;
DROP POLICY IF EXISTS "call_alert_history_service_role_select" ON public.call_alert_history;
DROP POLICY IF EXISTS "call_alert_history_service_role_insert" ON public.call_alert_history;
DROP POLICY IF EXISTS "call_alert_history_service_role_update" ON public.call_alert_history;
DROP POLICY IF EXISTS "call_alert_history_service_role_delete" ON public.call_alert_history;

CREATE POLICY "call_alert_history_service_role_select" ON public.call_alert_history FOR SELECT TO service_role USING (true);
CREATE POLICY "call_alert_history_service_role_insert" ON public.call_alert_history FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "call_alert_history_service_role_update" ON public.call_alert_history FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "call_alert_history_service_role_delete" ON public.call_alert_history FOR DELETE TO service_role USING (true);

-- ============================================
-- 10. call_alert_rules - Contains call alert configuration
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.call_alert_rules;
DROP POLICY IF EXISTS "call_alert_rules_service_role_select" ON public.call_alert_rules;
DROP POLICY IF EXISTS "call_alert_rules_service_role_insert" ON public.call_alert_rules;
DROP POLICY IF EXISTS "call_alert_rules_service_role_update" ON public.call_alert_rules;
DROP POLICY IF EXISTS "call_alert_rules_service_role_delete" ON public.call_alert_rules;

CREATE POLICY "call_alert_rules_service_role_select" ON public.call_alert_rules FOR SELECT TO service_role USING (true);
CREATE POLICY "call_alert_rules_service_role_insert" ON public.call_alert_rules FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "call_alert_rules_service_role_update" ON public.call_alert_rules FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "call_alert_rules_service_role_delete" ON public.call_alert_rules FOR DELETE TO service_role USING (true);

-- ============================================
-- 11. call_tags - Contains call tag definitions
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.call_tags;
DROP POLICY IF EXISTS "call_tags_service_role_select" ON public.call_tags;
DROP POLICY IF EXISTS "call_tags_service_role_insert" ON public.call_tags;
DROP POLICY IF EXISTS "call_tags_service_role_update" ON public.call_tags;
DROP POLICY IF EXISTS "call_tags_service_role_delete" ON public.call_tags;

CREATE POLICY "call_tags_service_role_select" ON public.call_tags FOR SELECT TO service_role USING (true);
CREATE POLICY "call_tags_service_role_insert" ON public.call_tags FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "call_tags_service_role_update" ON public.call_tags FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "call_tags_service_role_delete" ON public.call_tags FOR DELETE TO service_role USING (true);

-- ============================================
-- 12. document_chunks - Contains document embeddings
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_select" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_insert" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_update" ON public.document_chunks;
DROP POLICY IF EXISTS "document_chunks_service_role_delete" ON public.document_chunks;

CREATE POLICY "document_chunks_service_role_select" ON public.document_chunks FOR SELECT TO service_role USING (true);
CREATE POLICY "document_chunks_service_role_insert" ON public.document_chunks FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "document_chunks_service_role_update" ON public.document_chunks FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "document_chunks_service_role_delete" ON public.document_chunks FOR DELETE TO service_role USING (true);

-- ============================================
-- 13. cash_flow_analyses - Contains financial analysis data
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.cash_flow_analyses;
DROP POLICY IF EXISTS "cash_flow_analyses_service_role_select" ON public.cash_flow_analyses;
DROP POLICY IF EXISTS "cash_flow_analyses_service_role_insert" ON public.cash_flow_analyses;
DROP POLICY IF EXISTS "cash_flow_analyses_service_role_update" ON public.cash_flow_analyses;
DROP POLICY IF EXISTS "cash_flow_analyses_service_role_delete" ON public.cash_flow_analyses;

CREATE POLICY "cash_flow_analyses_service_role_select" ON public.cash_flow_analyses FOR SELECT TO service_role USING (true);
CREATE POLICY "cash_flow_analyses_service_role_insert" ON public.cash_flow_analyses FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "cash_flow_analyses_service_role_update" ON public.cash_flow_analyses FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "cash_flow_analyses_service_role_delete" ON public.cash_flow_analyses FOR DELETE TO service_role USING (true);

-- ============================================
-- 14. comparison_analysis_templates - Contains analysis templates
-- ============================================
DROP POLICY IF EXISTS "Allow all operations for now" ON public.comparison_analysis_templates;
DROP POLICY IF EXISTS "comparison_analysis_templates_service_role_select" ON public.comparison_analysis_templates;
DROP POLICY IF EXISTS "comparison_analysis_templates_service_role_insert" ON public.comparison_analysis_templates;
DROP POLICY IF EXISTS "comparison_analysis_templates_service_role_update" ON public.comparison_analysis_templates;
DROP POLICY IF EXISTS "comparison_analysis_templates_service_role_delete" ON public.comparison_analysis_templates;

CREATE POLICY "comparison_analysis_templates_service_role_select" ON public.comparison_analysis_templates FOR SELECT TO service_role USING (true);
CREATE POLICY "comparison_analysis_templates_service_role_insert" ON public.comparison_analysis_templates FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "comparison_analysis_templates_service_role_update" ON public.comparison_analysis_templates FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "comparison_analysis_templates_service_role_delete" ON public.comparison_analysis_templates FOR DELETE TO service_role USING (true);