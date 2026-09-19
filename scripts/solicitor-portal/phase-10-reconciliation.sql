-- Read-only Client Legal Workspace projection/backfill report.
SELECT 'projected_cases' metric,count(*) value FROM public.client_case_read_model
UNION ALL SELECT 'projected_cases_without_matter',count(*) FROM public.client_case_read_model WHERE legal_matter_id IS NULL
UNION ALL SELECT 'projection_client_mismatch',count(*) FROM public.client_case_read_model p JOIN public.transaction_cases tc ON tc.id=p.case_id WHERE p.client_id IS DISTINCT FROM tc.client_id
UNION ALL SELECT 'projection_matter_link_drift',count(*) FROM public.client_case_read_model p JOIN public.transaction_case_links l ON l.case_id=p.case_id WHERE p.legal_matter_id IS DISTINCT FROM l.legal_matter_id
UNION ALL SELECT 'open_client_actions',count(*) FROM public.case_tasks WHERE (visible_to_client OR visibility='client') AND status NOT IN ('completed','not_applicable')
UNION ALL SELECT 'client_visible_documents',count(*) FROM public.document_versions v JOIN public.document_records r ON r.id=v.document_record_id WHERE v.malware_scan_status='clean' AND v.lifecycle_status IN ('reviewed','retained','legal_hold') AND EXISTS(SELECT 1 FROM public.document_access_grants g WHERE g.document_record_id=r.id AND g.audience='client' AND g.revoked_at IS NULL)
UNION ALL SELECT 'document_acknowledgements',count(*) FROM public.client_document_acknowledgements
UNION ALL SELECT 'stale_upload_pending_versions',count(*) FROM public.document_versions WHERE lifecycle_status='upload_pending' AND created_at<now()-interval '24 hours';

SELECT p.case_id,p.client_id,p.legal_matter_id,p.matter_reference,p.friendly_status,p.source_version,p.updated_at,
 tc.row_version case_row_version,COALESCE((SELECT count(*) FROM public.client_case_activity_read_model a WHERE a.case_id=p.case_id),0) activity_count
FROM public.client_case_read_model p JOIN public.transaction_cases tc ON tc.id=p.case_id ORDER BY p.updated_at DESC;
