-- ===========================================================================
-- SECURITY AUDIT REMEDIATION — 12 SEPTEMBER 2026
--
-- Four authorisation defects found by a read-only audit of the live project.
-- Each is fixed here at the smallest scope that actually closes it; what the
-- audit recommended but this migration deliberately does NOT do is recorded at
-- the foot, because two of those recommendations would have caused an outage.
-- ===========================================================================

BEGIN;

-- ── 1. THE ONLY UNAUTHENTICATED WRITE PATH IN THE DATABASE ─────────────────
--
-- `_report_templates_backup_20260906` is a copy of `report_templates` taken on
-- 6 September. It was created without RLS and inherited the default grants, so
-- it carried SELECT, INSERT, UPDATE, DELETE and TRUNCATE for `anon` and
-- `authenticated` with no policy in front of any of them. `public` is a
-- PostgREST-exposed schema, so every one of those verbs was reachable by
-- anybody holding the publishable anon key — which is, by design, inlined into
-- every browser bundle this project ships.
--
-- MEASURED 12 SEPTEMBER 2026, unauthenticated, no session:
--
--   GET /rest/v1/_report_templates_backup_20260906?select=id,name,report_type
--   → HTTP 206, rows returned
--
--   control, same key, a table whose grants are correct:
--   GET /rest/v1/builder_stock_items → HTTP 401 permission denied
--
-- The write path was not exercised — demonstrating it would have meant
-- destroying production rows — but nothing stood in front of it: no RLS, and a
-- DELETE grant.
--
-- THE FIX IS NOT A DROP. The 112 rows are somebody's backup and deleting them
-- is irreversible, so this revokes the grants and enables RLS instead. A table
-- with RLS enabled and no policy denies every non-superuser role, which is the
-- correct resting state for a table nothing is supposed to read through the
-- API. `service_role` bypasses RLS, so anything server-side that legitimately
-- needs it is unaffected. Reversible: re-granting is one statement.
REVOKE ALL PRIVILEGES ON TABLE public._report_templates_backup_20260906
  FROM anon, authenticated;

ALTER TABLE public._report_templates_backup_20260906 ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public._report_templates_backup_20260906 IS
  'Backup of report_templates taken 2026-09-06. RLS enabled with NO policy and '
  'no anon/authenticated grants: service_role only. It was readable and '
  'writable by any holder of the public anon key until 2026-09-12 — see the '
  'audit-remediation migration. Delete it once the backup is no longer needed; '
  'do not re-grant.';

-- ── 2. A POLICY NEUTRALISED BY A TRAILING `OR true` ────────────────────────
--
-- `tpl_comments_update_own_or_resolve` read
--
--   USING ((author_id IS NULL) OR (author_id = auth.uid()) OR true)
--
-- and the final disjunct makes the ownership test unreachable: any
-- authenticated principal could rewrite any row of `template_comments`,
-- including another person's `body` and `author_id`.
--
-- THE `OR true` WAS LOAD-BEARING, WHICH IS WHY DELETING IT IS THE WRONG FIX.
-- `TemplateCommentsPanel.toggleResolved` resolves a whole THREAD —
-- `.update({resolved, resolved_at, resolved_by}).in('id', ids)` — and a thread
-- contains other people's replies. Removing the disjunct restores ownership
-- and breaks resolving any conversation you did not start single-handedly.
--
-- So the permission is narrowed by COLUMN instead of by row. RLS cannot
-- express "these columns only", but a column-level GRANT can, and the two
-- compose: the policy keeps letting a collaborator touch any row, while the
-- grant means the only thing they can write is the resolution state. Nobody —
-- author or not — can rewrite a comment's text through the API, which no
-- surface offers anyway (the panel inserts, deletes and toggles; it has no
-- edit control).
--
-- The policy is also renamed, because `..._own_or_resolve` described an
-- ownership test that has not been in force since the disjunct was added.
DROP POLICY IF EXISTS tpl_comments_update_own_or_resolve ON public.template_comments;

