#!/usr/bin/env node
/**
 * Negative tests for the string-matching security gates.
 *
 * ## Why this exists
 *
 * Most gates in `scripts/security/` assert a security property by grepping the
 * source for the exact line that implements it. That is cheap and it has caught
 * real regressions, but it has a failure mode that is invisible from the inside:
 * when the implementation is legitimately refactored, the literal stops
 * matching, the gate fails for a reason that has nothing to do with security,
 * and the only two ways out look identical from the diff — re-point the
 * assertion at the new code (correct), or loosen it until it passes (a silent
 * hole).
 *
 * Five gates had drifted this way at once, all of them hidden behind an earlier
 * failing step in the same CI job. Re-pointing them is only trustworthy if the
 * re-pointed assertion still bites, so that is what this file checks: for each
 * gate, it removes the control from a throwaway copy of the tree and asserts the
 * gate FAILS. A gate that passes on mutated source is not a gate.
 *
 * ## How
 *
 * Gates read their targets with paths relative to the process cwd, so each case
 * runs against a mirror of the repository built from symlinks — real directories
 * only along the path to the mutated file, symlinks for everything else. Nothing
 * in the working tree is written to, so a crash cannot leave a dirty checkout or
 * a half-reverted security control behind.
 *
 * Add a case whenever you add or re-point a literal-matching gate.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const root = resolve(process.cwd());

/**
 * Every case: run `gate`, having replaced `find` with `replace` in `file`.
 * `find` must appear in the real file — a case whose anchor has itself drifted
 * would otherwise silently test nothing, which is the very fault this guards.
 */
