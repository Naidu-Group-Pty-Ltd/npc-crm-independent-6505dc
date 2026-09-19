# Solicitor Portal Cross-Portal Programme — Phase 1 Report

## Scope delivered

- Added explicit `solicitor_matter_access` grants with user/matter uniqueness,
  exact non-null firm anchoring, access role, validity window, revocation metadata,
  and tri-state matter policy.
- Backfilled only existing matters whose firm exactly matches the assigned user's
  firm. Null/cross-firm candidates are recorded as exceptions and never granted.
- Made the new resolver default-on behind `SOLICITOR_MATTER_ACCESS_V1=false` as an
  emergency rollback adapter. Legacy tables and helpers remain intact.
- Updated matters, documents, communications, intelligence, and compliance to
  list from accessible matter IDs and load through the same shared resolver.
- Replaced the Command Centre client-assignment surface with explicit Matter
  Access, including role/policy/validity/revocation visibility and an explicit
  “all current client matters” action that does not include future matters.

## Authorization invariants

- Client ID never grants access on the Phase 1 path.
- User, grant, and matter must share one exact, non-null firm.
- Missing, future, expired, or revoked grants deny access.
- Responsibility does not imply access; team access does not imply responsibility.
- Matter `allow`/`deny` overrides baseline; `inherit` falls through. Missing
  baseline values deny. Financial and AML forbidden keys remain hard-denied.
- Inaccessible matter lookups return 404 before child-resource operations.

## Migration and reconciliation

Migration: `20260730170000_solicitor_matter_access_phase1.sql`. It is additive,
service-role-only, RLS-enabled, idempotent under repository conventions, and does
not alter/delete legacy data. `phase-1-reconciliation.sql` reports missing
exact-firm grants, cross-firm grants, missing exception rows, and deployment totals.
No address-based inference is used.

## Rollback

Set `SOLICITOR_MATTER_ACCESS_V1=false` to use the exact-firm legacy adapter. Do not
drop Phase 1 tables or grants. Reconcile and correct exceptions, then restore the
flag. A code rollback reverts Phase 1 handlers/UI while leaving additive data safe.

## Follow-up dependencies

Phase 2 may replace raw single-session authentication but must retain the Phase 1
matter resolver. Phase 3 audience DTOs must authorize through the same grant.

## Known risks and deployment order

Apply the migration before deploying Edge Functions. Review and resolve every
migration exception before declaring reconciliation complete. The backfill
deliberately preserves all exact-firm matters reachable at the migration instant,
which may be broader than the intended future team; Command Centre can revoke
individual grants. Firm changes are blocked while an active grant exists, so an
operator must revoke access before reassigning a user or matter.

## Verification

- `npm run test:solicitor-phase1` covers the mandatory authorization matrix and
  all five shared-resolver integrations.
- `npm run test:solicitor-phase1-migration` checks additive/backfill invariants.
- Portal characterization, cross-portal contracts, Solicitor security, and the
  repository static auth scan pass.
- Live migration/reconciliation, strict typecheck, browser E2E/screenshot, lint,
  and build require the unavailable database/runtime or project dependencies.

**Stop gate:** Phase 1 only. Do not begin session hardening automatically.
