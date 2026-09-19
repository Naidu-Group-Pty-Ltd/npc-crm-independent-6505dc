# Builder / Developer Portal — Phase 1 completion report

| Field | Value |
| --- | --- |
| Phase | 1 — Identity and Access Foundation |
| Branch | `claude/builder-portal-phase-1` |
| Baseline commit | `43b67c8ed4879435d2f8b0dd4e6635fc2be98058` (merge of PR #1747, Phase 0) |
| Supabase project inspected | `dduzbchuswwbefdunfct` — "NPC Property Dashboard" (read-only) |
| Production deployment | **Not applied.** Migrations are finished and locally verified, awaiting explicit authorisation. |
| Status | Complete, with alignment-review corrections P1–P4 applied. Phase 2 not started. |

## 1. What was built

Identity and access only. No development, project, stage, lot, unit,
reservation, sale, construction milestone, variation, progress claim,
inspection, defect, handover or warranty object exists.

### Migrations (7, timestamped, all additive)

| Migration | Contents |
| --- | --- |
| `20260801000000_builder_portal_phase1_organisations_users.sql` | `builder_organisations`, `builder_portal_users`, `builder_organisation_memberships`, touch/guard triggers, RLS |
| `20260801000100_builder_portal_phase1_permissions.sql` | `builder_permission_keys`, `builder_role_default_permissions`, `builder_membership_permissions`, `builder_active_membership()`, `builder_accessible_organisations()`, `builder_resolve_permission()` |
| `20260801000200_builder_portal_phase1_sessions.sql` | `builder_portal_sessions`, `builder_issue_session()`, `builder_resolve_session()`, `builder_revoke_session()`, `builder_revoke_user_sessions()`, revocation triggers |
| `20260801000300_portal_terms_multi_portal.sql` | GEN-01 / GEN-02 — portal terms generalised to Builder with pre- and post-migration assertions |
| `20260801000400_cross_portal_rollout_org_generalisation.sql` | GEN-10 — cutover control plane generalised to Builder organisations |
| `20260801000500_builder_portal_admin_module.sql` | `builder_portal_admin` registration + `solicitor_portal_admin` drift repair |
| `20260801000600_builder_portal_activity_log.sql` | Trusted fail-closed audit log and six guarded access-control commands (correction P4) |

No migration drops a table, column or policy. No migration truncates or deletes
production rows. Five `NOT NULL` constraints are relaxed: one on
`portal_terms_acceptances.solicitor_user_id` (ADR 021) and four on
`cross_portal_*.firm_id`, each replaced by a stronger discriminated-owner CHECK.

### Tables created (8)

`builder_organisations` · `builder_portal_users` ·
`builder_organisation_memberships` · `builder_permission_keys` ·
`builder_role_default_permissions` · `builder_membership_permissions` ·
`builder_portal_sessions` · `builder_portal_activity_log`

### Tables changed (7, all additively)

`portal_terms_versions` (portal CHECK widened) ·
`portal_terms_acceptances` (+`builder_user_id`, owner CHECKs, per-portal unique
indexes) · `cross_portal_feature_definitions` (+`portal`) ·
`cross_portal_firm_rollouts`, `cross_portal_rollout_history`,
`cross_portal_dual_read_comparisons`, `cross_portal_cutover_approvals`,
`cross_portal_reconciliation_runs` (+`portal`, +`builder_organisation_id`,
owner CHECKs, per-portal unique indexes) · `dashboard_modules` (two rows)

## 2. Key design decisions

**Organisation types.** Four: `developer`, `builder`, `builder_developer`,
`sales_representative`. A developer and a builder may be separate organisations;
`builder_developer` covers the entity that is both. Organisations are never
auto-created from free-text builder names — `client_deals`,
`build_progress_payments` and `builder_invoices` are not read by anything in
Phase 1.

**Roles are broad and stable; job titles are not roles.** Five membership roles
(`owner`, `administrator`, `manager`, `member`, `read_only`) stored as `text`
with a `CHECK`, never a Postgres enum (Phase 0 MIG-09). The eleven job titles
from the Phase 0 assessment — development manager, site supervisor, contract
administrator, defects coordinator and the rest — live in a display-only
`job_title` column and grant nothing. A contract test asserts none of them became
a database value.

**Membership is the only binding.** `builder_portal_users` has no
`organisation_id` column, so a user cannot belong to an organisation without an
auditable, revocable, time-bounded membership row.

**Deny-by-default, corrected from the Solicitor model.** The resolver denies in
this order: forbidden key → unknown key → no active membership → unconfigured key
→ role default → membership override (explicit `deny` wins) → `read_only` clamp.
There is no `DEFAULT_ALLOW_KEYS` equivalent and no OR-merge, so there is no legacy
resolution path to roll back to (Phase 0 NOCOPY-01).

**Sessions are cookie-only from the first commit.** `token_hash` is
`CHECK (token_hash ~ '^[0-9a-f]{64}$')`, so a raw token is not a storable value.
`builder_issue_session()` accepts a hash the Edge Function computed and rejects
anything else; `builder_resolve_session()` returns `(session_id, builder_user_id,
absolute_expires_at)` and nothing token-shaped. No plaintext token column exists
anywhere, so nothing needs migrating away later (Phase 0 NOCOPY-02).

**Project-level scope is prepared, not enabled.** `builder_membership_permissions`
carries `scope_type` already permitting `development`/`project`/`stage`/`unit`, so
Phase 2 needs no constraint swap — but a trigger rejects any non-organisation
scope with `BUILDER_SCOPE_NOT_AVAILABLE`, because storing an identifier nothing
can verify is worse than not storing it.

## 3. Permissions implemented

Three independent layers, because one layer is a single point of failure:

1. `builder_permission_keys.is_forbidden` — the sixteen restricted keys
   (`income`, `expenses`, `assets`, `liabilities`, `employment`,
   `borrowing_capacity`, `serviceability`, `commissions`, `aml_restricted`,
   `smr`, `mlro`, `legal_privileged`, `conflict_checks`, `finance_private`,
   `command_private`, `solicitor_private`) are catalogued and hard-denied inside
   `builder_resolve_permission()`.
2. A database trigger rejects storing a grant for a forbidden key
   (`BUILDER_FORBIDDEN_PERMISSION_KEY`).
3. `builder-portal-admin` strips unknown and forbidden keys server-side before
   any write and reports them as `rejected_keys`.

`finance_status`, `legal_status` and `settlement_status` are `inbound_projection`
keys whose edit and delete levels can never resolve true.

## 4. RLS policies

Every one of the eight Builder tables has RLS enabled with exactly one policy,
scoped `TO service_role` with the grounded predicate
`auth.role() = 'service_role'`. **No policy uses an unrestricted `USING (true)`.**
There is no `anon` or `authenticated` policy at all, so RLS denies them outright,
and `REVOKE ALL ... FROM anon, authenticated` removes the table privilege as
well. The resolver and session functions are revoked from `PUBLIC`, `anon` and
`authenticated` and granted only to `service_role`.

Anonymous denial is verified by executing `SET LOCAL ROLE anon` and asserting
`permission denied`, not by inspecting policy text.

## 5. Session security

| Requirement | Mechanism |
| --- | --- |
| Only hashes stored | `CHECK (token_hash ~ '^[0-9a-f]{64}$')` |
| Raw tokens never persisted | No token column exists; `builder_issue_session()` rejects non-hashes |
| Raw tokens never returned | `builder_resolve_session()` returns identity columns only |
| Expiry | `absolute_expires_at`, sliding `idle_expires_at`, `CHECK (idle <= absolute)` |
| Revocation | `revoked_at` + mandatory `revoked_reason`; re-checked inside the touch `UPDATE` to close the concurrent-revoke race |
| Multiple sessions | Per-user index; revoke-one and revoke-all both supported |
| Password-reset invalidation | `trg_builder_user_session_revocation` fires on `password_changed_at` |
| Membership loss | `trg_builder_membership_session_revocation` revokes when the last membership goes |
| Separate from Solicitor | Own table, own functions, own cookie name; the DDL has no solicitor dependency |
| CSRF | `enforceCsrf()` on every mutating admin operation |
| No browser storage | The admin page calls the Edge Function; no Builder token reaches the browser at all in Phase 1 |

## 6. Shared systems generalised

**Portal terms (GEN-01/GEN-02, ADR 021).** Discriminated owner: nullable
`solicitor_user_id` and `builder_user_id`, both real foreign keys, with
`num_nonnulls(...) = 1`, a portal/owner agreement CHECK, a trigger matching the
acceptance portal to the version portal, and per-portal partial unique indexes.
The replacement uniqueness is created **before** the old constraint and the
`NOT NULL` are dropped. A generic unenforced `user_id` was explicitly rejected.

**Rollout controls (GEN-10).** All five `cross_portal_*` tables take a `portal`
discriminator and a `builder_organisation_id` foreign key; `firm_id` becomes
nullable; exactly-one-owner CHECKs are added `NOT VALID` then `VALIDATE`d. No
Builder-only rollout system was created.
`resolve_cross_portal_feature_mode(_firm_id, _feature_key)` is unchanged as the
Solicitor compatibility adapter; `resolve_cross_portal_feature_mode_for(_portal,
_owner_id, _feature_key)` is the new portal-aware entry point. A trigger prevents
a Builder rollout governing a solicitor-owned feature.
`cross_portal_rollout_reconciliation` is the reconciliation surface —
`portal_mismatch` and `orphaned_owner` must both be false for every row.
Rollback capability is preserved: the `mode` CHECK is untouched.

## 7. Solicitor compatibility

Verified by execution, not inspection:

- the existing terms version and acceptance are preserved with their owner
- duplicate solicitor acceptance is still rejected
- existing rollout, history, approval, dual-read and reconciliation rows are
  preserved and still solicitor-owned
- `resolve_cross_portal_feature_mode()` returns the same answer for the same
  arguments
- `solicitor_portal_sessions` gains no Builder column
- the reconciliation view is clean
- `npm run test:solicitor-portal`, `npm run test:cross-portal-contracts` and
  `npm run security:solicitor-portal` are unchanged from baseline

## 8. Internal administration

- `builder_portal_admin` registered in `dashboard_modules` with route
  `/admin/builder-portal`, **in the same migration that first uses it** —
  the gap `solicitor_portal_admin` had.
- `solicitor_portal_admin` drift repaired. Production inspection confirmed the
  row exists there, so this was migration-corpus drift, not a missing
  permission: a fresh environment rebuilt from migrations would have denied
  every non-superadmin user. The insert is idempotent, so it is a no-op on
  production.
- Route guarded with `<ModuleGuard moduleKey="builder_portal_admin">`.
- Server enforcement in `builder-portal-admin`: `verifyAuth()` +
  `requireModulePermission()` + `enforceCsrf()`. Reads require `can_view`,
  mutations require `can_edit` — separate permissions, not one flag.
- Navigation entries added to `DashboardSidebar`, `MobileSidebar` and
  `GlobalCommandPalette`, each carrying the module key. **Hiding navigation is
  not the control** — the route guard and the server check are.
- Minimal admin shell at `src/pages/admin/BuilderPortalAdmin.tsx`: organisations,
  users, memberships. It calls the Edge Function only and never queries Builder
  tables directly.
- `builder-portal-admin` registered in `SECURITY_REGISTRY.json`
  (`module-gated`, `verify_jwt: true`, reviewed) and declared in `config.toml`,
  so it adds no registry drift.

## 9. Tests added

**`tests/builder-portal/phase1-identity-access.test.mjs` — 65 contract tests**,
no database, no network. Migration hygiene, organisation and membership shape,
deny-by-default resolution shape, session invariants, terms ownership, rollout
generalisation, RLS, admin enforcement, frontend wiring, Supabase types, and the
Phase 2 boundary.

**`scripts/builder-portal/local-db/verify-phase-1.mjs` — 102 behavioural
assertions** executed against a live PostgreSQL 16 database. This is the
substantive verification: organisation isolation, active-membership
requirements, cross-organisation denial, deny-by-default, explicit-deny
priority, `read_only` clamping, forbidden keys, session hashing, revocation,
expiry (both absolute and idle), password-reset invalidation, membership-loss
revocation, terms ownership in six forms, Solicitor compatibility, rollout
compatibility and rollback, admin registration, anonymous denial executed as the
`anon` role, the Finance-owned boundary, the Phase 2 boundary, and concurrency.

**Phase 0 tests updated (3 files).** Seven Phase 0 assertions were designed to
fail when Phase 1 landed — Phase 0 stated that the widening PR must update them
in the same change so the new shape is reviewed rather than absorbed silently.
Done: the greenfield assertions now assert the Phase 1 state and still guard the
Phase 2 boundary; the `solicitor_portal_admin` gap test is inverted to assert the
repair; the GEN-01/02/10 constraint tests now assert the landed widenings.

Two Phase 0 tests were also strengthened: `SEC-06` and `SEC-05` matched raw file
text, so they matched the *comment* documenting the boundary. They now strip
comments and additionally assert the query form, making them real gates rather
than prose detectors.

## 10. Commands run and results

### Passed

| Command | Result |
| --- | --- |
| `npm run builder:db:verify` | **102/102 assertions passed** against live PostgreSQL 16 |
| `npm run test:builder-portal` | **148 tests, 148 pass, 0 fail** (65 Phase 1 + 83 Phase 0) |
| `npm run builder:db:reset` | 753 migrations; 469 applied; **0 Builder defects** |
| `npm run builder:phase-0-inspect` | passed (phase-aware; reports Phase 1 landed) |
| `npm run builder:types:check` | types up to date and generation is idempotent |
| `npm run test:cross-portal-contracts` | 4 tests, 4 pass, 0 fail |
| `npm run security:solicitor-portal` | passed |
| `npm run security:registry` | 26 issues — **identical to baseline**; the new function adds none |
| `npm run build` | ✓ built in 1m 35s |

### Failed — all pre-existing, each verified identical on the stashed baseline

| Command | Result | Baseline |
| --- | --- | --- |
| `npm run test:solicitor-portal` | 117 tests, 1 fail — `phase1-matter-access.test.mjs:36` | identical |
| `npm run typecheck:portals` | **4 errors**, all in Solicitor files | identical: 4 |
| `npm run lint` | 2120 problems (43 errors) | identical |
| `npm run audit:style` | ratchet regressed 846/341/97/25 | identical figures |
| `npm test` (vitest) | 39 files / 53 tests failed, 3719 passed | identical: 39 / 53 / 3719 |
| `npm run security:test` | exit 1 — registry drift for 26 unrelated functions | identical: 26 |

**No new failure of any kind.** The vitest and typecheck baselines were
re-measured with `git stash -u` on this branch and matched exactly.

### Partially blocked, with the mitigation used

**Supabase CLI `db reset` was unavailable.** The CLI installs (v2.111.0) but
requires Docker, and no Docker daemon exists in this environment. PostgreSQL 16
is installed, so a real local cluster was stood up on port 55432 and used
instead. This is genuine execution against real PostgreSQL, not simulation.

**The full migration corpus is not replayable from scratch.** 282 of 753
historical migrations fail on a plain cluster — Supabase-managed extensions
(`pg_net`, `pg_cron`, `vector`), the `supabase_realtime` publication, and objects
created outside the corpus. This is a **pre-existing property of the repository**,
measured identically before any Phase 1 file was written. The cascade means
`legal_matters` is never created, which means Solicitor Phase 3 and Phase 15
never run, which means `portal_terms_*` and `cross_portal_*` do not exist
locally.

Consequence: 2 of the 6 Phase 1 migrations cannot be exercised by a full-corpus
replay. They are exercised instead by
`scripts/builder-portal/local-db/01-upstream-fixture.sql`, which recreates those
upstream objects byte-faithfully from the migrations that own them, verified
against the production schema through the Supabase MCP connection. The reset
script classifies these separately as `Builder dependency: 2` versus
`Builder defects: 0`, so a genuine defect could never hide inside that noise.

## 11. Production deployment status

**Nothing was applied to production.** `apply_migration` was never called.
Supabase MCP was used strictly read-only: `list_projects`, `execute_sql` for
`SELECT`-only introspection of `pg_class`, `pg_constraint`, `pg_policy`,
`information_schema` and row counts.

Production inspection established three facts used in this phase:

1. `portal_terms_versions` has 1 row, `portal_terms_acceptances` has 1 row — the
   GEN-02 migration operates on a single row, so MIG-01 is a structural risk, not
   a volumetric one.
2. All five `cross_portal_*` tables are empty — the GEN-10 backfill is trivial.
3. `solicitor_portal_admin` **is** present in production `dashboard_modules` —
   reclassifying Phase 0 finding NOCOPY-03 from "missing permission" to
   "migration-corpus drift".

The migrations are complete and awaiting authorisation.

## 11a. Solicitor Portal alignment corrections (P1–P4)

An alignment review of PR #1749 against the Solicitor Portal found four confirmed
defects. All four are fixed. Section 3 of that review (optional architectural
differences) was deliberately **not** acted on.

### P1 — `csrfDenied` argument order

`builder-portal-admin` called `csrfDenied(csrf, cors)`. The signature is
`csrfDenied(cors, detail)` and all ~40 other call sites in the repository use
that order. The reversal spread the `CsrfCheckResult` into the response headers
and dropped `Access-Control-Allow-Origin`, so a CSRF denial reached the browser
as a CORS error rather than the intended detail. The request was still denied, so
this was never an authentication bypass.

**Fix:** `csrfDenied(cors, csrf)`. Verified by `deno check` (TS2345 when reversed)
and pinned by two contract tests, one of which reads the helper signature so a
future change to `csrfGuard.ts` fails here rather than silently.

### P2 — service-role actor written into uuid columns

`verifyAuth()` returns the literal string `'service_role'` as the identity for a
verified internal call (`_shared/auth.ts:193`, `:227`). Phase 1 passed that value
straight into eight `uuid` columns and into `_actor_id uuid`. Any service-role
administration call would have failed with `22P02 invalid input syntax for type
uuid`.

**Fix:** the Solicitor guard, verbatim in intent —
`const adminUserId = auth.userId === 'service_role' ? null : auth.userId`.
`auth.userId` remains the identity used for the permission check;
`adminUserId` is the only value that reaches a uuid column. The actor is
recorded honestly as `actor_type = 'service_role'` with a NULL `actor_user_id`
rather than being coerced.

TypeScript cannot catch this — `'service_role'` is a runtime value, not a
distinct type — so it is covered by six live-database assertions including a
direct proof that the literal string is not a storable uuid actor.

### P3 — authentication returned 403 instead of 401

`createForbiddenResponse(message, corsHeaders)` takes two parameters and
hardcodes 403. Phase 1 passed a third `401` argument, which was silently ignored,
so a caller could not distinguish "not signed in" from "not permitted".

**Fix:** authentication failure returns `json({ error }, 401, cors)`;
authorization failure keeps `createForbiddenResponse(message, cors)` at 403 —
the same split `solicitor-portal-admin` uses. Verified by `deno check` (TS2554
with the extra argument).

### P4 — trusted, fail-closed audit for access-control mutations

The Phase 1 report claimed "Phase 1 has no high-risk mutation". That was wrong:
granting and revoking organisation membership is the access-control decision for
the entire portal. Audit was best-effort and swallowed, which is precisely the
Solicitor defect Phase 0 recorded as NOCOPY-04.

**Fix**, using the closest existing Solicitor pattern rather than a new
architecture:

- `builder_portal_activity_log`, modelled on `solicitor_portal_activity_log`,
  carrying actor, action, entity, organisation, target user, previous state, new
  state, reason and timestamp. Append-only: a trigger rejects UPDATE and DELETE.
- `builder_log_activity()` **raises** on failure instead of swallowing — the
  inverse of `logSolicitorActivity()`.
- Six guarded commands perform the state change and the audit write in one
  transaction, so a failed audit aborts the mutation:
  `builder_admin_upsert_membership`, `builder_admin_revoke_membership`,
  `builder_admin_set_user_status`, `builder_admin_set_organisation_status`,
  `builder_admin_set_membership_permissions`,
  `builder_admin_revoke_user_sessions`.

All seven required events are covered: membership granted, membership role
changed, membership revoked, permission overrides changed, user suspended or
revoked, organisation suspended or closed, administrative session revocation.

The existing best-effort operational event remains for observability. It is no
longer the only record.

Fail-closed is proven by execution, not asserted: the harness installs a trigger
that forces every audit insert to fail, then confirms a membership grant and a
user suspension both raise **and leave no state change behind**, and that both
succeed again once audit is restored.

Nothing in the session, membership, permission, terms or rollout model was
redesigned. The guarded commands wrap writes the Edge Function was already
making.

### Edge Function type checking

No `tsconfig` in the repository covers `supabase/functions/`, which is why P1–P3
reached the PR. `npm run typecheck:builder-edge` runs `deno check` against
`builder-portal-admin` and its shared imports only — the other 360 historical
Edge Functions are deliberately untouched.

Proven to catch this defect class by reintroducing each bug:

| Defect | Detected | Error |
| --- | --- | --- |
| P1 reversed `csrfDenied` args | yes | `TS2345` |
| P3 extra status argument | yes | `TS2554` |
| P2 `'service_role'` string | **no** | runtime value, not a type — covered by database tests instead |

### Correction validation

| Command | Result |
| --- | --- |
| `npm run builder:db:verify` | **135/135** (was 102; +33 for P2 and P4) |
| `npm run test:builder-portal` | **166 tests, 166 pass** (was 148; +18) |
| `npm run typecheck:builder-edge` | passed (exit 0) |
| `npm run builder:db:reset` | 754 migrations, 470 applied, **0 Builder defects** |
| `npm run builder:phase-0-inspect` | passed |
| `npm run test:cross-portal-contracts` | 4/4 |
| `npm run security:solicitor-portal` | passed |
| `npm run security:registry` | 26 issues — unchanged from baseline |
| `npm run build` | ✓ built in 1m 34s |

Pre-existing failures, unchanged: `test:solicitor-portal` 1 fail,
`typecheck:portals` 4 errors, `lint` 43 errors, `audit:style` ratchet,
`vitest` 39 files / 53 tests, `security:test` exit 1.

**Production was not modified.** `apply_migration` was never called; the new
migration `20260801000600_builder_portal_activity_log.sql` exists on the branch
and is locally verified only.

## 12. Recommended Phase 2 scope

**Phase 2 — Builder external portal authentication.** Still not the business
domain. The identity foundation exists but nobody can sign in yet.

1. `builder-portal-*` Edge Function family: `login`, `verify`, `logout`,
   `invite`, `accept-invite`, `forgot-password`, `reset-password`,
   `change-password` — one shared `resolveBuilderSession()`, cookie-only.
2. `src/lib/builderPortal.ts` transport: `credentials: 'include'`,
   `X-Portal-Request: builder-portal`, anon key, no browser storage.
3. `/builder/*` route tree: `BuilderPortalAuthProvider` →
   `BuilderPortalProtectedRoute` → `BuilderPortalLayout`, with public auth pages
   outside the protected route and governance pages inside it but outside the
   layout.
4. `builder_onboarding_steps` and the governance gate
   (`builderGovernanceError()`), mirroring `solicitorGovernanceError()`.
5. `scripts/builder-portal/security-check.mjs`, modelled on the Solicitor one.
6. E2E coverage under `tests-e2e/builder-portal/`.

Explicitly **not** Phase 2: developments, projects, stages, lots, units,
reservations, transactions, construction, variations, progress claims,
inspections, defects, handover, warranty, or the `transaction_case_links`
Builder slot (GEN-09).

Carried forward: GEN-03 to GEN-09 and GEN-11 to GEN-13 remain open; the
`phase0-shared-primitive-constraints` suite still pins all of them, and each must
be updated by the phase that performs it.
