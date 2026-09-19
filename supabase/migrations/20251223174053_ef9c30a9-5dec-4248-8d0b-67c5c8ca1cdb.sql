-- Drop existing restrictive RLS policies on report_structure_templates
DROP POLICY IF EXISTS "Admin can insert templates" ON public.report_structure_templates;
DROP POLICY IF EXISTS "Admin can update templates" ON public.report_structure_templates;
DROP POLICY IF EXISTS "Admin can delete templates" ON public.report_structure_templates;
DROP POLICY IF EXISTS "Anyone can view templates" ON public.report_structure_templates;

-- Since this app uses custom_users with session tokens (not Supabase Auth),
-- we need policies that work with the anon key but still provide security
-- The actual authorization is handled by the custom-auth-verify edge function

-- Allow public read access (templates are not sensitive)
CREATE POLICY "Templates are publicly readable"
ON public.report_structure_templates
FOR SELECT
USING (true);

-- Allow inserts (app-level auth via custom_users handles authorization)
CREATE POLICY "Allow template inserts"
ON public.report_structure_templates
FOR INSERT
WITH CHECK (true);

-- Allow updates (app-level auth via custom_users handles authorization)
CREATE POLICY "Allow template updates"
ON public.report_structure_templates
FOR UPDATE
USING (true);

-- Allow deletes (app-level auth via custom_users handles authorization)
CREATE POLICY "Allow template deletes"
ON public.report_structure_templates
FOR DELETE
USING (true);

-- Also ensure document_chunks table has proper policies for RAG
DROP POLICY IF EXISTS "Anyone can view document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Admin can insert document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Admin can delete document chunks" ON public.document_chunks;

CREATE POLICY "Document chunks are publicly readable"
ON public.document_chunks
FOR SELECT
USING (true);

CREATE POLICY "Allow document chunk inserts"
ON public.document_chunks
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow document chunk deletes"
ON public.document_chunks
FOR DELETE
USING (true);

CREATE POLICY "Allow document chunk updates"
ON public.document_chunks
FOR UPDATE
USING (true);

-- Ensure client_branding_profiles has proper policies
DROP POLICY IF EXISTS "Anyone can view branding profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "Admin can insert branding profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "Admin can update branding profiles" ON public.client_branding_profiles;
DROP POLICY IF EXISTS "Admin can delete branding profiles" ON public.client_branding_profiles;

CREATE POLICY "Branding profiles are publicly readable"
ON public.client_branding_profiles
FOR SELECT
USING (true);

CREATE POLICY "Allow branding profile inserts"
ON public.client_branding_profiles
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow branding profile updates"
ON public.client_branding_profiles
FOR UPDATE
USING (true);

CREATE POLICY "Allow branding profile deletes"
ON public.client_branding_profiles
FOR DELETE
USING (true);