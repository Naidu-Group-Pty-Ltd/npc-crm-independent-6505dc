# Builder / Developer Portal — Release Readiness Report

**Branch:** `claude/builder-portal-release-readiness-2avkat`
**Starting `origin/main` SHA:** `39cfb4b7dca1409865e469aa5fdb79fada2fe7f6`
**Date:** 2026-08-01
**Production project (read-only throughout):** `dduzbchuswwbefdunfct`

---

## 1. Outcome

The programme reached **Completion Condition C — verified external blocker**, together with
Condition B (no staging write authorisation was given in this session).

> **There is no staging Supabase project.** No project available to this account is a
> non-production environment for the NPC Property Dashboard. Steps 16–21 of the programme
> (staging database deployment, function deployment, synthetic fixtures, deployed browser
> testing, staging security isolation) could not be executed and **were not simulated**.

Everything that does not depend on staging was completed: the implementation review, the
Solicitor and backend parity reviews, the security review, the controlled-rollout plane, the
Builder readiness function, the Command Centre release controls, the local test suites, the
read-only production inspection, the deployment manifests, and the production and rollback
runbooks.

**Production received no writes, no deployments, no secret changes, no storage changes, no
synthetic data and no rollout changes.**

---

## 2. Recounted baseline

Every number below was recounted from the repository at the starting SHA. The historical
figures quoted in the task description were treated as baselines to verify, not as facts.

| Item | Historical | **Actual at `39cfb4b`** |
|---|---|---|
| Total migration files | — | **765** |
| Builder migration files | — | **14** (15 after this branch) |
| Builder Edge Function directories | 23 | **23** ✓ |
| Solicitor Edge Function directories | — | 14 |
| Total Edge Function directories | — | 385 |
| Builder external pages (`src/pages/builder`) | 25 | **24** ✗ |
| Builder admin panels | — | 7 (8 after this branch) |
| Builder DB assertions | 1076 | **1076** ✓ (1186 after this branch) |
| Builder contract tests | 576 | **576** ✓ (622 after this branch) |
| Builder E2E tests | 91 | **91** ✓ |
| Cross-portal contract tests | 4 | **4** ✓ |

The page count is the one figure that did not reconcile: `src/pages/builder` contains **24**
`.tsx` files, not 25. The 37 figure that a naive `find` produces includes
`src/components/templateBuilder/*` and `src/pages/admin/TemplateBuilder*.tsx`, which belong to
the PDF template builder and have nothing to do with the Builder Portal.

---

## 3. Implementation verification (Step 2)

The Builder Portal in `main` is genuinely complete across all eight domains. Verified by
inspecting the implementation, not by reading prior reports.

| Domain | Migration | Verified |
|---|---|---|
| Identity and governance | `20260801000000`–`20260801000600`, `20260802000000` | ✅ organisations, users, memberships, roles, deny-by-default permissions, hashed cookie-only sessions, invitations, login, logout, password reset/change, organisation selection, version-exact terms, mandatory onboarding, session/membership revocation, suspension, internal administration |
| Projects | `20260803000000` | ✅ developments, projects, parties, status history, access, internal and external surfaces |
| Inventory | `20260804000000` | ✅ stages, buildings, lots, units, availability, pricing, holds, reservations, allocations, unit detail |
| Transactions | `20260805000000` | ✅ transactions, pipeline stages, case links, parties, status history |
| Construction | `20260806000000` | ✅ cases, stages, milestones, progress updates, date history, photographs |
| Delivery | `20260807000000` | ✅ variations, approvals, progress claims, inspections, defects, practical completion, handover, warranty, claims |
| Collaboration | `20260808000000` | ✅ documents, versions, grants, conversations, participants, messages, tasks, assignments, notifications |
| Workspace | `20260809000000` | ✅ dashboard summary, activity, organisation settings, user preferences |

