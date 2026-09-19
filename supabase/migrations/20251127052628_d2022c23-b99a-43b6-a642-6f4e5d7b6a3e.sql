
-- Fix: Allow public read access to generated_reports
-- The custom auth system doesn't use Supabase's built-in auth
-- so we need to allow anon access for reading reports

DROP POLICY IF EXISTS "All authenticated users can view all generated reports" ON generated_reports;

-- Allow anyone with the anon key to read generated reports
CREATE POLICY "Anyone can view generated reports"
ON generated_reports
FOR SELECT
TO anon, authenticated
USING (true);
