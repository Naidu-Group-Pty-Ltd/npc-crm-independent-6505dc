-- ================================================
-- SECURITY FIX: Lock down investment_reports table
-- Remove public access policies, keep service_role only
-- ================================================

-- Drop overly permissive public policies
DROP POLICY IF EXISTS "Allow all to view investment reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Allow all to create investment reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Allow all to update investment reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Allow all to delete investment reports" ON public.investment_reports;

-- Drop redundant service role policies (we'll consolidate to clean set)
DROP POLICY IF EXISTS "Service role can read investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Service role can select investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Service role can insert investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Service role can update investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Service role can delete investment_reports" ON public.investment_reports;

-- Create clean service_role only policies for investment_reports
CREATE POLICY "investment_reports_service_role_select" 
ON public.investment_reports FOR SELECT 
TO service_role
USING (true);

CREATE POLICY "investment_reports_service_role_insert" 
ON public.investment_reports FOR INSERT 
TO service_role
WITH CHECK (true);

CREATE POLICY "investment_reports_service_role_update" 
ON public.investment_reports FOR UPDATE 
TO service_role
USING (true) 
WITH CHECK (true);

CREATE POLICY "investment_reports_service_role_delete" 
ON public.investment_reports FOR DELETE 
TO service_role
USING (true);