Navigation was checked against the E2E suite: all 91 Builder E2E tests pass, including
`phase2-portal-shell.e2e.ts`, which asserts desktop/mobile navigation agreement and that no
placeholder route remains. Commit `69c98bc` ("Retire the 'later module still disabled'
navigation assertions") removed the stale disabled-button assertions before this branch began.

---

## 4. Defects found and corrected

| # | Severity | Defect | Correction |
|---|---|---|---|
| D1 | **Blocker** | **No Builder rollout write path.** `20260801000400` generalised the rollout tables and added the read path (`resolve_cross_portal_feature_mode_for`) but no write path. The only mutation command, `set_cross_portal_firm_rollout(_firm_id, …)`, takes a solicitor firm and writes `portal='solicitor'`. A Builder rollout could only be changed by direct SQL — which the delivery rules forbid. **The Builder Portal was un-releasable.** | New guarded command `set_cross_portal_rollout_for(portal, owner_id, feature_key, to_mode, reason, actor, actor_type, expected_version)` |
| D2 | **Blocker** | **No Builder readiness evaluation.** `get_cross_portal_cutover_readiness` hardcodes solicitor-only evidence: `solicitor_matter_access_migration_exceptions`, plaintext `solicitor_portal_users.session_token`, legal `document_versions`, `transaction_case_reconciliation_issues`. Evaluating a Builder organisation with it is meaningless. | New `get_builder_cutover_readiness(organisation_id, feature_key)` with Builder-specific evidence, explicit not-applicable checks and fail-closed unknowns |
| D3 | **High** | **`shadow` opened the external portal.** `ROLLOUT_ENABLED_MODES` included `shadow`. For Solicitor, shadow means "new path runs in the background while legacy still serves". Builder has no legacy path, so the very first transition `off → shadow` would have opened the portal to real external users with **no observation stage at all**. | `ROLLOUT_ENABLED_MODES` reduced to `{'cutover'}`; shadow is now the genuine pre-live provisioned-and-verifiable stage |
| D4 | **High** | **No optimistic concurrency on the rollout row.** Two operators — one advancing, one rolling back — would silently last-write-win on the single mutable row in the release plane. | `row_version` column + bump trigger; command returns 400 without `expected_version` and 409 when stale |
| D5 | **High** | **Approvals written directly from the Edge Function.** The Solicitor plane `.upsert()`s `cross_portal_cutover_approvals` from `legal-matters-admin` and logs audit afterwards, so a failed audit leaves an unevidenced approval. | `record_cross_portal_approval_for` / `revoke_cross_portal_approval_for` guarded commands, audit in the same transaction |
| D6 | **High** | **No approval revocation path.** The Solicitor plane can set `revoked_at` but exposes no command, and records neither who revoked nor why. | `revoke_cross_portal_approval_for`, plus `revoked_by` and `revoke_reason` columns |
| D7 | **Medium** | **Audit written after commit.** `legal-matters-admin` calls `logStaff(...)` after the RPC returns. A failed audit write cannot roll the transition back. | Builder transitions call `builder_log_activity` **inside** the command; it raises rather than swallowing, so a failed audit aborts the transition. Proven by test: `a transition whose audit write fails is rejected` + `the state change was rolled back with the failed audit` |
| D8 | **Medium** | **`builder_portal_admin_v1` gates nothing.** Defined in `20260801000400` with zero runtime consumers. Presenting it as a control would be false. | Marked `runtime_consumed = false`; the Command Centre renders it "Descriptive only" and never offers it as protection |
| D9 | **Medium** | **No Command Centre release controls.** `/admin/builder-portal` had no readiness, rollout, approval, history, health or rollback surface. Solicitor has `CrossPortalCutoverPanel` and `OperationalObservabilityPanel`. | New `AdminBuilderReleasePanel`, mounted as a Release tab |
| D10 | **Low** | **Audit entity types did not cover the release plane.** `builder_portal_activity_log.entity_type` CHECK predates it. | Extended additively with `rollout` and `rollout_approval` |

---

## 5. Release blockers NOT fixed on this branch

These are recorded as failing required readiness evidence rather than silently patched. The
readiness function makes them mechanically block cutover — a release cannot proceed while they
stand, regardless of what any report claims.

### B1 — Builder documents have no malware scanning or quarantine (**release blocker**)

`builder_document_versions` carries `storage_path`, `file_name`, `content_type`, `byte_size`,
`checksum` — and **no `malware_scan_status`, no `lifecycle_status`, no quarantine state and no
processing state**. The Solicitor immutable-document service has all of them; its readiness
check counts `document_versions WHERE lifecycle_status IN (...) AND malware_scan_status <> 'clean'`.

A Builder organisation can therefore upload a file and another organisation's user with a
document grant can download it, with nothing having scanned it.

The task specifies "treat absent required malware scanning as a release blocker". It is
expressed as two required readiness checks:

- `builder_document_malware_scanning` → **fail**, detail `RELEASE BLOCKER: builder_document_versions has no malware_scan_status/lifecycle_status; uploads are neither quarantined nor scanned`
- `no_unsafe_builder_documents` → **unknown** (no scan state to evaluate), and unknown-and-required fails closed

**Why it was not fixed here:** generalising the shared immutable-document service to Builder
means storage quarantine buckets, a scanning worker, processing states, signed-URL lifecycle and
download-time permission re-checks. None of that can be validated without a staging environment
with real storage and a real scanning provider. Shipping an unexercised malware pipeline would be
worse than shipping a hard block. The design is specified in
[`33-document-and-message-safety.md`](./33-document-and-message-safety.md).

### B2 — Builder notifications are not delivered through a transactional outbox

`builder_notifications` is a direct insert with a pointer to the source record (`scope_type`,
`scope_id`, `entity_kind`, `entity_id`) and a `read_at` flag. There is no outbox, no delivery
state, no idempotency key, no retry and no dead-letter path. The Solicitor Phase 6/8 architecture
uses a transactional outbox with retry and dead-letter handling.

The pointer design is genuinely good — a notification carries no copy of the record's contents,
so a stale notification cannot leak a withdrawn one — and in-portal notifications are read from
the database rather than pushed. The gap is real but narrower than it first appears: it matters
for **email** notification delivery, which is not yet wired for Builder.

Recorded as residual risk R3 rather than a hard blocker, because no Builder notification
currently leaves the database.

### B3 — Repository-wide duplicate migration versions (**deployment blocker**)

19 migration version prefixes are shared by two or more files, several by five to eight:

```
20260725000000  ×5    20260725110000  ×8    20260725101000  ×3
20260723000000  ×2    20260724000000  ×2    20260724030000  ×2    … 13 more
20260730130000  ×2  ← in the Builder deployment path
20260717000000  ×2  ← includes a Builder migration
```

`supabase_migrations.schema_migrations.version` is the primary key, so only one file per version
can ever be recorded. This is **pre-existing on `main`** and repository-wide, not Builder-specific.
It is not fixed here because doing so means editing merged migration files, which the delivery
rules forbid. See [`36-migration-manifest.md`](./36-migration-manifest.md) §4.

### B4 — Builder migrations are inseparable from the Solicitor Phase 1–15 backlog

Production is 84 migrations behind the repository. `supabase db push` would apply **35** pending
migrations of which only **14** are Builder. The Builder migrations have hard dependencies on the
unapplied Solicitor phases — `20260801000400` alters `cross_portal_*` tables created by Phase 15,
and `20260801000300_portal_terms_multi_portal` generalises the Phase 3 terms tables.

**There is no safe Builder-only deployment set.** See [`36-migration-manifest.md`](./36-migration-manifest.md) §3.

---

## 6. Local validation results (Step 22)

Every command re-run on this branch. These are actual current results.

| Command | Result |
|---|---|
| `builder:db:verify` (Phase 1) | ✅ **135/135** |
| `builder:db:verify:phase2` | ✅ **73/73** |
| `builder:db:verify:phase3` | ✅ **117/117** |
| `builder:db:verify:inventory` | ✅ **136/136** |
| `builder:db:verify:transactions` | ✅ **111/111** |
| `builder:db:verify:construction` | ✅ **110/110** |
| `builder:db:verify:delivery` | ✅ **115/115** |
| `builder:db:verify:collaboration` | ✅ **184/184** |
| `builder:db:verify:workspace` | ✅ **95/95** |
| `builder:db:verify:release` *(new)* | ✅ **110/110** |
| **Builder database assertions total** | ✅ **1186/1186** |
| `test:builder-portal` | ✅ **622/622** (576 baseline + 46 new) |
| `test:e2e:builder-portal` | ✅ **91/91** |
| `test:cross-portal-contracts` | ✅ **4/4** |
| `security:builder-portal` | ✅ passed (23 Edge Functions, 42 browser sources) |
| `security:solicitor-portal` | ✅ passed (14 Edge Functions) |
| `builder:types:check` | ✅ types up to date |
| `npx tsc --noEmit` | ✅ clean |
| scoped `eslint` (changed files) | ✅ clean |
| `builder:db:reset` | ✅ "No Builder Portal migration failed on its own merit" |
| `npm run build` | ✅ built in 1m 31s |
| `test:solicitor-portal` | ⚠️ **116/117** — pre-existing, reproduced on pristine main |
| `audit:style` | ⚠️ regressed — pre-existing, reproduced on pristine main |
| `typecheck:portals` | ⚠️ 4 errors — pre-existing, reproduced on pristine main |
| `typecheck:builder-edge` | ✅ clean (23 Builder Edge Functions, Deno 2.9.4) |

### Pre-existing failures, each reproduced against pristine `main`

Reproduced by `git stash push -u` (removing every change on this branch), re-running, and
confirming byte-identical output.

1. **`test:solicitor-portal` 116/117.** `phase1-matter-access.test.mjs:36` — *"all five Solicitor
   resource functions use the shared matter resolver"*. `solicitor-portal-matters/index.ts` still
   references `resolveClientPermissions` / `listAssignedClientIds`. Identical on pristine main.
   Solicitor-owned; out of Builder scope.

2. **`audit:style` ratchet regression.** Identical counts with and without this branch:
   `hexLiterals 800 → 846`, `inlineColorStyles 320 → 343`, `fontHardcoded 94 → 97`,
   `cssHexOutsideTokens 15 → 25`. **This branch adds zero new violations** — the new
   `AdminBuilderReleasePanel` uses only semantic tokens (`text-success`, `text-warning`,
   `text-muted-foreground`, `text-destructive`, `bg-muted/40`).

3. **`typecheck:portals` 4 errors.** All four in Solicitor files this branch never touches:
   `TransactionCasesPanel.tsx(16,42)`, `clientLegalWorkspace.ts(4,56)`,
   `SolicitorMatterDetail.tsx(548,24)` — `Property 'env' does not exist on type 'ImportMeta'`;
   `SolicitorMatterDetail.tsx(806,15)` — `Type 'string | null' is not assignable to type 'string'`.

### Environment note

`typecheck:builder-edge` and the PostgreSQL-backed verification suites both needed the toolchain
installed into this container first (Deno 2.9.4; a local PostgreSQL 16.13 cluster on port 55432).
Both were installed and both suites ran for real — the database assertions above are live
execution against PostgreSQL, not static analysis.

---

## 7. Read-only production inspection (Step 12)

Full detail in [`35-production-read-only-reconciliation.md`](./35-production-read-only-reconciliation.md).

| Finding | Value |
|---|---|
| Migrations applied | **681** (repository has 765) |
| Latest applied version | `20260802093000` |
| **Builder migrations applied** | **0 of 14** |
| Builder tables present | **0** (`builder_invoices`, `build_progress_payments` are Finance-owned) |
| Builder functions present | **0** |
| Builder policies present | 1 (on the Finance-owned `builder_invoices`) |
| `cross_portal_*` tables | 6 present — via `20260730221326`, not via `20260730300000` |
| `cross_portal_firm_rollouts.portal` column | **absent** — generalisation not applied |
| Feature definitions | 8, all Solicitor; **no Builder keys** |
| Rollout rows / approvals | **0 / 0** |
| **Builder Edge Functions deployed** | **9 of 23** |

### 🔴 Production anomaly PA-1

**Nine Builder Edge Functions are deployed to production against a database that has no Builder
schema at all.**

Deployed: `builder-portal-login`, `-verify`, `-logout`, `-accept-invite`, `-invite`,
`-forgot-password`, `-reset-password`, `-change-password`, `-admin`.

Every one queries `builder_portal_users`, `builder_organisations` or `builder_portal_sessions` —
none of which exist. They would fail at runtime.

**Assessed exposure: none.** The failure is fail-closed at two independent layers:
`resolve_cross_portal_feature_mode_for` does not exist in production, so `isRolloutEnabled()`
catches the error and returns `false`; and every table read would error before any data could be
returned. The portal is unreachable, not leaky.

It remains a genuine hygiene defect: functions were deployed ahead of their schema. The
production runbook orders database before functions to prevent recurrence.

---

## 8. Staging determination (Step 14)

Three Supabase projects are visible to this account. None is a staging environment for this
application:

| Project | Ref | Assessment |
|---|---|---|
| NPC Property Dashboard | `dduzbchuswwbefdunfct` | **PRODUCTION.** Read-only throughout. Never a substitute. |
| Aurixa Systems | `moeyytuduycrvvncdtme` | **Not staging.** A different application — 9 tables (`catalog_*`, `leads`), 2 migrations, 11 `storefront-*`/`catalog-sync` functions. No Builder, Solicitor or NPC schema. |
| Lazarus | `erxksncxitczkrluvsgb` | **Not staging.** A different application — `songs`, `videos`, `merch`, `journal_entries`, `profiles`, `user_roles`, all empty. |

Neither non-production project is explicitly identified as staging, and neither is a replica of
the NPC Property Dashboard (765 migrations, ~51 domain tables). The task forbids substituting
production and forbids creating a paid cloud project automatically.

**Conclusion: no staging environment exists. Steps 16–21 are blocked.**

What is required to resume is set out in
[`40-staging-deployment-checkpoint.md`](./40-staging-deployment-checkpoint.md).

---

## 9. Residual risk register

| # | Risk | Severity | Status |
|---|---|---|---|
| R1 | Builder documents are neither quarantined nor malware-scanned | **High** | Blocks cutover via required readiness evidence |
| R2 | No staging environment; the plane is proven locally and by contract, never against deployed infrastructure | **High** | External blocker |
| R3 | Builder notifications have no outbox, retry or dead-letter path | Medium | Accepted while no Builder notification leaves the database |
| R4 | 19 duplicate migration versions repository-wide | Medium | Pre-existing; documented, deployment set must be explicit |
| R5 | Builder migrations inseparable from 21 unrelated pending migrations | Medium | Documented; requires an explicit deployment decision |
| R6 | 9 Builder Edge Functions deployed to production without schema | Low | Fail-closed; runbook orders database first |
| R7 | `builder_portal_admin_v1` gates nothing | Low | Marked `runtime_consumed = false` and surfaced as descriptive |

---

## 10. Where execution resumes

1. Provision or nominate a non-production Supabase project that is **not** `dduzbchuswwbefdunfct`.
2. Supply its project ref, application origin, and service-role credentials.
3. Grant explicit staging deployment authorisation.
4. Resume at [`40-staging-deployment-checkpoint.md`](./40-staging-deployment-checkpoint.md) §7,
   which lists the exact migrations, functions, secrets, storage and fixtures to apply.
