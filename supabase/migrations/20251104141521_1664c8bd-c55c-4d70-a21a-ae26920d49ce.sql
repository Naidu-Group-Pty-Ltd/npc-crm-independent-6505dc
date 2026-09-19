-- Drop the existing restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view their own investment reports" ON public.investment_reports;

-- Create new policy allowing all authenticated users to view all investment reports
CREATE POLICY "All authenticated users can view all investment reports"
ON public.investment_reports
FOR SELECT
TO authenticated
USING (true);

-- Also update the generated_reports table to allow viewing all reports
DROP POLICY IF EXISTS "Users can view their own generated reports" ON public.generated_reports;

CREATE POLICY "All authenticated users can view all generated reports"
ON public.generated_reports
FOR SELECT
TO authenticated
USING (true);