-- And the NEW name too, so this file can be applied twice. `apply-migration.yml`
-- applies one named file on human dispatch, and every other statement here is
-- idempotent; `CREATE POLICY` is the only one that is not. Postgres has no
-- `CREATE POLICY IF NOT EXISTS` — writing one is the invalid-clause class
-- `migrationSyntax.test.ts` exists to catch — so drop-then-create is the idiom.
DROP POLICY IF EXISTS tpl_comments_update_resolution ON public.template_comments;

CREATE POLICY tpl_comments_update_resolution ON public.template_comments
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY tpl_comments_update_resolution ON public.template_comments IS
  'Any collaborator may resolve or reopen any thread. The row predicate is '
  'deliberately open — resolving a thread means updating replies you did not '
  'write — and the write is confined to the resolution columns by the '
  'column-level UPDATE grant below, not by this policy.';

REVOKE UPDATE ON TABLE public.template_comments FROM authenticated;
GRANT UPDATE (resolved, resolved_at, resolved_by)
  ON TABLE public.template_comments TO authenticated;

-- ── 3. TWO TRIGGER FUNCTIONS EXPOSED AS CALLABLE RPC ───────────────────────
--
-- Both are trigger bodies. Neither takes arguments, neither is meant to be
-- invoked directly, and both were executable by `anon` over
-- `/rest/v1/rpc/<name>` purely through the default EXECUTE grant that every
-- function in a PostgREST-exposed schema receives.
--
-- Revoking EXECUTE does not affect trigger firing: a trigger runs its function
-- in the context of the statement that fired it, not as the calling role.
REVOKE EXECUTE ON FUNCTION public.enforce_step_up_session_owner()
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_property_comparison_report_types()
  FROM anon, authenticated;

-- ── 4. THE NIGHTLY GC HAS NEVER ONCE SUCCEEDED ─────────────────────────────
--
-- `gc_pdf_import_jobs` does two things: it times out PDF import jobs that have
-- been stuck for fifteen minutes, and then it deletes diagnostics objects
-- older than seven days with
--
--   DELETE FROM storage.objects WHERE bucket_id = 'pdf-import-diagnostics' …
--
-- Supabase refuses direct deletion from the storage tables:
--
--   ERROR: Direct deletion from storage tables is not allowed.
--          Use the Storage API instead.
--
-- MEASURED: 59 runs since 2026-07-15, 59 failures, zero successes.
--
-- AND THE COST IS BOTH HALVES, NOT JUST THE DELETE. A plpgsql function is one
-- transaction, so the exception rolls the whole call back — the timeout sweep
-- above it has never committed either. Nothing has been reporting stuck
-- imports as timed out for two months; it looked like a storage-retention bug
-- and it was also a job-liveness bug.
--
-- The DELETE is removed so the half that CAN work in SQL does. Storage
-- retention genuinely cannot be done from here — it needs the Storage API, so
-- it belongs in an Edge Function, and until one exists this function no longer
-- pretends to do it.
CREATE OR REPLACE FUNCTION public.gc_pdf_import_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.pdf_import_jobs
     SET status       = 'failed',
         stage        = 'failed',
         error_code   = 'timeout',
         error_text   = 'PDF import timed out after 15 minutes without completion.',
         timed_out_at = now(),
         finished_at  = COALESCE(finished_at, now()),
         updated_at   = now()
   WHERE status IN ('queued','uploading','parsing','mapping','finalizing')
     AND updated_at < now() - interval '15 minutes';

  -- NO `DELETE FROM storage.objects` HERE. It is rejected by the platform and
  -- it took the timeout sweep above down with it on all 59 runs. Diagnostics
  -- retention must go through the Storage API from an Edge Function.
END;
$$;

