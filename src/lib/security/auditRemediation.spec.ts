/**
 * Security audit remediation — 12 September 2026.
 *
 * A read-only audit of the live project found four authorisation defects and
 * made two recommendations that were WRONG. This file pins both halves,
 * because the second half is the one that costs an outage if somebody later
 * "finishes the job" from the audit report alone.
 *
 * Fixed, and asserted below:
 *
 *   F-01  `_report_templates_backup_20260906` sat in the PostgREST-exposed
 *         `public` schema with RLS off and the default grants, so the anon key
 *         — inlined into every browser bundle — could SELECT, UPDATE, DELETE
 *         and TRUNCATE it. Verified live: HTTP 206 with rows, unauthenticated.
 *
 *   F-02  Three operator backfills ran with `verify_jwt = false`, no caller
 *         check, a service-role client and CORS `*`. Two of them spend the
 *         organisation's Microsoft Graph and GoHighLevel credentials.
 *
 *   F-06  `tpl_comments_update_own_or_resolve` ended in `OR true`.
 *
 *   F-07  `gc_pdf_import_jobs` deleted from `storage.objects`, which the
 *         platform rejects — rolling the whole function back on all 59 runs
 *         since 15 July, so the job-timeout sweep in the same function never
 *         committed either.
 *
 * NOT done, and asserted below as a guard:
 *
 *   The audit recommended revoking `EXECUTE` on the anon-callable
 *   SECURITY DEFINER role oracles. Doing that takes the platform down: those
 *   functions are called from inside RLS predicates, a policy is evaluated as
 *   the querying role, and 176 live policies depend on them.
 *
 * WHY THIS FILE LIVES IN `src/lib/security/`.
 *
 * It was written in `src/lib/__tests__/`, where CI never would have run it.
 * The only step naming that directory is `npx vitest run
 * src/lib/__tests__/builderStock`, and vitest
 * matches those positionally as path substrings — so the guard above, the one
 * whose whole purpose is to stop somebody taking the authorisation layer down
 * by "finishing the audit", would have been green by never executing.
 *
 * That is the failure ci.yml already records twice in its own comments, once
 * for the Cloudflare worker and once for the cash-flow specs: "a guard nobody
 * runs still reads as coverage". Its stated remedy is not to extend a list —
 * "a list that has to be edited to stay correct will be wrong again" — so this
 * moved into a directory CI already runs whole (`npx vitest run
 * src/lib/security`) rather than adding a fourteenth path to the argv.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const MIGRATION = read(
  'supabase/migrations/20261119140000_audit_remediation_authorisation.sql');
const CONFIG = read('supabase/config.toml');

describe('F-01 — the unauthenticated write path is closed', () => {
  it('revokes every anon and authenticated privilege on the backup table', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL PRIVILEGES ON TABLE public\._report_templates_backup_20260906\s+FROM anon, authenticated;/);
  });

  it('and enables RLS, so the resting state denies rather than relying on grants', () => {
    expect(MIGRATION).toContain(
      'ALTER TABLE public._report_templates_backup_20260906 ENABLE ROW LEVEL SECURITY;');
  });

  /*
   * The 112 rows are somebody's backup. Revoking is reversible in one
   * statement; dropping is not, and an audit has no business destroying data
   * it was asked to report on.
   */
  it('does not drop the table', () => {
    expect(MIGRATION).not.toMatch(/DROP TABLE[^;]*_report_templates_backup/i);
  });
});

