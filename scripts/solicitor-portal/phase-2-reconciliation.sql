BEGIN TRANSACTION READ ONLY;
SELECT 'legacy_plaintext_session_remaining' AS check_name, id AS solicitor_user_id, firm_id, session_expires_at
FROM public.solicitor_portal_users WHERE session_token IS NOT NULL;
SELECT 'invalid_hash_or_expiry' AS check_name, id AS session_id, solicitor_user_id
FROM public.solicitor_portal_sessions
WHERE token_hash !~ '^[0-9a-f]{64}$' OR idle_expires_at > absolute_expires_at;
SELECT 'active_session_for_inactive_identity' AS check_name, s.id AS session_id, s.solicitor_user_id
FROM public.solicitor_portal_sessions s JOIN public.solicitor_portal_users u ON u.id=s.solicitor_user_id
JOIN public.solicitor_firms f ON f.id=u.firm_id
WHERE s.revoked_at IS NULL AND s.absolute_expires_at > now() AND (NOT u.is_active OR u.revoked_at IS NOT NULL OR NOT f.is_active);
SELECT count(*) AS sessions, count(*) FILTER (WHERE revoked_at IS NULL AND absolute_expires_at>now() AND idle_expires_at>now()) AS active_sessions,
count(DISTINCT solicitor_user_id) FILTER (WHERE revoked_at IS NULL AND absolute_expires_at>now() AND idle_expires_at>now()) AS active_users,
count(*) FILTER (WHERE legacy_migrated_at IS NOT NULL) AS migrated_legacy_sessions FROM public.solicitor_portal_sessions;
ROLLBACK;