const CASES = [
  {
    // The fabricated-data gate must notice a deleted generator coming back.
    // This mutation re-points the ABS service's honest refusal at the ghost
    // `getMockABSData(` — the invented-demographics generator removed on
    // 2026-09-06 — which trips the ghost-name check whatever else survives.
    gate: 'check-fabricated-data.mjs',
    file: 'supabase/functions/abs-data-service/index.ts',
    what: 'the ABS demographics fabricator returns',
    find: 'sourceUnavailable(',
    replace: 'getMockABSData(',
    all: true,
  },
  {
    gate: 'check-agent-tool-policies.mjs',
    file: 'supabase/functions/ai-dashboard-agent/index.ts',
    what: 'agent trace log stops checking for the superadmin role',
    find: ".eq('role', 'superadmin')",
    replace: ".eq('role', 'staff')",
  },
  {
    gate: 'check-agent-tool-policies.mjs',
    file: 'supabase/functions/ai-dashboard-agent/index.ts',
    what: 'agent trace log stops scoping reads to the requesting user',
    find: "is_rolled_back').eq('user_id', userId!)",
    replace: "is_rolled_back')",
  },
  {
    gate: 'check-csrf-coverage.mjs',
    file: 'supabase/functions/agent-insights-runner/index.ts',
    what: 'a cookie-auth function stops enforcing CSRF',
    find: 'enforceCsrf',
    replace: 'noopCsrf',
    all: true,
  },
  {
    // The case above only ever proved the gate could see a BARE `verifyAuth`.
    // It could not see `verifyAuthOrNativeUser` — `\bverifyAuth\b` requires a
    // non-word character after the name — so twelve cookie-authenticated
    // functions were outside the gate entirely while it printed "passed". This
    // case is anchored on one of them, so widening the regex to `verifyAuth\w*`
    // is proven to bite rather than merely believed to.
    gate: 'check-csrf-coverage.mjs',
    file: 'supabase/functions/render-template-pdf/index.ts',
    what: 'a verifyAuthOrNativeUser function stops enforcing CSRF',
    find: 'enforceCsrf',
    replace: 'noopCsrf',
    all: true,
  },
  {
    gate: 'check-step-up-session-binding.mjs',
    file: 'supabase/functions/security-step-up/index.ts',
    what: 'a step-up proof is bound to the pre-rotation session again',
    find: 'bound_session_id: boundSessionId,',
    replace: 'bound_session_id: staffSession.id,',
  },
  {
    gate: 'check-step-up-session-binding.mjs',
    file: 'supabase/functions/security-step-up/index.ts',
    what: 'the rotated session id is no longer carried into the binding',
    find: 'boundSessionId = rot.newSessionId;',
    replace: '/* rebinding removed */',
  },
  {
    gate: 'check-storage-upload-hardening.mjs',
    file: 'supabase/functions/secure-storage/index.ts',
    what: 'a human caller can set the storage upsert flag',
    find: 'upsert: isInternal ? upsert === true : false',
    replace: 'upsert: upsert === true',
  },
  {
    gate: 'check-storage-upload-hardening.mjs',
    file: 'supabase/functions/secure-storage/index.ts',
    what: 'a human upload path is caller-chosen rather than server-generated',
    find: 'uploadPath = `${uploadBinding.clientId || uploadBinding.objectClientId || uploadBinding.ownerUserId || actorId}/${crypto.randomUUID()}',
    replace: 'uploadPath = `${path}',
  },
  {
    gate: 'check-migration-version-collisions.mjs',
    file: 'supabase/migrations/MIGRATION_VERSION_COLLISIONS.json',
    what: 'a real migration-version collision is dropped from the frozen inventory',
    // The baseline is what makes the gate quiet about 42 historical collisions;
    // if losing an entry did not turn it red, the inventory would be a place to
    // hide a new one.
    find: '"version": "20261112000000"',
    replace: '"version": "20261112999999"',
  },
  {
    gate: 'check-migration-version-collisions.mjs',
    file: 'supabase/migrations/MIGRATION_VERSION_COLLISIONS.json',
    what: 'a version that is fourteen digits but not a moment any calendar holds',
    // Ten files here carry one — minute 96 of an hour, hours 24 to 30 — and
    // Postgres accepts every one, because `version` is text. Dropping the freeze
    // must turn the gate red, or the inventory is a place to hide the eleventh
    // rather than a record of the ten.
    find: '"20260730240000",',
    replace: '',
  },
  {
    gate: 'check-migration-withdrawals.mjs',
    file: 'supabase/migrations/MIGRATION_WITHDRAWN.json',
    what: 'a withdrawal declares absent an object its file never creates',
    // Drift compares the database against what the FILE would make. An absent
    // object the file does not create can never be found, so the declaration
    // could never be shown false and drift would stop watching the file.
    find: '"absent": ["index:uq_aml_verification_attempt"]',
    replace: '"absent": ["index:uq_aml_verification_attempts"]',
  },
  {
    gate: 'check-migration-withdrawals.mjs',
    file: 'supabase/migrations/MIGRATION_WITHDRAWN.json',
    what: 'a withdrawal names no object at all',
    // An empty `absent` is the same silence by a shorter route: nothing in it
    // can exist, so the entry is true whatever the database holds.
    find: '"absent": ["function:public.builder_accept_current_terms"]',
    replace: '"absent": []',
  },
  {
    gate: 'check-migration-withdrawals.mjs',
    file: 'supabase/migrations/MIGRATION_WITHDRAWN.json',
    what: 'a withdrawal names a migration that does not exist',
    // A mistyped file name hides nothing and tells every reader something
    // false: drift keeps reporting the real file, and Mission Control keeps
    // counting it as a hole, while the manifest says it was settled.
    find: '"file": "20260724000000_prevent_duplicate_portfolio_publications.sql"',
    replace: '"file": "20260724000000_prevent_duplicate_portfolio_publication.sql"',
  },
  {
    gate: 'check-migration-ledger-writes.mjs',
    file: 'supabase/migrations/20261219050000_market_sales_first_loads_where_empty.sql',
    what: 'a migration re-arms a delivered file by deleting its ledger row',
    // The shortcut this file exists to avoid. Its first loads went nowhere on
    // the clones, and the quick repair is to delete `20261214000000`'s row so
    // Mission Control delivers that file again. That DELETE runs on every
    // database the file reaches, and on each it edits rows the database's
    // own deliveries wrote.
    find: `select public.market_sales_refresh('{"stage": "approvals"}'::jsonb)`,
    replace: "delete from supabase_migrations.schema_migrations where version = '20261214000000';\n"
      + `select public.market_sales_refresh('{"stage": "approvals"}'::jsonb)`,
  },
  {
    gate: 'check-migration-ledger-writes.mjs',
    file: 'supabase/migrations/20261219050000_market_sales_first_loads_where_empty.sql',
    what: 'the same ledger write, quoted and handed to EXECUTE',
    // Comments are stripped before the scan and strings are not, so a
    // statement inside a string is still a statement.
    find: `select public.market_sales_refresh('{"stage": "approvals"}'::jsonb)`,
    replace: "do $body$ begin execute 'DELETE FROM \"supabase_migrations\".schema_migrations "
      + "WHERE version = ''20261214000000'''; end $body$;\n"
      + `select public.market_sales_refresh('{"stage": "approvals"}'::jsonb)`,
  },
  {
    gate: 'check-migration-security.mjs',
    file: 'supabase/migrations/20261119150000_revoke_public_execute_trigger_bodies.sql',
    what: 'a revoke names anon and authenticated but not PUBLIC, so it removes nothing',
    // The defect this catches SHIPPED. 20261119140000 revoked EXECUTE on two
    // trigger bodies `FROM anon, authenticated`; one was already closed and
    // `validate_property_comparison_report_types` — SECURITY DEFINER, holding
    // `=X/postgres` — stayed executable by anon. A no-op revoke succeeds, so
    // the migration reported success and the audit finding stayed open.
    //
    // Dropping PUBLIC from this file restores exactly that state, because the
    // rule asks whether ANY migration revokes PUBLIC on the function rather
    // than whether this text looks right.
    find: 'FROM PUBLIC, anon, authenticated;',
    replace: 'FROM anon, authenticated;',
  },
  {
    gate: 'check-edge-column-names.mjs',
    file: 'supabase/functions/market-updates-embed-backfill/index.ts',
    what: 'an Edge Function selects a column its table does not have',
    // The real defect, restored: `market_updates` has `ai_summary` and no
    // `summary`, so every batch errored and this backfill had never embedded a
    // single update.
    find: ".select('id, title, ai_summary, why_it_matters')",
    replace: ".select('id, title, summary, why_it_matters')",
  },
  {
    gate: 'check-market-digest-authz.mjs',
    file: 'supabase/functions/market-updates-digest/index.ts',
    what: 'the digest idempotency lookup drops the period key',
    find: ".eq('period', period).eq('period_key', periodKey).maybeSingle()",
    replace: ".eq('period', period).maybeSingle()",
  },
  {
    gate: 'check-market-digest-authz.mjs',
    file: 'supabase/functions/market-updates-digest/index.ts',
    what: 'the digest spends on the provider before resolving idempotency',
    find: "if (existingDigest && existingDigest.status === 'published') return json",
    replace: "if (false) return json",
  },
  {
    gate: 'check-auth-rate-limit-coverage.mjs',
    // Moved by WP-28: both `custom-auth-login` and `-v2` are now shims onto
    // this handler, so this is where the ceiling is consumed for both. The
    // harness caught the stale anchor itself, which is the whole point of it.
    file: 'supabase/functions/_shared/customAuth/login.ts',
    what: 'the staff login stops consuming a source-keyed rate limit',
    find: 'const rateLimit = await enforceAuthRateLimit(supabase, req, {',
    replace: 'const rateLimit = await noopRateLimit(supabase, req, {',
  },
  {
    gate: 'check-auth-rate-limit-coverage.mjs',
    file: 'supabase/functions/client-portal-forgot-password/index.ts',
    what: 'a recovery limiter goes back to the caller-controlled X-Forwarded-For',
    find: 'const gate = await beginAuthRateLimit(supabase, req, {',
    replace:
      "const _ip = req.headers.get('x-forwarded-for'); const gate = await beginAuthRateLimit(supabase, req, {",
  },
  {
    gate: 'check-password-leak-coverage.mjs',
    file: 'supabase/functions/client-portal-reset-password/index.ts',
    what: 'a reset path stops breach-checking the new password',
    find: 'const strength = await validatePasswordStrength(new_password)',
    replace: 'const strength = { isValid: true, error: null }',
  },
  {
    gate: 'check-password-leak-coverage.mjs',
    file: 'supabase/functions/_shared/passwordValidation.ts',
    what: 'the shared policy stops reaching the Have I Been Pwned check',
    find: 'checkLeakedPasswordWithTimeout',
    replace: 'noopLeakCheck',
    all: true,
  },
  {
    gate: 'check-portal-session-client-storage.mjs',
    file: 'src/hooks/usePortalData.ts',
    what: 'the client portal token goes back into localStorage',
    find: "import { portalSessionBodyFields, portalSessionHeaders } from '@/lib/portalSession';",
    replace:
      "const PORTAL_SESSION_KEY = 'portal_session_token';\n" +
      "const portalSessionHeaders = () => ({ 'x-portal-session-token': localStorage.getItem(PORTAL_SESSION_KEY) || '' });\n" +
      'const portalSessionBodyFields = () => ({});',
  },
  {
    gate: 'check-admin-authorization-server-side.mjs',
    file: 'supabase/functions/admin-user-management/index.ts',
    what: 'a privileged action is handled before the superadmin gate',
    find: "    // Actions that don't require superadmin auth\n    if (action === 'verify_invite') {",
    replace:
      "    // Actions that don't require superadmin auth\n" +
      "    if (action === 'delete_user') { /* moved above the gate */ }\n" +
      "    if (action === 'verify_invite') {",
  },
  {
    gate: 'check-client-bundle-secrets.mjs',
    file: 'src/hooks/useGoogleFonts.ts',
    what: 'a Google API key is hardcoded into the browser bundle again',
    find: "const { data, error } = await invokeSecureFunction<{",
    replace:
      "      await fetch('https://www.googleapis.com/webfonts/v1/webfonts?key=AIzaSyAPjKmIVPd3M30RFnb1pCqJ1fT-BaKkPNI');\n" +
      '      const { data, error } = await invokeSecureFunction<{',
  },

  // ── WP-16: the twelve gates that had never run ───────────────────────────
  // Two of these four found live defects the first time they executed, so they
  // are exactly the gates most worth proving can still fail.
  {
    gate: 'check-cors-contract.mjs',
    file: 'supabase/functions/push-unsubscribe/index.ts',
    what: 'a credentialed endpoint goes back to answering a wildcard origin',
    find: 'Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));',
    replace: 'Deno.serve(async (req: Request) => __corsWrappedHandler(req));',
  },
  {
    gate: 'check-client-portfolio-authz.mjs',
    file: 'supabase/functions/calculate-borrowing-capacity/index.ts',
    what: 'borrowing-capacity stops binding the request to a client the actor may see',
    find: 'if (!await canAccessClient(supabase, actor, clientId)) {',
    replace: 'if (false) {',
  },
  {
    gate: 'check-solicitor-intelligence-authz.mjs',
    file: 'supabase/functions/solicitor-portal-intelligence/index.ts',
    what: 'portfolio matter reads stop resolving the per-client permission matrix',
    find: "        if (permissions && can(permissions, 'matters', 'view')) visibleClientIds.push(clientId);",
    replace: '        visibleClientIds.push(clientId);',
  },

  // ── WP-17: the database's own gate ───────────────────────────────────────
  {
    gate: 'check-applied-body-digests.mjs',
    file: 'supabase/migrations/20250827173834_c6923655-f82f-42ad-8561-6e348ff74015.sql',
    what: 'a migration this deployment has already RUN is edited',
    // Not a literal-matching gate — it compares sha256 of the file against the
    // SQL the ledger holds — but the same failure mode applies: a manifest that
    // no longer covers what it names passes every run and guards nothing.
    //
    // The consequence is not local. Mission Control decides what a clone may be
    // sent by these bytes, and `partitionByDependency` treats a withheld version
    // as a barrier, so editing one applied migration can withhold every runnable
    // migration behind it from the whole fleet.
    //
    // The mutation adds a statement rather than touching whitespace or a
    // comment, deliberately: those two ARE discounted by rungs 1 and 2, and a
    // case that mutated one would assert the opposite of the rule.
    find: '-- Create the missing update function',
    replace: '-- Create the missing update function' + '\nSELECT 1; -- planted',
  },
  {
    gate: 'check-migration-security.mjs',
    file: 'supabase/migrations/20260909000000_wp17_secdef_drift_remediation.sql',
    what: 'a SECURITY DEFINER function lands with no search_path and no EXECUTE revoke',
    find: 'ALTER VIEW public.partner_agreement_retention_register SET (security_invoker = true);',
    replace:
      'CREATE OR REPLACE FUNCTION public.wp17_negative_probe(_x uuid)\n'
      + "RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $probe$ SELECT true $probe$;\n"
      + 'ALTER VIEW public.partner_agreement_retention_register SET (security_invoker = true);',
  },
  {
    gate: 'check-gates-wired.mjs',
    file: '.github/workflows/ci.yml',
    what: 'a security gate is dropped from CI and left orphaned',
    find: '          node scripts/security/check-cors-contract.mjs\n',
    replace: '',
  },

  // ── WP-19: the exposure-class CORS rule ──────────────────────────────────
  // Distinct from the case above: that one proves the transport-tracing rule
  // still bites, this one proves the registry-class rule does — the rule that
  // catches a function no `invokeSecureFunction('name')` literal points at.
  {
    gate: 'check-cors-contract.mjs',
    file: 'supabase/functions/template-share/index.ts',
    what: 'a browser-session function is unwrapped and left answering a wildcard',
    find: 'Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));',
    replace: 'Deno.serve(async (req: Request) => __corsWrappedHandler(req));',
  },

  {
    gate: 'check-public-validation.mjs',
    file: 'supabase/functions/abs-employment-service/index.ts',
    what: 'an unauthenticated endpoint goes back to an unbounded req.json()',
    find: 'const __parsed = await parseJsonBody(req, LocalityRequest, corsHeaders, PUBLIC_SERVICE_MAX_BODY_BYTES);\n    if (!__parsed.ok) return __parsed.response;\n    const { suburb, state, postcode } = __parsed.data;',
    replace: 'const { suburb, state, postcode } = await req.json();',
  },

  // WP-29. A direct dependency that outruns the pinned React breaks `npm ci`
  // on every job of every PR — the install step, before any test or gate.
  {
    gate: 'check-peer-compatibility.mjs',
    file: 'package-lock.json',
    what: 'a direct dependency requires a React the project does not have',
    // Mutate the EXISTING peer range rather than prepending a second
    // `peerDependencies` key — JSON.parse keeps the last of a duplicate pair, so
    // the real entry silently won and the control removed nothing.
    find: '"@react-leaflet/core": "^2.1.0"\n      },\n      "peerDependencies": {\n        "leaflet": "^1.9.0",\n        "react": "^18.0.0",',
    replace: '"@react-leaflet/core": "^2.1.0"\n      },\n      "peerDependencies": {\n        "leaflet": "^1.9.0",\n        "react": "^19.0.0",',
  },

  // WP-28. The v1 entrypoint must be held to the same rule as v2. Without this
  // control the shim pattern is a way to remove a function from a gate's
  // coverage without removing it from production: `check-public-validation`
  // skipped both custom-auth logins for exactly that reason and reported a
  // passing count that no longer included them.
  {
    gate: 'check-public-validation.mjs',
    file: 'supabase/functions/_shared/customAuth/login.ts',
    what: 'the shared staff-login handler goes back to an unbounded req.json()',
    find: 'const __body = await parseJsonBody(req, StaffLoginRequest, corsHeaders, AUTH_MAX_BODY_BYTES);\n    if (!__body.ok) return __body.response;\n    const { username, password, turnstile_token } = __body.data;',
    replace: 'const { username, password, turnstile_token } = await req.json();',
  },

  // The same gate, the class WP-27 added to it. A separate control because
  // widening `UNAUTHENTICATED` is the kind of change that looks done and does
  // nothing: the control above passes whether or not `public-auth` is in that
  // set, so on its own it could never have told anyone the extension worked.
  {
    gate: 'check-public-validation.mjs',
    file: 'supabase/functions/client-portal-login/index.ts',
    what: 'a portal login goes back to an unbounded, unchecked req.json()',
    find: 'const __body = await parseJsonBody(req, PortalLoginRequest, corsHeaders, AUTH_MAX_BODY_BYTES)\n    if (!__body.ok) return __body.response\n    const { email, password, turnstile_token } = __body.data',
    replace: 'const { email, password, turnstile_token } = await req.json()',
  },

  // ── WP-24: the four items that were closed and ungated ───────────────────
  {
    gate: 'check-baseline-invariants.mjs',
    file: 'supabase/functions/aml-finance/index.ts',
    what: 'a generic SQL-execution RPC appears (item 6)',
    find: '      const upsertResp = payload.id',
    replace: "      await aml.rpc('exec_sql', { q: body.q });\n      const upsertResp = payload.id",
  },
  {
    gate: 'check-baseline-invariants.mjs',
    file: 'src/components/admin/ResetPasswordDialog.tsx',
    what: 'user HTML is injected with no sanitiser (item 8)',
    find: 'export',
    replace: 'const Bad = () => <div dangerouslySetInnerHTML={{ __html: (window as any).x }} />;\nexport',
  },
  {
    gate: 'check-baseline-invariants.mjs',
    file: 'supabase/functions/aml-finance/index.ts',
    what: 'a submitted secret is compared against a stored column (item 9)',
    find: '      const comparisonRow =',
    replace: '      if (body.pw === user.password_hash) { /* bypasses the hash verifier */ }\n      const comparisonRow =',
  },

  // ── WP-20: field allowlists at the write ─────────────────────────────────
  // The alias hop matters: the first version of this gate stopped at
  // `const alertRow = a` without following `a` back to `body.alert`, so this
  // exact mutation walked straight through it.
  {
    gate: 'check-mass-assignment.mjs',
    file: 'supabase/functions/aml-monitoring/index.ts',
    what: 'an AML alert write goes back to taking the raw request sub-object',
    find: 'const alertRow = pickAllowed(a, ALERT_WRITABLE);',
    replace: 'const alertRow = a;',
  },

  // ── WP-18: opaque 5xx ────────────────────────────────────────────────────
  {
    gate: 'check-error-disclosure.mjs',
    file: 'supabase/functions/send-email-reply/index.ts',
    what: 'a 500 goes back to handing the caller the caught exception',
    find: "JSON.stringify(internalError(error, 'send-email-reply'))",
    replace: "JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })",
  },

  {
    gate: 'check-error-disclosure.mjs',
    file: 'supabase/functions/_shared/aml/standaloneVerification.ts',
    what: 'the console carve-out widens from a literal message to any expression',
    /* The carve-out admits `console.warn('literal', JSON.stringify({ … }))`
       because that is a log line and the log is where the detail belongs. It
       must admit ONLY a literal: an expression in that position could carry
       the very leak this gate exists to catch, and the object beside it is
       still built inside a catch block. */
    find: "console.warn('[aml-verification] token reserve unavailable', JSON.stringify({",
    replace: 'console.warn(logPrefix(err), JSON.stringify({',
  },

  // ── A stand-down that is never handed the value that arms it ─────────────
  {
    /* The object-index check stands itself down on a clone via
       `indexIsCarriedNotAuthored`, which reads
       `process.env.BACKEND_DEPLOYED_BY`. The logic shipped and the `env:`
       mapping did not, so it read `undefined`, failed closed as designed, and
       asserted a claim no clone can satisfy — stopping the cascade pull
       request on all three clones at once from 17 Sep 2026.

       Renaming the mapped key is the same starvation with the wiring still
       visibly present, which is the version hardest to spot in review. */
    gate: 'check-gate-env-wiring.mjs',
    file: '.github/workflows/ci.yml',
    what: 'the step running the object-index check stops mapping BACKEND_DEPLOYED_BY',
    find: 'BACKEND_DEPLOYED_BY: ${{ vars.BACKEND_DEPLOYED_BY }}',
    replace: 'DEPLOYED_BY: ${{ vars.BACKEND_DEPLOYED_BY }}',
  },

  {
    /* The seed-skeleton check stands down on the same marker, and its step is
       a second mapping of the same line — so the case above, which rewrites
       the FIRST occurrence, never reaches it. Anchored on the step's own run
       line so it removes this mapping and no other. */
    gate: 'check-gate-env-wiring.mjs',
    file: '.github/workflows/ci.yml',
    what: 'the step running the seed-skeleton check stops mapping BACKEND_DEPLOYED_BY',
    find:
      'BACKEND_DEPLOYED_BY: ${{ vars.BACKEND_DEPLOYED_BY }}\n'
      + '        run: npm run migrations:seed-skeletons:check',
    replace:
      'DEPLOYED_BY: ${{ vars.BACKEND_DEPLOYED_BY }}\n'
      + '        run: npm run migrations:seed-skeletons:check',
  },

  {
    /* The seed-currency comparison stands down on the same marker, from a
       third mapping of the same line in another job. Starved, it said "the
       seed has never been written" on every clone — the one red check on
       npc-client-dashboard#245 on 24 Sep 2026, and Mission Control merges no
       cascade pull request with a red check. Anchored on its own run line. */
    gate: 'check-gate-env-wiring.mjs',
    file: '.github/workflows/ci.yml',
    what: 'the step running the seed-currency check stops mapping BACKEND_DEPLOYED_BY',
    find:
      'BACKEND_DEPLOYED_BY: ${{ vars.BACKEND_DEPLOYED_BY }}\n'
      + '        run: npm run templates:library:seed:check',
    replace:
      'DEPLOYED_BY: ${{ vars.BACKEND_DEPLOYED_BY }}\n'
      + '        run: npm run templates:library:seed:check',
  },

];

