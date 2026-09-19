# AML/CTF Tri-Portal — Production Readiness Report

Directive: *Aurixa AML/CTF Tri-Portal Product Completion Report v2.0*, Phase 13
(UAT and controlled rollout). Covers Phases 0R–13 delivered on branch
`claude/aurixa-aml-ctf-takeover-i2jj67` (PR #1345).

---

## 1. Delivery status

| Phase | Scope | State |
| --- | --- | --- |
| 0R | Takeover assessment, issue register I-01…I-17 | Complete |
| 1 | Canonical workflow dimensions, activation contract, provenance | Complete |
| 2 | Operational Compliance Home, commercial copy | Complete |
| 3 | Full-page case workspace, commercial register, restricted creation | Complete |
| 4 | Client record integration | Complete |
| 5 | Conditional versioned Client Portal onboarding | Complete |
| 6 | Parties, ownership, evidence | Complete |
| 7 | Finance reconciliation (both portal halves) | Complete |
| 8 | Risk, decision, service gate | Complete |
| 9 | Transaction and counterparty | Complete |
| 10 | Monitoring and ongoing CDD | Complete |
| 11 | Regulatory records, trigger-based retention, audit integrity | Complete |
| 12 | Commercial visual refinement | Complete (see §6 — scope note) |
| 13 | UAT and controlled rollout | This report |

## 2. Automated verification (this build)

| Gate | Result |
| --- | --- |
| AML unit + contract suites (`src/lib/aml`, `src/pages/aml`) | **130 / 130 pass** (9 files) |
| `npm run build` | Pass |
| `npm run security:static` | Pass — 511 files |
| `npm run security:edd-boundary` | Pass |
| `npm run security:inventory` | Pass (regenerated; no drift) |
| `npx tsc --noEmit` (AML surfaces) | No errors |
| `npx eslint` (AML surfaces) | 0 errors |

Contract tests assert the tri-portal disclosure boundaries and the compliance
rules at the **server** contract, not in the UI:

- Client Portal ships a portal-safe status token only — no internal case enum,
  no `reviewer_notes`, no risk/screening/ownership internals.
- Finance Portal `limited_status` carries no `risk_rating`; the broker request
  channel projects a §15.1 whitelist with no case identifiers and never echoes
  discrepancy internals.
- Questionnaire import fills blanks and flags conflicts — never overwrites.
- Verification state is derivable only from a real identity/screening check.
- Rating overrides require evidence, decision-maker and policy version.
- The service gate is written only by an explicit, reasoned, precondition-checked
  decision; risk evaluation cannot move it (§16 separation).
- Counterparties cannot be marked uncooperative without ≥2 recorded attempts.
- Review deadlines cannot move without a reason, and the original is preserved.
- Retention selects **only** on recorded trigger events — the age-since-upload
  cutoff is gone (§18).
- Disposal requires dependency + legal-hold + trigger re-checks and writes
  truthful disposal evidence.

## 3. Migration and rollback rehearsal

33 migrations applied to project `dduzbchuswwbefdunfct`. Every migration
authored in this programme carries a documented `-- ROLLBACK:` block.

**Rehearsal performed** (Phase 13 requirement): all rollback statements for the
five programme migrations were executed against the live schema inside a single
transaction terminated with `ROLLBACK`. Result: *"rollback statements applied
cleanly"* — every statement parses and applies, and nothing was left behind.
Post-rehearsal verification confirmed the schema intact:

- 6 / 6 programme tables present (`retention_triggers`,
  `service_gate_decisions`, `analyst_recommendations`, `finance_requests`,
  `field_provenance`, `workflow_dimension_migrations`)
- 8 / 8 case dimension + lifecycle columns present

All programme migrations are additive: no existing column, enum or hash chain
was altered, and no historical data was rewritten beyond backfilling
previously-NULL columns.

## 4. Deployed edge functions (byte-verified against branch sources)

| Function | Version |
| --- | --- |
| `aml-client-portal` | 241 |
| `aml-cases` | 245 |
| `aml-entities` | 181 |
| `aml-finance` | 181 |
| `aml-transactions` | 180 |
| `aml-risk` | 240 |
| `aml-monitoring` | 202 |
| `aml-records` | 202 |
| `finance-portal-aml-requests` | 1 (new) |

Each deployment was verified by SHA-256 comparison of every bundled file
against the repository source, and by marker checks confirming the phase
content is present in the live entrypoint. `verify_jwt=false` is preserved on
all of them: in-function `verifyAuth` (plus the cron-token guard on
`aml-monitoring`) remains the trust boundary, per the protected baseline.

## 5. Staged rollout position

All V3 feature flags are **off** in production — the programme is dark:

| Flag | State |
| --- | --- |
| `aml_v3_case_workspace` | off |
| `aml_v3_compliance_home` | off |
| `aml_v3_nav` | off |
| `aml_v3_start_client_compliance` | off |
| `aml_v3_metrics_relocation` | off |
| `aml_v3_org_settings` | off |
| `aml_v3_regulatory_hub` | off |
| `aml_v3_terminology_editor` | off |
| `aml_purchase_ready_gate` | off |
| `aml_settlement_gate` | off |
| `aml_ctf` | on (pre-existing) |

**Recommended enablement order** (each step independently reversible by
switching the flag back off; no migration rollback required):

1. `aml_v3_compliance_home` — read-only operational surface, lowest risk.
2. `aml_v3_case_workspace` — the authoritative processing surface. While off,
   `/admin/aml/cases/:caseId` redirects to the legacy side sheet, so bookmarks
   keep working either way.
3. `aml_v3_nav` + `aml_v3_start_client_compliance` — navigation and the client
   activation entry point.
4. `aml_v3_regulatory_hub`, `aml_v3_org_settings`, `aml_v3_terminology_editor`
   — administrative surfaces.
5. `aml_purchase_ready_gate` / `aml_settlement_gate` — entitlement gates.
   Enable **last**: these change whether work is blocked, not just what is
   displayed.

Legacy routes remain functional throughout; no route was removed.

## 6. Phase 12 scope note (declared assumption)

The directive drives Phase 12 from *supplied screenshots*. Those were not
available to this programme, so the phase was executed as a direct audit of the
built interface against the directive's own criteria (remove / retain /
consolidate / reposition; spacing, hierarchy, density, sizing; button placement
and responsive behaviour) plus the repository's Web Interface Guidelines.

