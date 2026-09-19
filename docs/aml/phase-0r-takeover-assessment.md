# Phase 0R — Takeover Assessment, Repository Reconciliation & Baseline Sign-off

Governing directive: *Aurixa Systems AML/CTF Tri-Portal Product Completion Report v2.0*
(Claude Fable 5 takeover). This document is the Phase 0R deliverable required by
§23 (Phase 0R) and §26 (Required First Response). It records the verified current
state of the repository **and** the deployed environment before any material
product change. It supplements — and does not replace — `archives/aml-v2/phase-0-audit.md`.

Assessment date: 2026-07-25.
Assessed by: Claude (implementation agent), on branch `claude/aurixa-aml-ctf-takeover-i2jj67`.

---

## 1. Controlling documents read

Confirmed read in full before this assessment: `CLAUDE.md`, `FRONTEND_TOOLING.md`,
`AGENTS.md`, `AGENTS_NPC_Property_Dashboard.md`, `archives/aml-v2/phase-0-audit.md`,
`docs/aml/traceability-matrix.md`, `docs/aml/acceptance-scenarios.md`, and the
Version 2 completion report (60 pages).

## 2. Branch and commit baseline

| Item | Verified value |
|---|---|
| Working branch | `claude/aurixa-aml-ctf-takeover-i2jj67` (from `main`) |
| Base commit | `be61d50` — *Merge pull request #1340 … fix-report-severity-styling-regression* |
| Worktree | clean at assessment start |
| Node / npm | v22.22.2 / 10.9.7 |

## 3. Deployed-environment map (verified live, not assumed)

Three Supabase projects exist in the organisation:

| Project | Ref | Role |
|---|---|---|
| NPC Property Dashboard | `dduzbchuswwbefdunfct` | **Live target.** Hardcoded in `src/integrations/supabase/client.ts:5` and `src/lib/aml/amlPortalApi.ts:5` |
| Aurixa Systems | `moeyytuduycrvvncdtme` | Separate project (created 2026-07-14); not referenced by this codebase |
| Lazarus | `erxksncxitczkrluvsgb` | Not referenced by this codebase |

Verified state of the live project (`dduzbchuswwbefdunfct`):

- **Edge functions:** all 18 `aml-*` functions deployed and `ACTIVE`, versions current
  (v131–v145, last updated 2026-07-25). 329 functions deployed in total.
- **Migrations: PARITY GAP.** 589 migrations applied; latest applied version is
  `20260724154759`. The repository contains **32 newer migration files**
  (`20260724160000` … `20260725130000`) that are **not applied** to the live
  database. Spot-check confirmed the gap is real, not a bookkeeping artifact:
  `public.is_active_aml_role_identity()` (from
  `20260725098000_require_active_aml_role_identities.sql`) **does not exist** live, and
  `public.has_aml_role()` is **not self-scoped** live
  (`20260725110000_self_scope_public_aml_role_checks.sql` unapplied).
  ⇒ Part of the recent security-hardening baseline exists only in the repo, while the
  edge functions (which are current) may assume the newer DB objects.
- **`aml` schema:** ~70 tables live — substantially more than the Phase 0 audit lists,
  including `entities`, `entity_case_links`, `beneficial_owners`,
  `authorised_representatives`, `finance_comparisons`, `finance_discrepancies`,
  `finance_case_handoff_tokens`, `evidence_references`, `documents`,
  `document_versions`, `document_requirements`, `submission_versions`, `decisions`,
  `case_conditions`, `client_requests`, `source_of_funds`, `source_of_wealth`,
  `identity_checks`, `screening_checks`, `screening_matches`, `match_resolutions`,
  `counterparty_cases`, `counterparty_attempts`, `records_audit_events`,
  `tipping_off_rules`, `report_submissions`, `report_receipts`.
