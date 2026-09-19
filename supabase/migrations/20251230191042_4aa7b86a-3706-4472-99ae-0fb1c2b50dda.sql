-- Create storage bucket for QA PDF exports
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('qa_exports', 'qa_exports', true, 52428800, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- RLS policies for qa_exports bucket
CREATE POLICY "Anyone can read qa_exports"
ON storage.objects
FOR SELECT
USING (bucket_id = 'qa_exports');

CREATE POLICY "Service role can upload to qa_exports"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'qa_exports');

CREATE POLICY "Service role can update qa_exports"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'qa_exports');

CREATE POLICY "Service role can delete from qa_exports"
ON storage.objects
FOR DELETE
USING (bucket_id = 'qa_exports');

-- Add attachments column to report_qa_messages table
ALTER TABLE report_qa_messages 
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;