/**
 * Mirror `root` into `dest` with symlinks, materialising real directories only
 * where an override needs one, and write the overridden contents.
 */
function mirror(dest, overrides) {
  const realDirs = new Set();
  for (const rel of overrides.keys()) {
    const parts = rel.split('/');
    for (let i = 0; i < parts.length - 1; i++) realDirs.add(parts.slice(0, i + 1).join('/'));
  }
  const walk = (rel) => {
    const absSrc = rel ? join(root, rel) : root;
    const absDest = rel ? join(dest, rel) : dest;
    mkdirSync(absDest, { recursive: true });
    for (const entry of readdirSync(absSrc, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory() && realDirs.has(childRel)) { walk(childRel); continue; }
      if (overrides.has(childRel)) continue; // written below
      symlinkSync(join(absSrc, entry.name), join(absDest, entry.name));
    }
  };
  walk('');
  for (const [rel, content] of overrides) {
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    writeFileSync(join(dest, rel), content);
  }
}

const failures = [];
let checked = 0;

for (const test of CASES) {
  const original = readFileSync(join(root, test.file), 'utf8');
  if (!original.includes(test.find)) {
    failures.push(
      `${test.gate}: the anchor for "${test.what}" is not in ${test.file} any more `
      + `(looked for ${JSON.stringify(test.find)}). This negative test is not testing anything — `
      + `re-point it at the control as it is written now.`,
    );
    continue;
  }
  const mutated = test.all
    ? original.split(test.find).join(test.replace)
    : original.replace(test.find, test.replace);
  if (mutated === original) { failures.push(`${test.gate}: mutation for "${test.what}" changed nothing`); continue; }

  const dir = mkdtempSync(join(tmpdir(), 'gate-negative-'));
  try {
    mirror(dir, new Map([[test.file, mutated]]));
    // `gatePath` for the checks that live outside scripts/security/ — the two
    // per-portal ones. The gate itself is run from the real tree (only its cwd
    // is the mirror), so it must resolve its targets from process.cwd().
    const gateFile = test.gatePath
      ? join(root, ...test.gatePath.split('/'))
      : join(root, 'scripts', 'security', test.gate);
    const run = spawnSync(process.execPath, [gateFile], {
      cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    checked++;
    if (run.status === 0) {
      failures.push(
        `${test.gate} PASSED with the control removed (${test.what}). The gate does not `
        + `detect this regression: it is asserting something other than the property it claims.`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length) {
  console.error(`Security gate negative tests FAILED:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Security gate negative tests passed (${checked} controls removed, ${checked} gates failed as required).`);
