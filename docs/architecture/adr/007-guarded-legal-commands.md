# ADR 007: Guard legal state, closure and link mutations with transactional commands

- **Status:** Accepted
- **Date:** 2026-07-30
- **Phase:** 4

## Context

Legal workflow status and closure were independently writable, status-history attribution was repaired after the update, cross-domain deal links were not consistently client-validated, and legal aggregates used last-write-wins updates.

## Decision

Add `row_version` to legal matters and require callers to submit `expected_version`. State transitions, closure, reopening, and cross-domain links execute through service-role-only PostgreSQL commands that lock the matter, validate the precondition and invariant, update state, and append trusted history/audit evidence in the same transaction. Direct status/closure writes are rejected by a guard trigger. A separate database trigger enforces exact-practice assignees and same-client, unique links even if a new server call path bypasses an Edge Function check.

The transition graph is explicit. `on_hold` may return only to an enumerated active state. Reopening requires a non-terminal target state and changes closure and workflow together. Solicitor closure cannot override blockers; any future privileged override must be mediated by Command Centre step-up authorization and retain its reason/category in the audit event.

## Consequences

Stale writes and invalid transitions are HTTP 409 conflicts. Existing inconsistent data is not silently repaired or deleted; it is reported for reconciliation. Legacy link columns remain through the Phase 5 compatibility window. Frontend clients must refresh after conflicts and carry the latest row version on mutations.
