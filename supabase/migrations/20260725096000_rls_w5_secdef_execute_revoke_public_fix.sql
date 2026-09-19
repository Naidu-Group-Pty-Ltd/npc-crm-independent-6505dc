-- =============================================================================
-- RLS-W5 (Warning, corrective): actually remove anon EXECUTE on SECURITY DEFINER fns
-- =============================================================================
--
-- LIVE-SAFE corrective follow-up to RLS-W2/W3.
--
-- Those migrations used `REVOKE EXECUTE ... FROM anon`, which is a NO-OP here:
-- EXECUTE is held via the PUBLIC pseudo-role, and `anon` inherits PUBLIC. So
-- `has_function_privilege('anon', fn, 'EXECUTE')` remained true after W2/W3.
--
-- The correct fix is to revoke from PUBLIC and re-grant EXECUTE explicitly to the
-- roles that need it. This removes anon (and any other non-granted role) while
-- keeping:
--   * authenticated — staff call retry_failed_bulk_items with the JWT client, and
--     the ops helpers are reached via authenticated edge functions;
--   * service_role  — edge functions calling these RPCs with the service client.
--
-- Applies to the four functions W2/W3 intended to lock down:
--   get_api_health_stats, get_all_cache_stats, get_report_changelog,
--   retry_failed_bulk_items.
--
-- (get_shared_qa_answer / resolve_report_template intentionally keep PUBLIC
-- EXECUTE — public share-token view and browser render path respectively.)
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.get_api_health_stats(integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_api_health_stats(integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_all_cache_stats() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_all_cache_stats() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_report_changelog(uuid, integer, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_report_changelog(uuid, integer, integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.retry_failed_bulk_items(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.retry_failed_bulk_items(uuid) TO authenticated, service_role;