Findings actioned:

- **Removed browser `prompt()` from the case workspace (8 call sites).** Native
  prompts cannot be styled, cannot associate a label with an input for assistive
  technology, cannot display the minimum-length rules the server enforces, and
  are suppressed entirely in some embedded contexts. Replaced with an
  accessible dialog (`usePromptDialog`) providing labelled fields, inline
  validation mirroring the server rules, help text, `aria-invalid` /
  `aria-describedby` wiring, `role="alert"` errors, and focus movement to the
  first invalid field.
- Submit controls stay enabled and move focus to the first error rather than
  becoming inert.
- Added missing accessible names to three free-text controls (request subject,
  client message, status-change reason).
- Placeholders now end with an ellipsis and carry example patterns.
- Numeric ownership column uses tabular numerals for column alignment.

Residual (pre-existing, outside this programme's surfaces): `confirm()` and
`prompt()` remain on older AML pages (`AmlMonitoring`, `AmlTransactions`,
`AmlRecords`, `AmlCounterparty`, `AmlGovernance`, `AmlConfiguration`,
`AmlAustracReporting`). They are unchanged by this work and are the obvious
next increment of the same treatment.

## 7. Known blockers — owner decisions required

These are **not** introduced by this programme and cannot be resolved from this
branch.

1. **External deployment sync reverts hardened functions.** A pipeline syncing
   edge functions from `main` (Lovable) redeployed main's pre-hardening sources
   over the authorized deployments **twice** during delivery. Each occurrence
   re-opened the Client Portal `reviewer_notes` leak and removed the MLRO-only
   case-creation restriction until restored. **Until PR #1345 merges, any push
   to `main` can revert these functions again.** Fix: merge the PR, or pause
   the sync until merge.
2. **`verify` CI job** — six failing `reportTemplate` specs on main's own code.
   Two (`reconstructionPrimitives.spec.ts:118,146`) come from main commit
   `9e0d621` and represent a real if narrow XSS-hardening gap: the sanitiser
   accepts font sources that can break out of the generated `<style>` element,
   and non-HTTP stylesheet URLs. Owner: report-templates.
3. **`security` CI job** — Deno cannot resolve `@supabase/supabase-js` for
   `agent-insights-runner`; behind it, WP-12 findings on
   `dispatch-marketing-reports` / `send-web-push`.
4. **`supply-chain` CI job** — 11 high advisories. Requires a lockfile refresh
   or explicit allowlist entries with reasons.
5. **Style-audit ratchet** fails against its committed baseline **on `main`
   itself** (313/844/340/97/25 vs baseline 105/800/320/94/15, verified in a
   clean worktree). This branch adds zero new violations; refreshing the
   baseline would launder main's drift, so it was left untouched.
6. **~27 older descriptive-named migration files** are absent from the recorded
   migration history although their objects exist live. Verify by name at
   leisure (assessment I-01).

## 8. Readiness assessment

The AML/CTF programme (Phases 0R–13) is **ready for staged enablement**:
delivered dark behind flags, applied additively with a rehearsed rollback,
deployed byte-verified, and covered by contract tests that fail if a portal
boundary or compliance control regresses.

The one condition attached to that assessment is blocker 7.1 — while the
external sync can overwrite the deployed functions, production hardening is not
durable regardless of what this branch contains. That should be resolved before
any flag is switched on.

## 8. Deployment status — activation fix + AUSTRAC consent

Merged to `main` in PR #1571 and deployed by the main-sync pipeline.
Verified against the live project on 2026-07-28.

| Component | State | Verification |
|---|---|---|
| `20260727090000_aml_consent_catalogue.sql` | **Applied live** | 5 documents seeded at v2026.1; `document_id` + `document_hash` present on `aml.consents` |
| `aml-cases` | **Deployed, v245** | `index.ts` SHA-256 identical to the merged source (45,434 bytes); `search_clients`, `consent_status`, the `/client/aml` notification and `has_portal_access` all present |
| `aml-client-portal` | **Deployed, v241** | Bundle hash unchanged from the verified v231 deploy; consent gate live on all four collection ops |
| `aml-risk` | **Deployed, v240** | `tenantCaseAccess` defined once against four call sites — the `ReferenceError` on `recommend` / `set_service_gate` / `gate_contract` is closed |

Deployment of `aml-cases` and `aml-risk` was deliberately left to the
main-sync pipeline rather than performed by hand. Both bundle
`_shared/auth.ts`, the authentication trust boundary, and the interactive
deployment channel requires transmitting every bundle file verbatim; a
transcription error there would have taken the AML command centre down. The
pipeline deploys from committed sources with no transcription step, and the
byte comparison above confirms the deployed bundle matches the merged source
exactly.

---

## Phase 9 release-candidate status (controlled rollout)

The partner/reliance domain (Phases 1–8 + pre-rollout remediation) is
**source implemented and locally tested** on branch
`claude/aml-ctf-remediation-and-controlled-rollout`: record classifications
corrected (raw ID copy P3, legal hold P4, SMR P5 seeded), controlled
expiring audited P3 evidence access completed, action-level write flags
added (all default false; service/settlement blocking reserved and
enforced nowhere). The 60-migration chain, behaviour battery, rollback
rehearsal and flag dependency order were proven on a disposable local
Postgres (`supabase/tests/aml-local-rehearsal/`). **Staging is not
deployed, staging is not verified, production is not deployed** — no
statement in this document may be read as claiming otherwise. The rollout
sequence, evidence sheets, UAT plan, sign-off register (no sign-offs
obtained) and open legal/MLRO decisions live in `docs/aml/rollout/`.