- **Operational data: effectively empty.** `aml.cases` = 0 rows, `aml.consents` = 0,
  `aml.documents` = 0, `aml.case_events` = 0, `aml.finance_comparisons` = 0.
  13 active `aml.role_assignments`; 1 `aml.tenant_settings` row; 3 `aml.plan_tiers`.
  **The AML module is deployed but has never been used in production.** Historic-data
  migration risk (activation Model A/B, status split) is therefore near zero, but all
  migrations must still be reversible per the directive.
- **Providers:** `aml.provider_configs` = 0 rows — no live IDV/screening provider is
  configured (simulator-only posture).
- **Scheduled processes:** one active AML cron job — `aml-monitoring-hourly`
  (`15 * * * *`). 35 cron jobs total on the project.

## 4. Live feature-flag values (queried 2026-07-25)

| Flag | Live value | Consequence |
|---|---|---|
| `aml_ctf` | **enabled: true** | AML module is ON in production |
| `aml_v3_nav` | false | Production renders the **legacy V2 shell** |
| `aml_v3_start_client_compliance` | false | Client-record activation button hidden |
| `aml_v3_compliance_home` | false | V3 Compliance Home not rendered |
| `aml_v3_case_workspace` | false | V3 case workspace behaviour off |
| `aml_v3_regulatory_hub` | false | — |
| `aml_v3_terminology_editor` | false | — |
| `aml_v3_metrics_relocation` | false | — |
| `aml_v3_org_settings` | false | — |
| `aml_purchase_ready_gate` | enabled: false | Extra flag, not in the V2 report's list |
| `aml_settlement_gate` | enabled: false | Extra flag, not in the V2 report's list |

Production is a **pure V2 state** (not mixed): every V3 flag is off. All V3 work is
present in code but dormant. `StartClientComplianceButton` returns `null` in
production today, so the *only* currently reachable case-creation surfaces are on
`/admin/aml/cases`.

## 5. Baseline test results (executed 2026-07-25 in the takeover environment)

| Command | Result | Detail |
|---|---|---|
| `npm run build` | ✅ PASS | 1m 45s; chunk-size warnings only |
| `npm run lint` | ❌ FAIL (pre-existing) | 2,268 problems — **41 errors**, 2,227 warnings on unmodified `main` |
| `npm run audit:style` | ❌ FAIL (pre-existing) | Ratchet regressed on unmodified `main`: paletteClasses 105→313, hexLiterals 800→844, inlineColorStyles 320→340, fontHardcoded 94→97, cssHexOutsideTokens 15→25 |
| `npm test` (vitest) | ❌ FAIL (pre-existing) | 24/2,980 failures, all pre-existing on `main`; AML suites pass — see §5.1–5.2 |
| `npm run security:registry` | ❌ FAIL (pre-existing) | `mission-control-invoices` and `mission-control-payment-methods` exist on disk but are missing from `SECURITY_REGISTRY.json` (non-AML surfaces) |
| `npm run security:static` | ✅ PASS | 462 files scanned |
| `npm run security:edd-boundary` | ✅ PASS | EDD/MLRO boundary checks pass |
| `npm run security:edge-check` | ⚠️ NOT RUNNABLE HERE | Requires a configured Deno toolchain; in this container `deno` type-checking fails resolving `npm:` specifiers (`Could not find "@supabase/supabase-js" in a node_modules folder`) even after `deno install`. **Unverified risk:** edge-function type regressions would not be caught in this environment. Operator command: `PATH=$HOME/.deno/bin:$PATH npm run security:edge-check` on a machine with the repo's standard Deno setup (CI runs this). |
| `npm run test:e2e` | ⚠️ NOT RUN in Phase 0R | Playwright e2e requires a running app + authenticated env config. Deferred to the phase gates that change UI behaviour; operator command: `npm run test:e2e`. |

None of the failures above were introduced by this takeover — they are the recorded
state of `main` at commit `be61d50`. Per the directive they are logged, not silently
fixed, and the lint/style/registry failures are candidates for an early hygiene fix
so later phase gates have a green baseline to ratchet against.

### 5.1 Vitest results

