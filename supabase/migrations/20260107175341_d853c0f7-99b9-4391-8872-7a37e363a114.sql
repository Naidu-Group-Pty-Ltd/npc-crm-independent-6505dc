-- Create storage bucket for client Vownet documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('client-documents', 'client-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files to client-documents bucket
CREATE POLICY "Authenticated users can upload client documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to view client documents
CREATE POLICY "Authenticated users can view client documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update their uploads
CREATE POLICY "Authenticated users can update client documents"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete client documents
CREATE POLICY "Authenticated users can delete client documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

-- Add document_type column to client_files to distinguish Vownet forms
ALTER TABLE public.client_files 
ADD COLUMN IF NOT EXISTS document_type TEXT DEFAULT 'general';

-- Add is_vownet_form flag for quick filtering
ALTER TABLE public.client_files 
ADD COLUMN IF NOT EXISTS is_vownet_form BOOLEAN DEFAULT false;