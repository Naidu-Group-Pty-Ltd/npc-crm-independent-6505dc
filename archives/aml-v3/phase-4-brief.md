# AML/CTF Tri-Portal V3 — Phase 4 Brief

**Scope (report Directives 2, 3, 4):** consolidate the case surface. Ownership & Control (formerly Structures) and Funding & Finance fold into the case workspace as case-scoped tabs. Gated by `aml_v3_case_workspace` (default `false`). No schema, edge-function, cron or route changes.

## Delivered

Extended `src/components/aml/CaseWorkspaceTabs.tsx`:

1. **Flag read** via `useAmlV3Flags().caseWorkspace`. When off, the tab strip is byte-identical to Phase 3 (Overview / Verification / Screening / Risk / Audit).
2. **Ownership & Control tab** (V3 only) — case-scoped summary of the subject with a deep-link to the standalone `/admin/aml/counterparty` page. Individuals get a targeted explainer instead of an empty graph.
3. **Funding & Finance tab** (V3 only, requires `aml.investigate`) — pulls the latest source-of-funds comparison and open discrepancy count via the existing `amlFinanceApi`. Read-only summary + deep-link to `/admin/aml/finance` where the service-entitlement gate (Model B) and write actions remain.
4. Legacy pages remain fully functional and are the sole owners of mutating actions — the in-case tabs never bypass the entitlement / step-up rules enforced there.

## Guardrails honoured

- **Human-confirmed activation preserved.** No new case creation surface.
- **Model B entitlement gate untouched.** Funding & Finance mutations still occur on the dedicated page.
- **Capability gating.** Funding & Finance tab renders only for holders of `aml.investigate`. Ownership & Control tab respects the case's base `aml.view` (already enforced by the parent workspace).
- **Tri-portal separation.** Command-Centre-only. No new Client Portal or Finance Portal surface.
- **Legacy aliases.** `/admin/aml/counterparty` and `/admin/aml/finance` remain live per Phase 1 aliasing.
- **Hard exclusions (Directives 9 & 12).** Untouched.

## Default runtime

Flag is `false` → the case workspace tab strip is unchanged. Superadmin can flip `aml_v3_case_workspace` to preview.

## Phase 4 → Phase 5 handoff

Ready for Phase 5 once green-lit: Regulatory & Assurance surfacing (AUSTRAC hub polish + assurance queue), still under existing `aml.report` gates.