- **AML suites (`npx vitest run src/lib/aml`): ✅ PASS — 5 files, 10 tests, 0 failures.**
- Scoped baseline set from the phase-0 audit §9
  (`npx vitest run src/branding src/utils src/lib/aml`): ❌ 17 failed / 122 passed
  across 19 files. Every failing file is **outside** the AML surface:
  `scenarioDeltaEngine.test.ts` (5), `commercialAssessmentEngine.test.ts` (5),
  `scenarioModellingEngine.test.ts` (2), `tenYearCashFlow.test.ts` (2),
  `BrandProvider.persistence.test.tsx` (2, `useAuth` provider wiring in the test
  environment), `commercial.test.ts` (1). Pre-existing on unmodified `main`;
  recorded, not fixed, in this phase (see I-02).
- Full `npm test` result recorded below (§5.2).
- Tooling note: `npm ci` **fails on unmodified `main`** — `package-lock.json` is out
  of sync with `package.json` (missing `@simplewebauthn/browser@10.0.0` /
  `@simplewebauthn/types@10.0.0` entries). Folded into I-02.

### 5.2 Full-suite result (`npm test`)

❌ FAIL (pre-existing): 270 test files, 2,980 tests — **24 failed, 2,954 passed,
2 skipped** (148 s). Failing files are the same non-AML engines/branding suites as
§5.1 plus report-template suites (`applyCriticalContainment`, `cascadeMap`,
`codeIntake`, `reconciliationBrowser`, `investmentGradeResolution`) and **one
AML-surface file**: `src/pages/aml/AmlConfiguration.test.tsx` (1 of 2 tests).
That AML failure is a test-assertion artifact, not a product defect: the test
expects pretty-printed `JSON.stringify(..., null, 2)` output via
`toHaveTextContent`, which whitespace-collapses the rendered text, so the
multi-line expected string can never match — an environment/matcher-version
mismatch. The `StructuredTerminologyEditor` behaviour under test (blank override
rows remain visible) passes its sibling assertion. Recorded, not fixed, per the
Phase 0R rule; the fix belongs to the I-02 baseline-hygiene follow-up.

Failure count varies slightly between runs (24 vs 17 in the scoped set overlap;
one run showed 15 failing files vs 12 in a re-run), indicating some flakiness in
the non-AML suites — also noted under I-02.

Incident note (environment, not repo): the first full-suite attempt in this
container hung because running `deno install` (attempting to satisfy
`security:edge-check`) rewrote `node_modules` into Deno's layout mid-run. A clean
`npm install` restored normal execution. No repository change resulted.

## 6. AML route and component map

Confirmed unchanged from `archives/aml-v2/phase-0-audit.md` §1: 16 legacy routes under
`/admin/aml/*` (all wrapped in `AmlGuard`), Client Portal AML at `/client/aml`,
Finance Portal snapshot at `/finance/aml-snapshot/:token`.
**No `/admin/aml/cases/:caseId` full-page route exists** — case detail is the
`CaseDetailSheet` side sheet (`sm:max-w-2xl`, ≈672 px) inside `AmlCases.tsx`.
Detailed per-file findings are in §8–§11 below.

## 7. Database, RPC and edge-function map

- Data layer: `aml` schema (~70 tables, §3), exposed **only** through SECURITY DEFINER
  RPCs and the 18 `aml-*` edge functions; no direct PostgREST access (per `AGENTS.md` §3).
- Public bridge: `public.get_aml_roles_for_user(_user_id uuid)` (SECURITY DEFINER) —
  live; the self-scoping hardening for `public.has_aml_role()` is in the repo but
  **not yet applied** (§3 migration gap).
- Frontend API layer: 13 modules under `src/lib/aml/` calling edge functions via
  `invokeAmlFunction` → `invokeSecureFunction`; portal calls use
  `x-portal-session-token`.
- Case events are hash-chained (`prev_hash` / `row_hash`) in `aml.case_events` via
  `appendEvent` in `supabase/functions/aml-cases/index.ts:72-123`.

## 8. Case-creation pathways (every current entry point)

