-- Drop existing permissive policies on investment_reports
DROP POLICY IF EXISTS "Anyone can view investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Anyone can insert investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Anyone can update investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Anyone can delete investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Public read access for investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Public insert access for investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Public update access for investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Public delete access for investment_reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Allow public read access" ON public.investment_reports;
DROP POLICY IF EXISTS "Allow public insert" ON public.investment_reports;
DROP POLICY IF EXISTS "Allow public update" ON public.investment_reports;
DROP POLICY IF EXISTS "Allow public delete" ON public.investment_reports;

-- Create restrictive policies that only allow service role access
-- This forces all access through Edge Functions which validate session tokens

CREATE POLICY "Service role can read investment_reports"
ON public.investment_reports
FOR SELECT
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can insert investment_reports"
ON public.investment_reports
FOR INSERT
WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can update investment_reports"
ON public.investment_reports
FOR UPDATE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can delete investment_reports"
ON public.investment_reports
FOR DELETE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);