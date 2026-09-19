-- Create the client-files storage bucket for portfolio reports
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-files', 'client-files', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for the client-files bucket
-- Allow public read access for viewing/downloading reports
CREATE POLICY "Public read access for client-files"
ON storage.objects FOR SELECT
USING (bucket_id = 'client-files');

-- Allow authenticated users to upload files
CREATE POLICY "Allow uploads to client-files"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'client-files');

-- Allow authenticated users to update/replace files
CREATE POLICY "Allow updates to client-files"
ON storage.objects FOR UPDATE
USING (bucket_id = 'client-files');

-- Allow authenticated users to delete files
CREATE POLICY "Allow deletes from client-files"
ON storage.objects FOR DELETE
USING (bucket_id = 'client-files');