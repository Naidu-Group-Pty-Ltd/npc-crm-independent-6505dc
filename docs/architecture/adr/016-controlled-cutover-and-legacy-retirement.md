# ADR 016: Controlled cutover and legacy retirement

## Status
Accepted for Phase 15 expansion; destructive contraction is explicitly deferred.

## Decision
Cross-portal capabilities advance per practice through `off → shadow → dual_read → dual_write → cutover`. A rollback transition is always available. Cutover is rejected unless the stable window, four named approvals, reconciliation, integration health, security alerts, session cleanup, and document-safety checks pass.

Dual-read comparisons retain only SHA-256 representations and the names of mismatched fields. They do not duplicate portal payloads. All transitions retain actor, reason, readiness snapshot, and time.

## Consequences
Defaults preserve the already-live Phase 1–14 behaviour. Practices can be isolated and rolled back without a global deploy. Legacy columns, tables, routes, and adapters remain in place until a later, separately approved contraction has production evidence for every practice. A migration being installed is not evidence that deletion is safe.
