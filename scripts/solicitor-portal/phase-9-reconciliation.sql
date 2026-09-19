-- Read-only immutable-document backfill and processing report.
SELECT 'document_records' metric,count(*) value FROM public.document_records
UNION ALL SELECT 'document_versions',count(*) FROM public.document_versions
UNION ALL SELECT 'legacy_unverified',count(*) FROM public.document_versions WHERE malware_scan_status='legacy_unverified'
UNION ALL SELECT 'infected',count(*) FROM public.document_versions WHERE malware_scan_status='infected'
UNION ALL SELECT 'processing_failures',count(*) FROM public.document_processing_jobs WHERE status IN ('failed','dead_lettered')
UNION ALL SELECT 'open_migration_issues',count(*) FROM public.document_migration_issues WHERE status='open'
UNION ALL SELECT 'versions_without_hash',count(*) FROM public.document_versions WHERE lifecycle_status IN ('available','reviewed','retained','legal_hold') AND sha256 IS NULL
UNION ALL SELECT 'clean_versions_without_grant',count(*) FROM public.document_versions v WHERE v.malware_scan_status='clean' AND NOT EXISTS(SELECT 1 FROM public.document_access_grants g WHERE g.document_record_id=v.document_record_id AND g.revoked_at IS NULL);

SELECT j.id job_id,j.status,j.attempts,j.last_error,v.id version_id,v.storage_path,v.malware_scan_status,v.lifecycle_status
FROM public.document_processing_jobs j JOIN public.document_versions v ON v.id=j.document_version_id
WHERE j.status IN ('failed','dead_lettered') ORDER BY j.updated_at DESC;

SELECT r.id record_id,r.case_id,r.legal_matter_id,r.current_version_id,v.version_number,v.sha256,v.detected_mime_type,v.byte_size,v.malware_scan_status,v.lifecycle_status
FROM public.document_records r LEFT JOIN public.document_versions v ON v.id=r.current_version_id ORDER BY r.updated_at DESC;