Server-side, exactly **two** code paths insert into `aml.cases`
(`supabase/functions/aml-cases/index.ts`):

| Op | Line | Guardrails |
|---|---|---|
| `create` | 211–240 | Role (analyst/MLRO) + non-empty `subject_display_name` **only**. `client_id` optional and unvalidated. No human confirmation, no activation event, no duplicate-open guard, no client-active check. |
| `activate_client` | 242–357 | Full guardrail set: role, `client_id` UUID-shape, client exists + `is_active`, `activation_model` A/B, `activation_event` (≥3 chars), `reason` (≥10 chars), `human_confirmed`, duplicate-open-case 409, Model B tenant gate (`legal_approval` + `program_version`), hash-chained `case_created` event. |

User-facing entry points (three):

1. **`New case` button** — `src/pages/aml/AmlCases.tsx:147-149` → `CreateCaseDialog`
   (`amlCasesApi.create`, never passes `client_id`). **Bypasses every activation
   guardrail; produces orphaned cases.** V2 directive: remove from normal production
   use; retain only as an authorised migration/remediation exception.
2. **`Activate client` button on the Cases page** — `AmlCases.tsx:225` →
   `ActivateClientDialog` with **no prefill**: the operator must hand-type a raw
   client UUID (`Client ID (UUID)` field, placeholder `00000000-…`). Violates the
   "no raw UUID entry in ordinary workflow" rule.
3. **`Start Client Compliance`** — `ClientDetailsModal.tsx:303-308` →
   `StartClientComplianceButton` → `ActivateClientDialog` prefilled with the client.
   This is the V2-required production pathway, but it is behind
   `aml_v3_start_client_compliance` = **false** in production, so it is currently
   unreachable. It is also gated client-side on `aml.view` only, so read-only
   viewers see a button that will always 403 server-side.

Additional server-side weaknesses noted for Phase 1/3 (no fix in Phase 0R):

- Duplicate-open guard is read-then-write — no unique partial index on
  `aml.cases (client_id) where status not in (cleared, closed, blocked)`; concurrent
  activations can race.
- Case reference `AML-<year>-<count+1>` is generated from a count query — racy,
  non-unique under concurrency.
- Hash chain orders by `created_at` (not a monotonic sequence) — same-millisecond
  appends can fork the chain.
- `activate_client`'s `tenant_settings` read uses `.maybeSingle()` with no filter and
  no error check — a second tenant row would silently disable Model B with a
  misleading `model_b_not_approved` message.

## 9. Activation data and Model A/B behaviour

- Dialog labels (`ActivateClientDialog.tsx:164-167`):
  `Model A — designated service triggered` / `Model B — pre-service (disabled)`.
  Internal program vocabulary is surfaced verbatim to operators.
- Server semantics (`aml-cases/index.ts:306-322`): Model A = no extra checks beyond
  the shared guardrails; Model B = requires `aml.tenant_settings.metadata.aml_activation_program.legal_approval === true`
  and a non-empty `program_version`, else 409 `model_b_not_approved`.
- Activation facts are stored **only in `aml.cases.metadata.activation`**
  (`{ model, event, reason, program_version, human_confirmed, activated_by,
  activated_by_email, activated_at }`) — not as first-class columns. The V2
  directive's explicit fields (`activation_timing`, `agreement_state`,
  `designated_service_gate_state`, `activation_policy_version`,
  `legacy_activation_model`, `migration_classification`, …) do not exist yet.
- **Live data impact: zero.** `aml.cases` is empty in production, so the Model A/B →
  explicit-fields migration (Phase 1) has no historic rows to classify; the
  migration machinery must still be built reversibly and audited per §17.4 of the
  directive.
- Extra gate flags `aml_purchase_ready_gate` / `aml_settlement_gate` exist live
  (both disabled) and are candidate inputs to the service-gate model design.

## 10. Client-page AML integration points

`src/components/clients/ClientDetailsModal.tsx` (1,101 lines) contains exactly
**one** AML integration point: the `StartClientComplianceButton` in the header
toolbar (lines 303–308).