-- CREATE OR REPLACE PRESERVES AN EXISTING FUNCTION'S ACL, AND THAT IS EXACTLY
-- WHY THIS IS STATED RATHER THAN ASSUMED. On this project the function already
-- carries `postgres=X/postgres, service_role=X/postgres` and neither `anon` nor
-- `authenticated` can execute it — verified on the live catalogue. But a
-- migration has to be correct when it is REPLAYED onto an empty database: a
-- restore, a preview branch, a newly provisioned clone. There
-- `CREATE OR REPLACE` on a function that does not exist yet is a plain CREATE,
-- and CREATE grants EXECUTE to PUBLIC by default, which `anon` inherits — so a
-- SECURITY DEFINER nightly GC would ship callable over
-- /rest/v1/rpc/gc_pdf_import_jobs by any holder of the publishable key.
--
-- Revoking from `anon` alone is a no-op while the PUBLIC grant stands, which is
-- the trap this restates. The three statements below reproduce the live ACL
-- exactly, so this is an assertion on the prime and a fix everywhere else.
--
-- The 03:17 cron job runs `SELECT public.gc_pdf_import_jobs();` as `postgres`,
-- which owns the function, so nothing here touches the scheduled run.
REVOKE EXECUTE ON FUNCTION public.gc_pdf_import_jobs() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.gc_pdf_import_jobs() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gc_pdf_import_jobs() TO service_role;

COMMENT ON FUNCTION public.gc_pdf_import_jobs() IS
  'Times out PDF import jobs stalled past 15 minutes. Storage retention for '
  'pdf-import-diagnostics is deliberately NOT done here — direct deletion from '
  'storage.objects is rejected by the platform and rolled this whole function '
  'back on 59 consecutive runs. It needs the Storage API.';

COMMIT;

-- ===========================================================================
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--
-- 1. IT DOES NOT REVOKE EXECUTE ON THE ROLE ORACLES. The audit flagged
--    `has_role`, `has_aml_role`, `has_any_aml_role`, `has_aml_write_role`,
--    `can_access_client_fact_find` and `current_user_can_*` as
--    anon-executable SECURITY DEFINER functions and recommended revoking them.
--    That recommendation was wrong and acting on it would have caused an
--    outage: those functions are called from inside RLS policy predicates, and
--    a policy is evaluated as the querying role. Measured on the live
--    catalogue:
--
--      has_any_aml_role             57 policies
--      current_user_can_*           39 policies
--      has_role                     33 policies
--      has_aml_write_role           21 policies
--      has_aml_role                 17 policies
--      can_access_client_fact_find   9 policies
--
--    Revoking EXECUTE makes every one of those 176 policies raise
--    `permission denied for function` instead of returning a boolean — the
--    authorisation layer fails, loudly, everywhere. The residual exposure is
--    small and is accepted: a caller who already knows a user's UUID can learn
--    whether that user holds a role. The escalation this class normally
--    carries is already closed, because every SECURITY DEFINER function in
--    `public` and `aml` pins its `search_path`.
--
-- 2. IT DOES NOT RE-SCOPE `marketing_intelligence_reports`. Its policy is
--    named "Users can view their own marketing reports" over a `true`
--    predicate, which reads like a defect. It is not: the only reader,
--    `MarketIntelligenceHistoryModal`, fetches the last 50 rows with no user
--    filter because the history is shared across the marketing team. Scoping
--    to `generated_by = auth.uid()` would empty that modal for everyone except
--    whoever generated each report. The name is misleading; the behaviour is
--    the product. Renaming it is a judgement call for the owner rather than a
--    security fix, so it is left alone and recorded instead.
--
-- 3. IT DOES NOT MAKE `template-import-assets` PRIVATE. That bucket serves
--    rasterised pages of imported PDFs to unauthenticated callers, which the
--    audit rates a genuine exposure. But `template-import-pdf` mints public
--    URLs with `getPublicUrl` and those URLs are persisted inside template
--    block configuration, so flipping the bucket breaks the rendering of every
--    template already built from an import. Closing it properly means
--    migrating stored URLs to signed-URL resolution at render time. That is a
--    feature change, not a migration, and doing it blind here would trade a
--    disclosure risk for broken client documents.
-- ===========================================================================
