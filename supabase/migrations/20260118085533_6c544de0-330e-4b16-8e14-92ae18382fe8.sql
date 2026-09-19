-- Ensure vownet-forms storage policies apply to any role (incl. custom-auth sessions)
DROP POLICY IF EXISTS "vownet_forms_allow_all_insert" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_allow_all_select" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_allow_all_update" ON storage.objects;
DROP POLICY IF EXISTS "vownet_forms_allow_all_delete" ON storage.objects;

CREATE POLICY "vownet_forms_public_insert"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_public_select"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_public_update"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'vownet-forms');

CREATE POLICY "vownet_forms_public_delete"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'vownet-forms');