describe('F-02 — the operator backfills require a JWT', () => {
  it.each([
    'email-body-backfill',
    'backfill-message-directions',
    'backfill-investment-scores',
  ])('%s is verify_jwt = true', (fn) => {
    const block = CONFIG.slice(CONFIG.indexOf(`[functions.${fn}]`));
    const verify = block.slice(0, block.indexOf('\n[', 1));
    expect(verify).toMatch(/verify_jwt\s*=\s*true/);
  });

  it('every function still declares verify_jwt explicitly', () => {
    const declared = [...CONFIG.matchAll(
      /\[functions\.([A-Za-z0-9_-]+)\][^[]*?verify_jwt\s*=\s*(true|false)/gs)];
    // 413 since mission-control-announcements (the platform-notice broker);
    // 412 since amenity-register-ingest (the OSM amenity register loader);
    // 411 since estimate-capital-growth (Estimate CGR) was declared; 410 with
    // market-sales-ingest (the open-data sales-register loader); 409 after
    // Phase 7 of the network extraction deleted the Builder Portal's 27
    // functions with their config blocks (436 before). The count is a ratchet
    // against a function slipping in undeclared; check-verify-jwt-declared.mjs
    // enforces the rule itself.
    expect(declared.length).toBe(413);
  });
});

describe('F-06 — the comment policy is narrowed by column, not by row', () => {
  /*
   * The `OR true` was load-bearing: resolving a thread updates replies you did
   * not write, so restoring the ownership predicate breaks the feature. RLS
   * cannot say "these columns only" — a column-level GRANT can, and the two
   * compose.
   */
  it('keeps the open row predicate so a thread can still be resolved', () => {
    expect(MIGRATION).toContain('CREATE POLICY tpl_comments_update_resolution');
  });

  it('confines the write to the three resolution columns', () => {
    expect(MIGRATION).toContain(
      'REVOKE UPDATE ON TABLE public.template_comments FROM authenticated;');
    expect(MIGRATION).toMatch(
      /GRANT UPDATE \(resolved, resolved_at, resolved_by\)\s+ON TABLE public\.template_comments TO authenticated;/);
  });

  it('retires the name that described an ownership test no longer in force', () => {
    expect(MIGRATION).toContain(
      'DROP POLICY IF EXISTS tpl_comments_update_own_or_resolve ON public.template_comments;');
  });
});

describe('F-07 — the nightly GC stops rolling itself back', () => {
  it('no longer deletes from storage.objects', () => {
    const fn = MIGRATION.slice(MIGRATION.indexOf('FUNCTION public.gc_pdf_import_jobs'));
    // Judge EXECUTABLE SQL, not prose: the body carries a comment naming the
    // statement that was removed, and that comment is the point of it.
    const body = fn.slice(0, fn.indexOf('$$;')).replace(/--.*$/gm, '');
    expect(body).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
  });

  it('keeps the job-timeout sweep, which the rejected DELETE was taking down with it', () => {
    expect(MIGRATION).toContain("error_code   = 'timeout'");
    expect(MIGRATION).toMatch(/status IN \('queued','uploading','parsing','mapping','finalizing'\)/);
  });
});

/*
 * ─── THE GUARD ───────────────────────────────────────────────────────────────
 *
 * Measured on the live catalogue, 12 September 2026:
 *
 *     has_any_aml_role             57 policies
 *     current_user_can_*           39 policies
 *     has_role                     33 policies
 *     has_aml_write_role           21 policies
 *     has_aml_role                 17 policies
 *     can_access_client_fact_find   9 policies
 *
 * An RLS policy is evaluated as the querying role, so revoking EXECUTE makes
 * every one of those 176 policies raise `permission denied for function`
 * instead of returning a boolean. The authorisation layer does not fail open —
 * it fails, everywhere, at once.
 *
 * The residual risk is accepted and small: a caller who already knows a user's
 * UUID can learn whether that user holds a role. The escalation this class
 * usually carries is already closed, because every SECURITY DEFINER function
 * in `public` and `aml` pins its `search_path` — zero exceptions, verified.
 */
describe('the recommendation that would have caused an outage', () => {
  const ORACLES = [
    'has_role',
    'has_aml_role',
    'has_any_aml_role',
    'has_aml_write_role',
    'can_access_client_fact_find',
    'current_user_can_view',
    'current_user_can_edit',
    'current_user_can_delete',
  ];

  it.each(ORACLES)('does not revoke EXECUTE on %s — 176 RLS policies call these', (fn) => {
    const revokes = [...MIGRATION.matchAll(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.([A-Za-z0-9_]+)/gi)]
      .map((m) => m[1]);
    expect(revokes).not.toContain(fn);
  });

  /*
   * An EXPLICIT list, not a count, so adding a revoke is a deliberate edit with
   * a reason rather than a number that quietly goes up. Three functions are
   * revoked and none of them is called from a policy predicate:
   *
   *   enforce_step_up_session_owner            trigger body, no arguments
   *   validate_property_comparison_report_types trigger body, no arguments
   *   gc_pdf_import_jobs                        the nightly GC in section 4
   *
   * The GC is the one that needs saying. `CREATE OR REPLACE` preserves an
   * existing function's ACL, and on this project that ACL is already correct
   * (`postgres=X, service_role=X`). But replayed onto an empty database — a
   * restore, a preview branch, a fresh clone — the same statement is a plain
   * CREATE, which grants EXECUTE to PUBLIC, and `anon` inherits it. Its 03:17
   * cron job runs as `postgres`, which owns it, so the revoke cannot touch the
   * scheduled run.
   */
  it('revokes exactly the three functions no policy calls', () => {
    const revokes = [...new Set(
      [...MIGRATION.matchAll(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.([A-Za-z0-9_]+)/gi)]
        .map((m) => m[1]))].sort();
    expect(revokes).toEqual([
      'enforce_step_up_session_owner',
      'gc_pdf_import_jobs',
      'validate_property_comparison_report_types',
    ]);
  });

  /*
   * The GC's revoke is only sound because nothing in an RLS predicate calls it.
   * Asserted rather than assumed: `check-migration-security.mjs` is what asked
   * for the revoke, and this is the other half of that judgement.
   */
  it('and the GC it revokes is server-side only, granted back to service_role', () => {
    expect(MIGRATION).toContain(
      'REVOKE EXECUTE ON FUNCTION public.gc_pdf_import_jobs() FROM PUBLIC;');
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.gc_pdf_import_jobs() TO service_role;');
  });

  it('records why, so the next reader does not "finish the job"', () => {
    expect(MIGRATION).toContain('IT DOES NOT REVOKE EXECUTE ON THE ROLE ORACLES');
    expect(MIGRATION).toContain('176 policies');
  });
});

/*
 * Two more audit findings were deliberately left alone because the obvious fix
 * breaks a working feature. Pinned so the reasoning travels with the code.
 */
describe('what was deliberately not changed', () => {
  it('marketing_intelligence_reports keeps its team-wide read', () => {
    expect(MIGRATION).toContain('IT DOES NOT RE-SCOPE `marketing_intelligence_reports`');
    expect(MIGRATION).not.toMatch(/CREATE POLICY[^;]*marketing_intelligence_reports/i);
  });

  it('template-import-assets stays public until stored URLs are migrated', () => {
    expect(MIGRATION).toContain('IT DOES NOT MAKE `template-import-assets` PRIVATE');
    expect(MIGRATION).not.toMatch(/UPDATE\s+storage\.buckets/i);
  });
});
