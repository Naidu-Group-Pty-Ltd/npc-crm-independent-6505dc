-- Solicitor Portal Phase 0: read-only relationship/backfill baseline.
-- Run with a read-only role. Zero rows is the target for anomaly result sets.
-- Candidate rows are intentionally NOT auto-linked; never infer links from address.

BEGIN TRANSACTION READ ONLY;

-- 1. Orphaned or cross-firm/client assignment anchors.
SELECT 'assignment_anchor_anomaly' AS check_name, a.id AS assignment_id,
       a.solicitor_user_id, a.client_id, a.legal_matter_id
FROM public.solicitor_portal_client_assignments a
LEFT JOIN public.solicitor_portal_users u ON u.id = a.solicitor_user_id
LEFT JOIN public.clients c ON c.id = a.client_id
LEFT JOIN public.legal_matters m ON m.id = a.legal_matter_id
WHERE u.id IS NULL OR c.id IS NULL
   OR (a.legal_matter_id IS NOT NULL AND m.id IS NULL)
   OR (m.id IS NOT NULL AND (m.client_id <> a.client_id OR m.firm_id <> u.firm_id));

-- 2. One-sided or cross-client matter/purchase-file links.
SELECT 'matter_purchase_file_link_anomaly' AS check_name, m.id AS legal_matter_id,
       m.client_id AS matter_client_id, m.purchase_file_id,
       pf.client_id AS purchase_file_client_id, pf.legal_matter_id AS reverse_matter_id
FROM public.legal_matters m
LEFT JOIN public.purchase_files pf ON pf.id = m.purchase_file_id
WHERE m.purchase_file_id IS NOT NULL
  AND (pf.id IS NULL OR pf.legal_matter_id IS DISTINCT FROM m.id OR pf.client_id IS DISTINCT FROM m.client_id)
UNION ALL
SELECT 'purchase_file_matter_link_anomaly', m.id, m.client_id, pf.id, pf.client_id, pf.legal_matter_id
FROM public.purchase_files pf
LEFT JOIN public.legal_matters m ON m.id = pf.legal_matter_id
WHERE pf.legal_matter_id IS NOT NULL
  AND (m.id IS NULL OR m.purchase_file_id IS DISTINCT FROM pf.id OR m.client_id IS DISTINCT FROM pf.client_id);

-- 3. Duplicate relationship keys (must be zero before uniqueness cutovers).
SELECT 'duplicate_matter_purchase_file' AS check_name, purchase_file_id::text AS relationship_key,
       count(*) AS row_count, array_agg(id ORDER BY id) AS row_ids
FROM public.legal_matters
WHERE purchase_file_id IS NOT NULL
GROUP BY purchase_file_id HAVING count(*) > 1;

SELECT 'duplicate_matter_client_deal' AS check_name, client_deal_id::text AS relationship_key,
       count(*) AS row_count, array_agg(id ORDER BY id) AS row_ids
FROM public.legal_matters
WHERE client_deal_id IS NOT NULL
GROUP BY client_deal_id HAVING count(*) > 1;

-- 4. Deal links whose client differs from the legal matter.
SELECT 'matter_client_deal_link_anomaly' AS check_name, m.id AS legal_matter_id,
       m.client_id AS matter_client_id, d.id AS client_deal_id, d.client_id AS deal_client_id
FROM public.legal_matters m
LEFT JOIN public.client_deals d ON d.id = m.client_deal_id
WHERE m.client_deal_id IS NOT NULL
  AND (d.id IS NULL OR d.client_id IS DISTINCT FROM m.client_id);

-- 5. Explicitly unlinked candidates for operator reconciliation. These are not mappings.
SELECT 'unlinked_legal_matter' AS candidate_type, id, client_id, created_at
FROM public.legal_matters WHERE purchase_file_id IS NULL
UNION ALL
SELECT 'unlinked_purchase_file', id, client_id, created_at
FROM public.purchase_files WHERE legal_matter_id IS NULL
UNION ALL
SELECT 'unlinked_client_deal', id, client_id, created_at
FROM public.client_deals d
WHERE NOT EXISTS (
  SELECT 1 FROM public.legal_matters m WHERE m.client_deal_id = d.id
);

ROLLBACK;
