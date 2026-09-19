-- Drop existing vownet-forms policies and recreate with explicit TRUE conditions
DROP POLICY IF EXISTS "vownet_forms_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_update_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_delete_policy" ON storage.objects;

-- Create permissive policies for vownet-forms bucket
CREATE POLICY "vownet_forms_allow_all_insert"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_allow_all_select"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_allow_all_update"
ON storage.objects FOR UPDATE
TO anon, authenticated
USING (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_allow_all_delete"
ON storage.objects FOR DELETE
TO anon, authenticated
USING (bucket_id = 'vownet-forms');