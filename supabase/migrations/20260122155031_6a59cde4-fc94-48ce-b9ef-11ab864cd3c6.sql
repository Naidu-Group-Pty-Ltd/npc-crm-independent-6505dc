-- =====================================================
-- SECURITY REMEDIATION: Restrict Client Data Tables to Service Role Only
-- This migration removes overly permissive "USING (true)" policies
-- and restricts all access to service_role (Edge Functions)
-- =====================================================

-- 1. CLIENT_EMPLOYMENT TABLE
-- Drop existing permissive policies
DROP POLICY IF EXISTS "Allow all access to client_employment" ON public.client_employment;
DROP POLICY IF EXISTS "Allow authenticated access to client_employment" ON public.client_employment;
DROP POLICY IF EXISTS "service_role_all_client_employment" ON public.client_employment;

-- Create service_role only policies
CREATE POLICY "service_role_select_client_employment" ON public.client_employment
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_employment" ON public.client_employment
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_employment" ON public.client_employment
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_employment" ON public.client_employment
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 2. CLIENT_INCOME TABLE
DROP POLICY IF EXISTS "Allow all access to client_income" ON public.client_income;
DROP POLICY IF EXISTS "Allow authenticated access to client_income" ON public.client_income;
DROP POLICY IF EXISTS "service_role_all_client_income" ON public.client_income;

CREATE POLICY "service_role_select_client_income" ON public.client_income
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_income" ON public.client_income
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_income" ON public.client_income
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_income" ON public.client_income
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 3. CLIENT_ASSETS TABLE
DROP POLICY IF EXISTS "Allow all access to client_assets" ON public.client_assets;
DROP POLICY IF EXISTS "Allow authenticated access to client_assets" ON public.client_assets;
DROP POLICY IF EXISTS "service_role_all_client_assets" ON public.client_assets;

CREATE POLICY "service_role_select_client_assets" ON public.client_assets
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_assets" ON public.client_assets
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_assets" ON public.client_assets
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_assets" ON public.client_assets
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 4. CLIENT_LIABILITIES TABLE
DROP POLICY IF EXISTS "Allow all access to client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "Allow authenticated access to client_liabilities" ON public.client_liabilities;
DROP POLICY IF EXISTS "service_role_all_client_liabilities" ON public.client_liabilities;

CREATE POLICY "service_role_select_client_liabilities" ON public.client_liabilities
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_liabilities" ON public.client_liabilities
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_liabilities" ON public.client_liabilities
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_liabilities" ON public.client_liabilities
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 5. CLIENT_EXPENSES TABLE
DROP POLICY IF EXISTS "Allow all access to client_expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "Allow authenticated access to client_expenses" ON public.client_expenses;
DROP POLICY IF EXISTS "service_role_all_client_expenses" ON public.client_expenses;

CREATE POLICY "service_role_select_client_expenses" ON public.client_expenses
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_expenses" ON public.client_expenses
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_expenses" ON public.client_expenses
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_expenses" ON public.client_expenses
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 6. CLIENT_NOTES TABLE
DROP POLICY IF EXISTS "Allow all access to client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Allow authenticated access to client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "service_role_all_client_notes" ON public.client_notes;

CREATE POLICY "service_role_select_client_notes" ON public.client_notes
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_notes" ON public.client_notes
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_notes" ON public.client_notes
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_notes" ON public.client_notes
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 7. CLIENT_REMINDERS TABLE
DROP POLICY IF EXISTS "Allow all access to client_reminders" ON public.client_reminders;
DROP POLICY IF EXISTS "Allow authenticated access to client_reminders" ON public.client_reminders;
DROP POLICY IF EXISTS "service_role_all_client_reminders" ON public.client_reminders;

CREATE POLICY "service_role_select_client_reminders" ON public.client_reminders
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_reminders" ON public.client_reminders
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_reminders" ON public.client_reminders
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_reminders" ON public.client_reminders
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 8. CLIENT_SCORES TABLE
DROP POLICY IF EXISTS "Allow all access to client_scores" ON public.client_scores;
DROP POLICY IF EXISTS "Allow authenticated access to client_scores" ON public.client_scores;
DROP POLICY IF EXISTS "service_role_all_client_scores" ON public.client_scores;

CREATE POLICY "service_role_select_client_scores" ON public.client_scores
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_scores" ON public.client_scores
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_scores" ON public.client_scores
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_scores" ON public.client_scores
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 9. BORROWING_CAPACITY_ASSESSMENTS TABLE
DROP POLICY IF EXISTS "Allow all access to borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "Allow authenticated access to borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "service_role_all_borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;

CREATE POLICY "service_role_select_borrowing_capacity_assessments" ON public.borrowing_capacity_assessments
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_borrowing_capacity_assessments" ON public.borrowing_capacity_assessments
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_borrowing_capacity_assessments" ON public.borrowing_capacity_assessments
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_borrowing_capacity_assessments" ON public.borrowing_capacity_assessments
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 10. PORTFOLIO_REVIEWS TABLE
DROP POLICY IF EXISTS "Allow all access to portfolio_reviews" ON public.portfolio_reviews;
DROP POLICY IF EXISTS "Allow authenticated access to portfolio_reviews" ON public.portfolio_reviews;
DROP POLICY IF EXISTS "service_role_all_portfolio_reviews" ON public.portfolio_reviews;

CREATE POLICY "service_role_select_portfolio_reviews" ON public.portfolio_reviews
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_portfolio_reviews" ON public.portfolio_reviews
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_portfolio_reviews" ON public.portfolio_reviews
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_portfolio_reviews" ON public.portfolio_reviews
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 11. PORTFOLIO_ANALYSIS_REPORTS TABLE
DROP POLICY IF EXISTS "Allow all access to portfolio_analysis_reports" ON public.portfolio_analysis_reports;
DROP POLICY IF EXISTS "Allow authenticated access to portfolio_analysis_reports" ON public.portfolio_analysis_reports;
DROP POLICY IF EXISTS "service_role_all_portfolio_analysis_reports" ON public.portfolio_analysis_reports;

CREATE POLICY "service_role_select_portfolio_analysis_reports" ON public.portfolio_analysis_reports
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_portfolio_analysis_reports" ON public.portfolio_analysis_reports
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_portfolio_analysis_reports" ON public.portfolio_analysis_reports
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_portfolio_analysis_reports" ON public.portfolio_analysis_reports
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- 12. CASH_FLOW_ANALYSES TABLE
DROP POLICY IF EXISTS "Allow all access to cash_flow_analyses" ON public.cash_flow_analyses;
DROP POLICY IF EXISTS "Allow authenticated access to cash_flow_analyses" ON public.cash_flow_analyses;
DROP POLICY IF EXISTS "service_role_all_cash_flow_analyses" ON public.cash_flow_analyses;

CREATE POLICY "service_role_select_cash_flow_analyses" ON public.cash_flow_analyses
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_cash_flow_analyses" ON public.cash_flow_analyses
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_cash_flow_analyses" ON public.cash_flow_analyses
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_cash_flow_analyses" ON public.cash_flow_analyses
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);