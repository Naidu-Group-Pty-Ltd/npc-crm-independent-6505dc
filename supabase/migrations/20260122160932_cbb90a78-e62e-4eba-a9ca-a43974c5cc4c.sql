-- Complete RLS for clients table (policies may already exist, use IF NOT EXISTS pattern)
DROP POLICY IF EXISTS "Service role can select clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can update clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can delete clients" ON public.clients;

CREATE POLICY "Service role can select clients"
ON public.clients FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Service role can insert clients"
ON public.clients FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can update clients"
ON public.clients FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can delete clients"
ON public.clients FOR DELETE
TO service_role
USING (true);

-- Complete RLS for investment_reports table
DROP POLICY IF EXISTS "Service role can select investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Service role can insert investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Service role can update investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Service role can delete investment_reports" ON public.investment_reports;

CREATE POLICY "Service role can select investment_reports"
ON public.investment_reports FOR SELECT
TO service_role
USING (true);

CREATE POLICY "Service role can insert investment_reports"
ON public.investment_reports FOR INSERT
TO service_role
WITH CHECK (true);

CREATE POLICY "Service role can update investment_reports"
ON public.investment_reports FOR UPDATE
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can delete investment_reports"
ON public.investment_reports FOR DELETE
TO service_role
USING (true);