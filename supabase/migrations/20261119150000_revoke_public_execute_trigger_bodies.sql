-- ===========================================================================
-- A REVOKE THAT NAMED `anon` AND NOT `PUBLIC` DID NOTHING
--
-- The audit-remediation migration (20261119140000) revoked EXECUTE on two
-- trigger bodies:
--
--   REVOKE EXECUTE ON FUNCTION public.enforce_step_up_session_owner()
--     FROM anon, authenticated;
--   REVOKE EXECUTE ON FUNCTION public.validate_property_comparison_report_types()
--     FROM anon, authenticated;
--
-- One of those worked and one was a no-op, and nothing said which.
--
-- Postgres grants EXECUTE on a new function to `PUBLIC`, and every role
-- INHERITS from PUBLIC. Revoking from `anon` removes a grant `anon` was never
-- individually given; the PUBLIC grant behind it still stands, so `anon` can
-- still execute. Measured on the live catalogue after 20261119140000 was
-- applied on 12 September 2026:
--
--   enforce_step_up_session_owner              postgres=X/postgres
--                                              service_role=X/postgres
--                                              -> anon EXECUTE = false   (closed)
--
--   validate_property_comparison_report_types  =X/postgres          <-- PUBLIC
--                                              postgres=X/postgres
--                                              service_role=X/postgres
--                                              -> anon EXECUTE = TRUE    (open)
--
-- The first one closed only because it happened to carry no PUBLIC grant. The
-- second still holds one, so the revoke beside it changed nothing at all.
--
-- THE GALLING PART IS THAT THE RULE WAS ALREADY WRITTEN DOWN.
-- `check-migration-security.mjs` refused 20261119140000 until it revoked
-- PUBLIC on `gc_pdf_import_jobs`, and its own message says "Revoking from
-- `anon` alone is a no-op." That gate only inspects functions a migration
-- CREATES, so it had nothing to say about two it merely REVOKED on — and the
-- fix went in on the one function the gate happened to name. The gate is
-- generalised in the same change as this file so the class cannot recur.
--
-- SCOPE. This fixes the two functions 20261119140000 intended to close and
-- nothing else. A sweep of the live catalogue found 89 trigger-returning
-- functions carrying a PUBLIC EXECUTE grant, and 88 of them are deliberately
-- left alone: they are SECURITY INVOKER, so a direct call runs with the
-- caller's own privileges and confers nothing, and PostgREST does not expose
-- a function returning `trigger` over /rest/v1/rpc at all. Only
-- `validate_property_comparison_report_types` is SECURITY DEFINER — it runs as
-- its owner — which is why it is the one the platform's own advisor flags and
-- the one worth closing.
--
-- Revoking EXECUTE does not affect trigger firing: a trigger runs its function
-- in the context of the statement that fired it, not as the calling role.
-- ===========================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.validate_property_comparison_report_types()
  FROM PUBLIC, anon, authenticated;

-- Already correct in production (it carries no PUBLIC grant), restated so the
-- file is right when replayed onto a database where CREATE granted PUBLIC.
REVOKE EXECUTE ON FUNCTION public.enforce_step_up_session_owner()
  FROM PUBLIC, anon, authenticated;

COMMIT;
