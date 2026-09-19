-- Drop and recreate policies for client-documents bucket with unique names
DROP POLICY IF EXISTS "Authenticated users can upload client documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view client documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update client documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete client documents" ON storage.objects;

CREATE POLICY "client_documents_insert_policy"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "client_documents_select_policy"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "client_documents_update_policy"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "client_documents_delete_policy"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'client-documents' 
  AND auth.role() = 'authenticated'
);

-- Create RLS policies for vownet-forms bucket with unique names
DROP POLICY IF EXISTS "Authenticated users can upload vownet forms" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view vownet forms" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update vownet forms" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete vownet forms" ON storage.objects;

CREATE POLICY "vownet_forms_insert_policy"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'vownet-forms' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "vownet_forms_select_policy"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'vownet-forms' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "vownet_forms_update_policy"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'vownet-forms' 
  AND auth.role() = 'authenticated'
);

CREATE POLICY "vownet_forms_delete_policy"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'vownet-forms' 
  AND auth.role() = 'authenticated'
);