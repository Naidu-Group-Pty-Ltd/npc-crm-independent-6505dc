-- Fix storage.objects RLS policies to work with custom authentication
-- The current policies check auth.role() which doesn't work for custom auth users

-- Drop existing policies for investment-reports bucket
DROP POLICY IF EXISTS "Authenticated users can upload investment reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their own reports" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their own reports" ON storage.objects;

-- Create new policies that don't rely on Supabase auth
CREATE POLICY "Anyone can upload to investment-reports"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'investment-reports');

CREATE POLICY "Anyone can update investment-reports"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'investment-reports');

CREATE POLICY "Anyone can delete from investment-reports"
ON storage.objects
FOR DELETE
USING (bucket_id = 'investment-reports');