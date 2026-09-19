-- Create storage bucket for Vownet PDF forms
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('vownet-forms', 'vownet-forms', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for vownet-forms bucket
-- Allow authenticated users to upload files
CREATE POLICY "Authenticated users can upload vownet forms"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'vownet-forms');

-- Allow authenticated users to view vownet forms
CREATE POLICY "Authenticated users can view vownet forms"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'vownet-forms');

-- Allow authenticated users to delete their own uploads
CREATE POLICY "Authenticated users can delete vownet forms"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'vownet-forms');

-- Allow authenticated users to update vownet forms
CREATE POLICY "Authenticated users can update vownet forms"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'vownet-forms');

-- Add report_type column to client_files for categorization
ALTER TABLE public.client_files 
ADD COLUMN IF NOT EXISTS report_type TEXT;

-- Add index for faster lookups by report_type
CREATE INDEX IF NOT EXISTS idx_client_files_report_type 
ON public.client_files(report_type);