- **Before activation:** the button (only when flag on + `aml.view`).
- **After activation:** **nothing changes.** No AML status card, no case reference,
  no service-gate state, no deep link to the case; `onActivated` is not wired, so
  the button remains and a second click surfaces the server's 409 as an error toast.
  The operator must manually navigate to `/admin/aml/cases` to find the case they
  just created. This is the Phase 4 gap (persistent AML summary card + bidirectional
  linking).

## 11. Portal disclosures and document flow

### 11.1 Finance Portal AML disclosures (every current one)

| Surface | Server contract | Disclosure state |
|---|---|---|
| `aml-finance` op `limited_status` (`index.ts:206-232`) | Returns `{ status, risk_rating, updated_at, open_finance_discrepancies }` | ❌ **`risk_rating` is returned server-side** — violates the V2 finance-safe contract (Appendix C.2). Rendered as a `Risk:` badge by `LimitedAmlStatusCard` (used on `FinancePortalPurchaseFileDetail.tsx:358`). Mitigating detail: the op authenticates via **Command Centre staff auth + AML role**, not the finance-portal session, so a pure finance-portal broker gets 401/403 and the card degrades to "Status unavailable". A dual-role user (staff session + AML role) does see raw risk inside the Finance Portal chrome. |
| `aml-finance` ops `create_case_handoff` / `redeem_case_handoff` (`index.ts:192-196`) | Both **hard-403** (`AML case snapshots are not available in the finance portal`) since security commit `bd4f5bb` (2026-07-25) which deleted the minting/redeeming implementation | ⚠️ The historical snapshot (which included `risk_rating`) can no longer be served. But the client-side artifacts remain: `AmlHandoffSnapshot` type incl. `risk_rating` (`amlFinanceApi.ts:113-130`), `redeemCaseHandoff` caller, and the routed page `/finance/aml-snapshot/:token` (`App.tsx:305`) which now **always renders an error** — a dead-end route in the Finance Portal. `aml.finance_case_handoff_tokens` table exists (RLS default-deny, no policies) and is unused. |

Net position: there is currently **no functioning finance-safe AML channel at all** —
the compliant replacement (finance-safe task/readiness states served under the
finance-portal session, per Appendix C.2) is net-new Phase 7 work, and the raw-risk
`limited_status` contract must be replaced, not merely hidden.

### 11.2 Client Portal disclosures

`aml-client-portal` `overview` is deliberately field-limited (no risk, screening,
IDV results, or MLRO content; `escalated_mlro` → "Under review", `blocked` →
"On hold — please contact us"). Three leak-shaped caveats for Phase 5:

1. The **raw internal `status` enum** (e.g. the literal string `escalated_mlro`) is
   shipped alongside the safe label (`index.ts:124`) — masked in UI, visible on the wire.
2. `recent_submissions` passes through **`reviewer_notes`** (staff-authored free
   text) unmapped (`index.ts:113`).
3. `get_questionnaire` / `list_requirements` use `select('*')` — future columns on
   those tables leak by default.

Auth: portal session token (`client_portal_sessions` → active `client_portal_users`),
everything scoped `.eq('client_id', …)`. No CSRF guard on this function (aml-finance
has one). CORS `Access-Control-Allow-Origin: *` on both portal-facing functions.

### 11.3 Document and evidence flow (current)

1. Client Portal: `request_upload_url` (25 MB cap, filename sanitised, key
   `<case_id>/<uuid>-<filename>` in bucket **`aml-documents`**) → browser PUTs to
   signed URL → `confirm_upload` verifies path ownership + object existence +
   requirement linkage, inserts `aml.documents`, flips
   `aml.document_requirements.status` → `uploaded`.
2. Staff review: `aml-cases` ops `list_documents`, `get_document_download_url`,
   `review_document`; submissions versioned in `aml.submission_versions` via
   `submit_for_review` (freezes a snapshot, computes `next_version`, advances
   `draft|kyc_in_progress` → `kyc_complete`).
