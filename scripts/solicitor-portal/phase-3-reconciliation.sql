-- Phase 3 read-only governance/backfill reconciliation report.
WITH current_terms AS (
  SELECT id, version FROM public.portal_terms_versions
  WHERE portal = 'solicitor' AND retired_at IS NULL AND effective_at <= now()
  ORDER BY effective_at DESC LIMIT 1
), governance AS (
  SELECT u.id,
    EXISTS (SELECT 1 FROM public.portal_terms_acceptances a, current_terms t WHERE a.solicitor_user_id=u.id AND a.terms_version_id=t.id) AS accepted_current,
    COALESCE(bool_and(NOT s.mandatory OR s.completed_at IS NOT NULL), false) AS onboarding_complete,
    count(s.id) FILTER (WHERE s.mandatory) AS mandatory_steps
  FROM public.solicitor_portal_users u LEFT JOIN public.solicitor_onboarding_steps s ON s.solicitor_user_id=u.id
  GROUP BY u.id
)
SELECT 'governance_users' AS report, count(*) AS total,
 count(*) FILTER (WHERE NOT accepted_current) AS missing_current_terms,
 count(*) FILTER (WHERE NOT onboarding_complete OR mandatory_steps=0) AS incomplete_onboarding
FROM governance;

SELECT 'projection_reconciliation' AS report,
 count(*) FILTER (WHERE p.legal_matter_id IS NULL) AS missing_projection,
 count(*) FILTER (WHERE p.client_id IS DISTINCT FROM m.client_id) AS client_mismatch,
 count(*) FILTER (WHERE p.shared_summary IS DISTINCT FROM m.shared_summary) AS summary_mismatch
FROM public.legal_matters m LEFT JOIN public.client_legal_case_summary p ON p.legal_matter_id=m.id
WHERE m.client_id IS NOT NULL;
