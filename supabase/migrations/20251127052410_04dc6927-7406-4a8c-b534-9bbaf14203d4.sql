
-- Fix: Allow public read access to bulk generation tables
-- The custom auth system doesn't integrate with Supabase auth
-- so we need to allow public (anon) access for reading progress

DROP POLICY IF EXISTS "Allow authenticated users to view bulk jobs" ON bulk_generation_jobs;
DROP POLICY IF EXISTS "Allow authenticated users to view bulk items" ON bulk_generation_items;

-- Allow anyone with the anon key to read bulk generation jobs and items
-- Security is maintained because only the service role can create/update
CREATE POLICY "Anyone can view bulk generation jobs"
ON bulk_generation_jobs
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Anyone can view bulk generation items"
ON bulk_generation_items  
FOR SELECT
TO anon, authenticated
USING (true);
