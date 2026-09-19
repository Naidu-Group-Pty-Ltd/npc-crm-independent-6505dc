-- Create RLS policies for agency-agreements bucket
-- Allow authenticated users to read their agreements via signed URLs
CREATE POLICY "Allow authenticated users to read agreements"
ON storage.objects FOR SELECT
USING (bucket_id = 'agency-agreements');

-- Allow service role to upload (edge functions use service role)
CREATE POLICY "Allow service uploads to agreements"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'agency-agreements');

-- Allow updates (for upsert)
CREATE POLICY "Allow service updates to agreements"
ON storage.objects FOR UPDATE
USING (bucket_id = 'agency-agreements');