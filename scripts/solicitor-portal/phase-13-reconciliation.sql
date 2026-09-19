-- Phase 13 read-only governance reconciliation.
SELECT 'enabled_without_consent' issue,firm_id::text record_id FROM public.firm_ai_policies WHERE external_processing_enabled AND consent_version IS NULL
UNION ALL SELECT 'run_without_source',r.id::text FROM public.ai_analysis_runs r WHERE NOT EXISTS(SELECT 1 FROM public.ai_analysis_sources s WHERE s.run_id=r.id)
UNION ALL SELECT 'success_without_output_hash',id::text FROM public.ai_analysis_runs WHERE status='succeeded' AND output_hash IS NULL
UNION ALL SELECT 'source_hash_drift',s.id::text FROM public.ai_analysis_sources s JOIN public.document_versions v ON v.id=s.document_version_id WHERE s.source_sha256 IS DISTINCT FROM v.sha256
UNION ALL SELECT 'confirmed_without_review',r.id::text FROM public.ai_analysis_runs r WHERE r.review_status IN ('confirmed','partially_confirmed') AND NOT EXISTS(SELECT 1 FROM public.ai_analysis_reviews v WHERE v.run_id=r.id);
