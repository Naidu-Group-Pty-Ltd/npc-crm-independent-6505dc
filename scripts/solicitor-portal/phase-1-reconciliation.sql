-- Phase 1 post-migration reconciliation. Run with a read-only role.
BEGIN TRANSACTION READ ONLY;

-- Exact-firm matters reachable under the legacy rule but missing an active grant.
SELECT 'missing_exact_firm_grant' AS check_name, a.id AS source_assignment_id,
       a.solicitor_user_id, m.id AS legal_matter_id, m.client_id, m.firm_id
FROM public.solicitor_portal_client_assignments a
JOIN public.solicitor_portal_users u ON u.id = a.solicitor_user_id
JOIN public.legal_matters m ON m.client_id = a.client_id AND m.firm_id = u.firm_id
LEFT JOIN public.solicitor_matter_access g
  ON g.solicitor_user_id = a.solicitor_user_id AND g.legal_matter_id = m.id
WHERE g.id IS NULL;

-- Grants which violate user/matter/record firm equality (must be zero).
SELECT 'cross_firm_grant' AS check_name, g.id AS access_id, g.solicitor_user_id,
       g.legal_matter_id, g.firm_id AS grant_firm_id, u.firm_id AS user_firm_id,
       m.firm_id AS matter_firm_id
FROM public.solicitor_matter_access g
JOIN public.solicitor_portal_users u ON u.id = g.solicitor_user_id
JOIN public.legal_matters m ON m.id = g.legal_matter_id
WHERE g.firm_id IS DISTINCT FROM u.firm_id OR g.firm_id IS DISTINCT FROM m.firm_id;

-- Null/cross-firm candidates must have no automatic grant and must be excepted.
SELECT 'unresolved_legacy_candidate' AS check_name, a.id AS source_assignment_id,
       a.solicitor_user_id, m.id AS legal_matter_id, m.firm_id AS matter_firm_id,
       u.firm_id AS user_firm_id, e.exception_code
FROM public.solicitor_portal_client_assignments a
JOIN public.solicitor_portal_users u ON u.id = a.solicitor_user_id
JOIN public.legal_matters m ON m.client_id = a.client_id
LEFT JOIN public.solicitor_matter_access_migration_exceptions e
  ON e.source_assignment_id = a.id AND e.legal_matter_id = m.id
WHERE (m.firm_id IS NULL OR m.firm_id <> u.firm_id) AND e.id IS NULL;

-- Summary retained with deployment evidence.
SELECT
  (SELECT count(*) FROM public.solicitor_portal_client_assignments) AS legacy_assignments,
  (SELECT count(*) FROM public.solicitor_matter_access) AS matter_grants,
  (SELECT count(*) FROM public.solicitor_matter_access WHERE revoked_at IS NULL) AS active_grants,
  (SELECT count(*) FROM public.solicitor_matter_access_migration_exceptions WHERE resolved_at IS NULL) AS unresolved_exceptions;
ROLLBACK;
