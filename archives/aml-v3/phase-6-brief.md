# AML V3 — Phase 6 Brief

**Directive:** 15 — Full case workspace chronological build-out.
**Feature flag:** `aml_v3_case_workspace` (already reserved in Phase 4).
**Scope:** UI-only additive change to `CaseWorkspaceTabs.tsx`. No schema,
no new API, no write paths.

## What shipped
- New **Timeline** tab (V3-gated) inside the case workspace.
- Merges into a single chronological feed:
  - Hash-chained case events (`AmlCaseEvent`)
  - Identity verifications (`amlVerificationApi.listIdv`)
  - Screening checks (`amlVerificationApi.listScreening`)
  - Risk assessments (`amlRiskApi.listAssessments`)
  - Decisions (`amlRiskApi.listDecisions` w/ latest-decision fallback)
  - Funding discrepancies (`amlFinanceApi.listDiscrepancies`) — **only**
    when the caller holds `aml.investigate`
- Progressive disclosure via category chips with live counts.
- Read-only view — every mutation continues to live on its dedicated tab
  so capability + step-up gates remain intact.

## Guardrails honoured
- Tri-portal separation: no SMR / regulatory records surfaced.
- Tipping-off protection: finance category hidden without
  `aml.investigate`.
- No changes to `AmlLaunchOps` or Provider Configuration (frozen).
- No writes; no new tables; reuses existing SECURITY DEFINER RPCs.
- Feature-flag gated — default runtime unchanged.

## Verification
- Build passes (no new TS errors).
- Legacy tabs (Overview, Verification, Screening, Risk, Audit) untouched
  when `aml_v3_case_workspace` is disabled.

## Not in scope (future phases)
- Timeline export / print bundle.
- Filtering by actor or subject.
- Cross-case correlation view (Phase 7 candidate).
