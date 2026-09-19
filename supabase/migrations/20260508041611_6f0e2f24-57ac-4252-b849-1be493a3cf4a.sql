-- Make lead-magnets bucket public so PDFs download directly via permanent URL
UPDATE storage.buckets SET public = true WHERE id = 'lead-magnets';

-- Allow anyone to read files in this bucket (PDFs are intentionally public)
DROP POLICY IF EXISTS "Public read lead magnets" ON storage.objects;
CREATE POLICY "Public read lead magnets"
ON storage.objects FOR SELECT
USING (bucket_id = 'lead-magnets');