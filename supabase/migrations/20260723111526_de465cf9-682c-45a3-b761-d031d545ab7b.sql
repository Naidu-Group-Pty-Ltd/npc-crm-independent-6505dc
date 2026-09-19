-- WP-06 Phase B — backfill storage_object_bindings from authoritative parent
-- tables so existing objects become authorizable without relying on the
-- legacy per-bucket module fallback.

INSERT INTO public.storage_object_bindings (bucket, object_path, resource_type, resource_id, client_id, owner_user_id, sensitivity, created_by)
SELECT 'client-files' AS bucket,
       cf.file_path AS object_path,
       CASE WHEN cf.is_vownet_form THEN 'vownet_form' ELSE 'client_file' END AS resource_type,
       cf.id AS resource_id,
       cf.client_id,
       cf.uploaded_by AS owner_user_id,
       'sensitive'::text AS sensitivity,
       cf.uploaded_by AS created_by
FROM public.client_files cf
WHERE cf.file_path IS NOT NULL AND cf.file_path <> ''
ON CONFLICT (bucket, object_path) DO NOTHING;

INSERT INTO public.storage_object_bindings (bucket, object_path, resource_type, resource_id, client_id, owner_user_id, sensitivity, created_by)
SELECT 'client-documents' AS bucket,
       fpd.storage_path AS object_path,
       'finance_portal_document' AS resource_type,
       fpd.id AS resource_id,
       fpd.client_id,
       NULL::uuid AS owner_user_id,
       'sensitive'::text AS sensitivity,
       NULL::uuid AS created_by
FROM public.finance_portal_documents fpd
WHERE fpd.storage_path IS NOT NULL AND fpd.storage_path <> ''
ON CONFLICT (bucket, object_path) DO NOTHING;

INSERT INTO public.storage_object_bindings (bucket, object_path, resource_type, resource_id, client_id, owner_user_id, sensitivity, created_by)
SELECT ej.storage_bucket AS bucket,
       ej.storage_path AS object_path,
       'export_job' AS resource_type,
       ej.id AS resource_id,
       NULL::uuid AS client_id,
       ej.created_by AS owner_user_id,
       'sensitive'::text AS sensitivity,
       ej.created_by AS created_by
FROM public.export_jobs ej
WHERE ej.storage_path IS NOT NULL AND ej.storage_path <> ''
  AND ej.storage_bucket IN ('qa_exports','client-files','client-documents','vownet-forms','investment-reports','quantitative-reports','email-attachments')
ON CONFLICT (bucket, object_path) DO NOTHING;

INSERT INTO public.storage_object_bindings (bucket, object_path, resource_type, resource_id, client_id, owner_user_id, sensitivity, created_by)
SELECT afu.storage_bucket AS bucket,
       afu.storage_path  AS object_path,
       'agent_file_upload' AS resource_type,
       afu.id AS resource_id,
       NULL::uuid AS client_id,
       afu.user_id AS owner_user_id,
       COALESCE(
         (SELECT NULLIF(NULL,'')),
         'sensitive'
       )::text AS sensitivity,
       afu.user_id AS created_by
FROM public.agent_file_uploads afu
WHERE afu.storage_path IS NOT NULL AND afu.storage_path <> ''
  AND afu.storage_bucket IN ('client-files','client-documents','vownet-forms','investment-reports','quantitative-reports','qa_exports','email-attachments')
ON CONFLICT (bucket, object_path) DO NOTHING;

-- Extract email attachments (jsonb array) → binding rows so legacy signed URLs
-- become authorizable. Each attachment carries { storagePath, storageBucket }.
INSERT INTO public.storage_object_bindings (bucket, object_path, resource_type, resource_id, client_id, owner_user_id, sensitivity, created_by)
SELECT (att->>'storageBucket') AS bucket,
       (att->>'storagePath')   AS object_path,
       'email_attachment'      AS resource_type,
       e.id                    AS resource_id,
       e.client_id,
       COALESCE(e.owner_user_id, e.created_by) AS owner_user_id,
       'restricted'::text      AS sensitivity,
       e.created_by            AS created_by
FROM public.email_copilot_emails e
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.attachments, '[]'::jsonb)) AS att
WHERE (att->>'storageBucket') = 'email-attachments'
  AND (att->>'storagePath') IS NOT NULL
  AND (att->>'storagePath') <> ''
ON CONFLICT (bucket, object_path) DO NOTHING;

-- Helpful lookup indexes for Phase B list authorization (prefix lookups by
-- (client_id, bucket) and (owner_user_id, bucket)).
CREATE INDEX IF NOT EXISTS storage_object_bindings_client_bucket_idx
  ON public.storage_object_bindings (client_id, bucket)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS storage_object_bindings_owner_bucket_idx
  ON public.storage_object_bindings (owner_user_id, bucket)
  WHERE owner_user_id IS NOT NULL;