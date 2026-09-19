-- Read-only Phase 7 backfill and reconciliation report.
SELECT 'linked_cases' metric,count(*) value FROM public.transaction_case_links
UNION ALL SELECT 'milestones',count(*) FROM public.case_milestones
UNION ALL SELECT 'shared_tasks',count(*) FROM public.case_tasks WHERE visibility='shared'
UNION ALL SELECT 'open_conflicts',count(*) FROM public.case_milestone_conflicts WHERE resolution_status='open'
UNION ALL SELECT 'authority_applied_conflicts',count(*) FROM public.case_milestone_conflicts WHERE resolution_status='authority_applied'
UNION ALL SELECT 'unmigrated_legal_dates',count(*) FROM public.legal_matter_critical_dates d JOIN public.transaction_case_links l ON l.legal_matter_id=d.legal_matter_id LEFT JOIN public.case_milestones m ON m.source_domain='legal' AND m.source_record_id=d.id WHERE m.id IS NULL
UNION ALL SELECT 'unmigrated_finance_dates',count(*) FROM public.purchase_file_critical_dates d JOIN public.transaction_case_links l ON l.purchase_file_id=d.purchase_file_id LEFT JOIN public.case_milestones m ON m.source_domain='finance' AND m.source_record_id=d.id WHERE m.id IS NULL
UNION ALL SELECT 'tasks_without_provenance',count(*) FROM public.case_tasks WHERE jsonb_array_length(source_refs)=0;

SELECT case_id,milestone_type,resolution_status,requires_confirmation,left_source,right_source,authoritative_milestone_id
FROM public.case_milestone_conflicts ORDER BY created_at DESC;