3. Evidence references: `aml.evidence_references` via `aml-finance`
   (`list/add/delete_evidence`), plus `duplicate_document_refs` scanning.
4. Minor copy bug: portal Documents step says "≤ 20 MB"; server enforces 25 MB.

### 11.4 Case workspace state

`CaseWorkspaceTabs` (843 lines) renders inside the `CaseDetailSheet` side sheet
(`sm:max-w-2xl` ≈ 672 px): Overview, Verification, Screening, Risk & Decision always;
Ownership & Control, Funding & Finance, Timeline gated behind `aml_v3_case_workspace`
(off in production); Audit always. The tab list itself is `overflow-x-auto` — the
horizontally scrolling pattern the directive requires replaced. Ownership tab reads
only `caseRow` (no entity data); Funding & Finance tab is read-only with a link out
to `/admin/aml/finance`. This confirms the V2 finding: existing tabs are
summary/link-oriented, not complete working surfaces.

### 11.5 Route notes

- `/admin/aml-v3-cutover` (`AmlV3Cutover`) and `/admin/aml-integration-health`
  (`AmlIntegrationHealth`) are routed **without an `AmlGuard` wrapper**
  (`App.tsx:401-402`) — verify their in-page gating in Phase 2.
- `AmlLayout` has no redirect code; legacy aliasing = legacy URLs kept in
  `V3_WORKSPACES.paths` for tab-highlight matching + original routes preserved.

## 12. Issue register (Phase 0R)

Severity: 🔴 blocking/critical · 🟠 material · 🟡 hygiene.

