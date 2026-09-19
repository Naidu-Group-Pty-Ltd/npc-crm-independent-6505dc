-- Read-only Phase 15 gate evidence. Run with a service role; do not mutate from this report.
SELECT feature_key, default_mode, minimum_stable_days, legacy_removal_target FROM public.cross_portal_feature_definitions ORDER BY feature_key;
SELECT firm_id, feature_key, mode, stable_since, changed_at FROM public.cross_portal_firm_rollouts ORDER BY firm_id, feature_key;
SELECT firm_id, feature_key, count(*) FILTER (WHERE NOT matches) AS mismatches, max(compared_at) AS last_compared_at FROM public.cross_portal_dual_read_comparisons GROUP BY firm_id, feature_key ORDER BY firm_id, feature_key;
SELECT firm_id, feature_key, count(DISTINCT approval_type) FILTER (WHERE revoked_at IS NULL) AS active_approvals FROM public.cross_portal_cutover_approvals GROUP BY firm_id, feature_key;
SELECT id AS firm_id, feature_key, public.get_cross_portal_cutover_readiness(id,feature_key) AS readiness FROM public.solicitor_firms CROSS JOIN public.cross_portal_feature_definitions ORDER BY id, feature_key;
