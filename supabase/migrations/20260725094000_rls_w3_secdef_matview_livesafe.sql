-- =============================================================================
-- RLS-W3 (Warning): revoke anon EXECUTE on ops SECURITY DEFINER fns + hide matview
-- =============================================================================
--
-- LIVE-SAFE. Two linter findings addressed without touching any browser code path:
--
-- 1) anon_security_definer_function_executable — three SECURITY DEFINER helper
--    functions were EXECUTE-able by the anon (unauthenticated) role, so anyone
--    with the public anon key could invoke them and read ops/telemetry data:
--       * get_api_health_stats   — API health/telemetry
--       * get_all_cache_stats    — cache statistics
--       * get_report_changelog   — report version changelog
--    All three are only ever reached through the get-system-logs / manage-templates
--    edge functions (invokeSecureFunction, which authenticates the staff JWT first),
--    never via a direct browser RPC. We revoke anon EXECUTE and keep authenticated.
--
--    NOT revoked (intentional anon paths, documented):
--       * get_shared_qa_answer   — powers the public share-token QA view; the
--         report-qa edge function calls it with the anon client by design and the
--         function gates access on the share token internally.
--       * resolve_report_template — resolved from the browser during report
--         rendering via the anon client; returns non-sensitive template structure.
--       * has_role / has_aml_role / has_aml_write_role / has_any_aml_role — RLS
--         predicate helpers referenced by 20–59 policies each; revoking EXECUTE
--         would break policy evaluation.
--    (retry_failed_bulk_items is handled in RLS-W2 once its caller moves to the
--     JWT client, since it is currently invoked from the browser anon client.)
--
-- 2) materialized_view_in_api — the pdf_import_cost_daily materialized view was
--    exposed through PostgREST to anon/authenticated. Nothing in the app reads it
--    (verified: no src/ or edge-function reference); revoke API-role SELECT so it
--    is reachable only by service_role/admin.
-- =============================================================================

-- ── 1) SECURITY DEFINER ops functions: drop anon EXECUTE ─────────────────────
REVOKE EXECUTE ON FUNCTION public.get_api_health_stats(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_all_cache_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_report_changelog(uuid, integer, integer) FROM anon;

-- ── 2) Materialized view: remove anon/authenticated API exposure ─────────────
REVOKE SELECT ON public.pdf_import_cost_daily FROM anon;
REVOKE SELECT ON public.pdf_import_cost_daily FROM authenticated;
