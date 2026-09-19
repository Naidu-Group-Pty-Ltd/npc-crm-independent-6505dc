
-- Fix RLS policies for bulk generation tables to work with custom auth
-- Allow all authenticated requests to read bulk generation jobs and items
-- (The service role still controls creation via edge functions)

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can view their own bulk jobs" ON bulk_generation_jobs;
DROP POLICY IF EXISTS "Users can update their own bulk jobs" ON bulk_generation_jobs;
DROP POLICY IF EXISTS "Users can create their own bulk jobs" ON bulk_generation_jobs;
DROP POLICY IF EXISTS "Users can view items from their own jobs" ON bulk_generation_items;
DROP POLICY IF EXISTS "Users can create items for their own jobs" ON bulk_generation_items;

-- Add permissive read policies for frontend access
CREATE POLICY "Allow authenticated users to view bulk jobs"
ON bulk_generation_jobs
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Allow authenticated users to view bulk items"
ON bulk_generation_items
FOR SELECT
TO authenticated
USING (true);

-- Keep service role policies for full management
-- (These already exist and allow the edge functions to work)

-- Add comment for clarity
COMMENT ON TABLE bulk_generation_jobs IS 'Bulk report generation jobs. RLS allows read access to all authenticated users. Write access only via service role (edge functions).';
COMMENT ON TABLE bulk_generation_items IS 'Individual items in bulk generation jobs. RLS allows read access to all authenticated users. Write access only via service role (edge functions).';
