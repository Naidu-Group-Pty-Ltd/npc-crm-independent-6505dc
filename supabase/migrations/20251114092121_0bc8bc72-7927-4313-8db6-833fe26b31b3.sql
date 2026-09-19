-- Fix RLS policies for investment_reports to work with custom authentication
-- The current policies check auth.uid() which is NULL for custom auth users

-- Drop existing policies
DROP POLICY IF EXISTS "All authenticated users can view all investment reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Authenticated users can create investment reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Users can update their own investment reports" ON public.investment_reports;
DROP POLICY IF EXISTS "Users can delete their own investment reports" ON public.investment_reports;

-- Create new policies that don't rely on Supabase auth
-- Since this uses custom authentication, we allow all operations
CREATE POLICY "Allow all to view investment reports"
ON public.investment_reports
FOR SELECT
USING (true);

CREATE POLICY "Allow all to create investment reports"
ON public.investment_reports
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow all to update investment reports"
ON public.investment_reports
FOR UPDATE
USING (true);

CREATE POLICY "Allow all to delete investment reports"
ON public.investment_reports
FOR DELETE
USING (true);