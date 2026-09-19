ALTER TABLE public.client_files RENAME COLUMN is_vownet_form TO is_formara_form;

CREATE POLICY service_role_select_formara_forms ON storage.objects FOR SELECT
USING (bucket_id = 'formara-forms' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');

CREATE POLICY service_role_insert_formara_forms ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'formara-forms' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');

CREATE POLICY service_role_update_formara_forms ON storage.objects FOR UPDATE
USING (bucket_id = 'formara-forms' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');

CREATE POLICY service_role_delete_formara_forms ON storage.objects FOR DELETE
USING (bucket_id = 'formara-forms' AND ((current_setting('request.jwt.claims', true))::json ->> 'role') = 'service_role');