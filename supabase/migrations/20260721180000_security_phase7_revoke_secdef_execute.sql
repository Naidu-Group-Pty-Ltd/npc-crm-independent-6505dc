-- Phase 7 (F-07 / DB-004): Revoke EXECUTE on privileged SECURITY DEFINER
-- functions from the client-reachable roles (PUBLIC / anon / authenticated).
--
-- SECURITY DEFINER functions run with the *definer's* privileges, bypassing
-- RLS and table grants. On this project ~116 such functions in `public` were
-- EXECUTE-able by `anon` (the publishable key that ships in the browser bundle)
-- and `authenticated` — a privilege-escalation surface: any of them that
-- mutate state or read across tenants could be invoked directly with the
-- public key, sidestepping the edge-function auth layer entirely.
--
-- Fix: grant EXECUTE to `service_role` (edge functions call these via the
-- service client and must keep working), then REVOKE EXECUTE from PUBLIC and
-- the client roles for every SECURITY DEFINER function in `public` EXCEPT a
-- reviewed keep-list. NOTE: EXECUTE is granted to PUBLIC by default at CREATE
-- time, so revoking from anon/authenticated alone is a no-op — PUBLIC must be
-- revoked. This DO block does both, and is idempotent.
--
-- Keep-list (must remain EXECUTE-able by anon/authenticated):
--   Frontend RPCs called directly with the anon/staff client:
--     * resolve_report_template(text,text,uuid,uuid)
--     * get_report_changelog(uuid,integer,integer)
--     * get_all_cache_stats()
--     * get_api_health_stats(integer)
--     * retry_failed_bulk_items(uuid)
--   RLS-policy helper predicates (evaluated in the querying role's context, so
--   the querying role needs EXECUTE or every policy using them fails closed):
--     * has_role(uuid,app_role)
--     * has_aml_role(uuid,aml.aml_role)
--     * has_aml_write_role(uuid)
--     * has_any_aml_role(uuid)
--
-- Matching is by function NAME (not signature): the keep-listed names have a
-- single overload each in `public`, and this keeps the block resilient to
-- signature drift. Verified live: anon/authenticated SECURITY DEFINER-executable
-- functions dropped 116 -> 9; service_role retains EXECUTE on all 122.
DO $$
DECLARE
  fn record;
  keep_names text[] := ARRAY[
    'resolve_report_template',
    'get_report_changelog',
    'get_all_cache_stats',
    'get_api_health_stats',
    'retry_failed_bulk_items',
    'has_role',
    'has_aml_role',
    'has_aml_write_role',
    'has_any_aml_role'
  ];
BEGIN
  FOR fn IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.proname <> ALL (keep_names)
  LOOP
    -- Edge functions (service_role) must keep calling these.
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      fn.proname, fn.args
    );
    -- Remove the client-reachable EXECUTE surface.
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      fn.proname, fn.args
    );
  END LOOP;
END $$;
