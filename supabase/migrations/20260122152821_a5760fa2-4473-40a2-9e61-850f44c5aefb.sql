-- ============================================================
-- SECURE STORAGE BUCKETS: Restrict all operations to service_role
-- ============================================================
-- This migration removes all permissive public policies and replaces them
-- with service_role-only policies. Frontend access will be mediated through
-- Edge Functions that validate session tokens.

-- ============================================================
-- DROP ALL EXISTING STORAGE POLICIES
-- ============================================================

-- client-files bucket policies
DROP POLICY IF EXISTS "Allow deletes from client-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow updates to client-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow uploads to client-files" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for client-files" ON storage.objects;

-- investment-reports bucket policies
DROP POLICY IF EXISTS "Anyone can delete from investment-reports" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update investment-reports" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload to investment-reports" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view investment reports" ON storage.objects;

-- qa_exports bucket policies
DROP POLICY IF EXISTS "Anyone can read qa_exports" ON storage.objects;
DROP POLICY IF EXISTS "Service role can delete from qa_exports" ON storage.objects;
DROP POLICY IF EXISTS "Service role can update qa_exports" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload to qa_exports" ON storage.objects;

-- email-attachments bucket policies
DROP POLICY IF EXISTS "Anyone can view email attachments" ON storage.objects;
DROP POLICY IF EXISTS "Service role can delete email attachments" ON storage.objects;
DROP POLICY IF EXISTS "Service role can upload email attachments" ON storage.objects;

-- report-templates bucket policies
DROP POLICY IF EXISTS "Anyone can view template files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete template files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update template files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload template files" ON storage.objects;

-- branding-assets bucket policies
DROP POLICY IF EXISTS "Public read access for branding assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete branding assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update branding assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload branding assets" ON storage.objects;

-- client-documents bucket policies
DROP POLICY IF EXISTS "client_documents_delete_policy" ON storage.objects;
DROP POLICY IF EXISTS "client_documents_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "client_documents_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "client_documents_update_policy" ON storage.objects;

-- vownet-forms bucket policies
DROP POLICY IF EXISTS "vownet_forms_delete_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_update_policy" ON storage.objects;

-- ============================================================
-- CREATE SERVICE-ROLE-ONLY POLICIES FOR ALL BUCKETS
-- ============================================================
-- All storage operations now require service_role, which means
-- they must go through Edge Functions with proper authentication

-- client-files: Private client documents and reports
CREATE POLICY "service_role_select_client_files" ON storage.objects
FOR SELECT USING (
  bucket_id = 'client-files' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_files" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'client-files' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_files" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'client-files' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_files" ON storage.objects
FOR DELETE USING (
  bucket_id = 'client-files' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- investment-reports: Property investment analysis PDFs
CREATE POLICY "service_role_select_investment_reports" ON storage.objects
FOR SELECT USING (
  bucket_id = 'investment-reports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_investment_reports" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'investment-reports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_investment_reports" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'investment-reports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_investment_reports" ON storage.objects
FOR DELETE USING (
  bucket_id = 'investment-reports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- qa_exports: Q&A export PDFs
CREATE POLICY "service_role_select_qa_exports" ON storage.objects
FOR SELECT USING (
  bucket_id = 'qa_exports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_qa_exports" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'qa_exports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_qa_exports" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'qa_exports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_qa_exports" ON storage.objects
FOR DELETE USING (
  bucket_id = 'qa_exports' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- email-attachments: Email attachment storage
CREATE POLICY "service_role_select_email_attachments" ON storage.objects
FOR SELECT USING (
  bucket_id = 'email-attachments' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_email_attachments" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'email-attachments' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_email_attachments" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'email-attachments' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_email_attachments" ON storage.objects
FOR DELETE USING (
  bucket_id = 'email-attachments' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- report-templates: Report templates and branding
CREATE POLICY "service_role_select_report_templates" ON storage.objects
FOR SELECT USING (
  bucket_id = 'report-templates' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_report_templates" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'report-templates' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_report_templates" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'report-templates' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_report_templates" ON storage.objects
FOR DELETE USING (
  bucket_id = 'report-templates' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- branding-assets: White-label branding assets (needs public READ for display)
-- SELECT remains public for displaying logos, but write operations require service_role
CREATE POLICY "public_read_branding_assets" ON storage.objects
FOR SELECT USING (bucket_id = 'branding-assets');

CREATE POLICY "service_role_insert_branding_assets" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'branding-assets' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_branding_assets" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'branding-assets' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_branding_assets" ON storage.objects
FOR DELETE USING (
  bucket_id = 'branding-assets' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- client-documents: Client documentation (private bucket)
CREATE POLICY "service_role_select_client_documents" ON storage.objects
FOR SELECT USING (
  bucket_id = 'client-documents' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_client_documents" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'client-documents' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_client_documents" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'client-documents' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_client_documents" ON storage.objects
FOR DELETE USING (
  bucket_id = 'client-documents' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- vownet-forms: VowNet form uploads (private bucket)
CREATE POLICY "service_role_select_vownet_forms" ON storage.objects
FOR SELECT USING (
  bucket_id = 'vownet-forms' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_vownet_forms" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'vownet-forms' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_vownet_forms" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'vownet-forms' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_vownet_forms" ON storage.objects
FOR DELETE USING (
  bucket_id = 'vownet-forms' 
  AND (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);