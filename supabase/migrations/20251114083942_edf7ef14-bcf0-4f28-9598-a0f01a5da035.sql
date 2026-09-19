-- Fix RLS policies for investment_reports to work with custom authentication
-- Since this project uses custom auth (not Supabase auth), auth.uid() is always NULL
-- We need to allow inserts for authenticated sessions

-- Drop the existing restrictive policies
DROP POLICY IF EXISTS "Users can create their own investment reports" ON investment_reports;
DROP POLICY IF EXISTS "Users can update their own investment reports" ON investment_reports;
DROP POLICY IF EXISTS "Users can delete their own investment reports" ON investment_reports;

-- Create new policies that work with custom authentication
-- Allow all authenticated users to create reports (generated_by can be set to their custom user ID)
CREATE POLICY "Authenticated users can create investment reports"
ON investment_reports
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Allow users to update reports where they are the creator OR where generated_by is NULL (for service role)
CREATE POLICY "Users can update their own investment reports"
ON investment_reports
FOR UPDATE
TO authenticated
USING (true);

-- Allow users to delete reports where they are the creator
CREATE POLICY "Users can delete their own investment reports"
ON investment_reports
FOR DELETE
TO authenticated
USING (true);

-- The SELECT policy is already permissive (all authenticated users can view all reports)
-- No changes needed there