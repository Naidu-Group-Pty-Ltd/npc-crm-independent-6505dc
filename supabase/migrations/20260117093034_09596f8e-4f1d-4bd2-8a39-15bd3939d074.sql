-- Drop existing restrictive policies for vownet-forms
DROP POLICY IF EXISTS "vownet_forms_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_update_policy" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_delete_policy" ON storage.objects;

-- Create permissive policies for vownet-forms bucket
CREATE POLICY "vownet_forms_select_policy" ON storage.objects
FOR SELECT USING (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_insert_policy" ON storage.objects
FOR INSERT WITH CHECK (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_update_policy" ON storage.objects
FOR UPDATE USING (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_delete_policy" ON storage.objects
FOR DELETE USING (bucket_id = 'vownet-forms');