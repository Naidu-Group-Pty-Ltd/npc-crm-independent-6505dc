-- Phase 5 read-only backfill and reconciliation report.
SELECT
 (SELECT count(*) FROM public.transaction_cases) AS cases_created,
 (SELECT count(*) FROM public.transaction_case_links WHERE legal_matter_id IS NOT NULL) AS legal_matters_linked,
 (SELECT count(*) FROM public.transaction_case_links WHERE purchase_file_id IS NOT NULL) AS purchase_files_linked,
 (SELECT count(*) FROM public.transaction_case_links WHERE client_deal_id IS NOT NULL) AS client_deals_linked,
 (SELECT count(*) FROM public.transaction_case_reconciliation_issues WHERE status='open') AS ambiguous_or_conflicting_links,
 (SELECT count(*) FROM public.transaction_case_reconciliation_issues WHERE status='open' AND issue_type LIKE '%client%') AS cross_client_conflicts,
 (SELECT count(*) FROM public.legal_matters m WHERE m.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.legal_matter_id=m.id))
 + (SELECT count(*) FROM public.purchase_files p WHERE p.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.purchase_file_id=p.id))
 + (SELECT count(*) FROM public.client_deals d WHERE NOT EXISTS(SELECT 1 FROM public.transaction_case_links l WHERE l.client_deal_id=d.id)) AS orphaned_active_records;

SELECT issue_type,status,count(*) AS affected FROM public.transaction_case_reconciliation_issues GROUP BY issue_type,status ORDER BY status,issue_type;

SELECT c.id AS case_id,c.client_id,l.legal_matter_id,l.purchase_file_id,l.client_deal_id
FROM public.transaction_cases c JOIN public.transaction_case_links l ON l.case_id=c.id
LEFT JOIN public.legal_matters m ON m.id=l.legal_matter_id LEFT JOIN public.purchase_files p ON p.id=l.purchase_file_id LEFT JOIN public.client_deals d ON d.id=l.client_deal_id
WHERE (m.id IS NOT NULL AND m.client_id IS DISTINCT FROM c.client_id) OR (p.id IS NOT NULL AND p.client_id IS DISTINCT FROM c.client_id) OR (d.id IS NOT NULL AND d.client_id IS DISTINCT FROM c.client_id);
