-- Phase 4 read-only repair and reconciliation report. No inferred links.
SELECT 'cross_client_purchase_file_links' AS issue, m.id AS legal_matter_id, m.purchase_file_id AS linked_id
FROM public.legal_matters m JOIN public.purchase_files p ON p.id=m.purchase_file_id
WHERE m.client_id IS DISTINCT FROM p.client_id
UNION ALL
SELECT 'cross_client_deal_links',m.id,m.client_deal_id FROM public.legal_matters m JOIN public.client_deals d ON d.id=m.client_deal_id WHERE m.client_id IS DISTINCT FROM d.client_id;

SELECT 'duplicate_purchase_file_links' AS issue,purchase_file_id AS linked_id,count(*) AS affected
FROM public.legal_matters WHERE purchase_file_id IS NOT NULL GROUP BY purchase_file_id HAVING count(*)>1
UNION ALL
SELECT 'duplicate_deal_links',client_deal_id,count(*) FROM public.legal_matters WHERE client_deal_id IS NOT NULL GROUP BY client_deal_id HAVING count(*)>1;

SELECT 'assignee_firm_mismatch' AS issue,m.id AS legal_matter_id,m.firm_id,u.firm_id AS solicitor_firm_id
FROM public.legal_matters m JOIN public.solicitor_portal_users u ON u.id=m.assigned_solicitor_user_id
WHERE m.firm_id IS NULL OR m.firm_id IS DISTINCT FROM u.firm_id;

SELECT 'closure_workflow_inconsistency' AS issue,id,status,closure_status,row_version
FROM public.legal_matters
WHERE (closure_status IN ('closed','archived') AND status NOT IN ('post_settlement','terminated'))
   OR (closure_status='open' AND status='terminated');