| # | Sev | Issue | Evidence | Owning phase |
|---|---|---|---|---|
| I-01 | 🔴 | **32 repo migrations not applied to the live DB** (`20260724160000`…`20260725130000`), incl. AML role-identity and self-scoping security hardening; edge functions are already current and may assume the newer objects | §3; live check of `is_active_aml_role_identity` | ✅ Applied 2026-07-25 on explicit user authorisation: 26 migrations applied and verified (name-based reconciliation showed 9 of the original 32 were already live under dashboard-assigned versions; dependencies `scope_aml_tenant_roles` and `client_files_storage_metadata` were additionally required and applied; Phase 1 `aml_case_workflow_dimensions` applied last). Residual: ~27 older descriptive-named repo files (2026-06→07-24, e.g. step-up/MFA series) are absent from the recorded history but their objects appear live — operator should verify by name at leisure |
| I-02 | 🔴 | Baseline gate commands fail on unmodified `main`: lint (41 errors), `audit:style` ratchet (all 5 counters above baseline), `security:registry` (2 unregistered non-AML functions), 17 non-AML vitest failures, and `npm ci` lockfile desync | §5 | Phase 0R follow-up: restore a green baseline or re-baseline the ratchet with sign-off |
| I-03 | 🔴 | `New case` button + `aml-cases` `create` op allow unlinked, non-human-confirmed case creation, bypassing every activation guardrail | §8 | ✅ Addressed in Phase 3: `create` is now MLRO-only with a recorded exception category/authority/reason; the register shows an "Exception case" action to MLROs only |
| I-04 | 🔴 | Finance Portal has **no functioning AML channel**: handoff ops hard-403 since `bd4f5bb`, `/finance/aml-snapshot/:token` is a dead-end error page, and the fallback `limited_status` contract still contains `risk_rating` | §11.1 | Phase 7 |
| I-05 | 🟠 | `limited_status` returns raw `risk_rating` server-side (finance-safe contract violation, even though reachable only with staff auth) | §11.1 | Phase 1 (contract), Phase 7 (implementation) |
| I-06 | 🟠 | Activation data lives only in `cases.metadata.activation`; explicit `activation_timing` / `agreement_state` / service-gate fields absent; Model A/B labels use internal vocabulary; `AmlCaseStatus` compresses stage/portal/gate/risk into one enum | §9 | Phase 1 |
| I-07 | 🟠 | No `/admin/aml/cases/:caseId` full-page route; case processing happens in a 672 px side sheet with an `overflow-x-auto` tab strip | §11.4 | ✅ Addressed in Phase 3: full-page workspace behind `aml_v3_case_workspace` (redirects to the legacy sheet while the flag is off); grouped vertical nav replaces the scrolling tab strip on the new surface |
| I-08 | 🟠 | Client record post-activation state is nonexistent (no AML summary card, no deep link; re-click produces a 409 toast); `StartClientComplianceButton` unreachable in production (flag off) and visible to `aml.view`-only users who will always 403 | §10 | ✅ Addressed in Phase 4: `ClientAmlSummaryCard` on the client Overview tab (pre/post-activation states, progress, gate, deep links); activation offered only to write-capable users and only when no open case exists; supersedes the toolbar button per §0.4 |
| I-09 | 🟠 | Raw client-UUID entry is the ordinary activation path from the Cases page (no client search/picker) | §8 | ✅ Addressed in Phase 4: `ActivateClientDialog` now uses a client search picker (slim non-sensitive projection); UUID entry removed |
| I-10 | 🟠 | Internal detail in production UI: role list in Cases subheader, `aml_ctf` flag name in empty state, raw enums in toasts/labels, `escalated_mlro` on the wire to the Client Portal, `reviewer_notes` in portal payload | §11.2; agent inventory of `AmlCases.tsx:117,134-136` | Phase 2/5 |
| I-11 | 🟠 | Concurrency gaps: duplicate-open-case guard is read-then-write (no partial unique index); case reference generated from a count query; hash chain ordered by `created_at` can fork on same-millisecond writes; `tenant_settings` read unfiltered `.maybeSingle()` can spuriously disable Model B | §8 | ◑ Partially addressed: unique index live (Phase 1 migration applied), tenant-settings read fixed (Phase 1). Open: case-reference race, hash-chain same-millisecond ordering — later phase |
| I-12 | 🟡 | `amlPortalApi.ts` hardcodes Supabase URL + anon key instead of the central client configuration | `amlPortalApi.ts:5-6` | Deferred: the same URL/anon-key constants are the repo-wide pattern (`src/integrations/supabase/client.ts` hardcodes them identically); centralising is a cross-cutting config change, tracked for the visual-refinement/UAT phase |
| I-13 | 🟡 | `/admin/aml-v3-cutover` and `/admin/aml-integration-health` routed without `AmlGuard` | §11.5 | Phase 2 (verify in-page gating) |
| I-14 | 🟡 | Portal copy says 20 MB upload limit; server enforces 25 MB | §11.3 | ✅ Fixed in Phase 5 (copy now says 25 MB) |
| I-15 | 🟡 | Stale client artifacts for the deleted handoff: `AmlHandoffSnapshot` type, `redeemCaseHandoff`, `AmlCaseSnapshot` page; `x-finance-session-token` CORS header vestigial | §11.1 | Phase 7 |
| I-16 | 🟡 | `security:edge-check` and Playwright e2e not runnable in this container (Deno toolchain / app env); risk recorded, operator commands provided | §5 | Every phase gate |
| I-17 | 🟡 | `aml.provider_configs` empty — no live IDV/screening provider; provider work remains simulator-mode | §3 | Phase 6+ |

## 13. Phase-gate position

- **No material production changes have been made in Phase 0R** and none will be
  claimed complete until this baseline is signed off (V2 report §26.14).
- The repository's historical Phase 0 audit remains valid; this document completes
  its unchecked §9/§10 baseline-test item to the extent runnable in this
  environment, with the two not-runnable commands explicitly recorded (I-16).
- Recommended immediate next steps, in order:
  1. Operator: resolve I-01 (apply pending migrations) and confirm environment parity.
  2. Phase 0R follow-up commit: restore green `lint` / `audit:style` / `security:registry`
     baselines (I-02) so later gates can enforce "no regressions".
  3. Enter Phase 1 (canonical contracts) per the V2 report §23.
