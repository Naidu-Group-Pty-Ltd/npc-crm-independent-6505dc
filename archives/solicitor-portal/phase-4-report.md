# Solicitor Cross-Portal Programme — Phase 4 Report

## Scope

Phase 4 adds guarded legal workflow commands, row-version concurrency, closure enforcement, verified links, and responsible-solicitor consistency. It does not create transaction cases or begin Phase 5.

The `SOLICITOR_LEGAL_INTEGRITY_V1` kill switch can suspend Phase 4 mutations without weakening reads or falling back to unsafe direct writes. Existing operation names and legacy link columns remain compatibility adapters during reconciliation.

## Architecture and migration

Migration `20260730200000_legal_integrity_commands_phase4.sql` adds `legal_matters.row_version`, an explicit transition graph, and service-role-only transactional commands. The commands lock the aggregate, compare `expected_version`, validate state/link invariants, update the matter, and append status history plus the evidentiary legal audit event in one transaction. A state-write guard rejects direct status or closure patches outside trusted commands.

Link commands verify the legal matter, purchase file or deal all belong to the same client and prevent a record being attached to multiple matters. Existing links are preserved. `phase-4-reconciliation.sql` reports cross-client, duplicate, firm-mismatch, and closure/workflow anomalies without changing or inferring relationships.

## API and ownership changes

Solicitor and Command Centre status changes require `expected_version`, current status, target status and reason. Stale writes and invalid transitions return HTTP 409. Generic Solicitor updates also require `expected_version` and cannot change Finance-owned purchase price, deposit, or finance-clause fields.

Command Centre assignment changes verify that the responsible Solicitor is active and belongs to the exact non-null matter practice. New matters no longer accept unverified cross-domain link IDs; linking is a separate transactional command.

Closure and reopening use database commands. Closure checks outstanding dates, tasks, disbursements, requisitions and conflict clearance. Solicitor callers cannot bypass blockers. Reopening requires an explicit non-terminal target state and updates workflow and closure metadata atomically.

## Rollback

Redeploy Phase 3 Edge/frontend code first. Leave `row_version` and functions in place. Disable the state-write guard trigger only if Phase 3 code must temporarily perform legacy state patches. Do not drop row versions, history, or audit evidence. The migration is additive and existing link columns remain available.

## Known risks and follow-ups

- Existing inconsistent links are reported, not silently repaired; operators must reconcile them before Phase 5 backfill.
- Privileged closure override is modelled in the command but is not exposed to Solicitors; a future Command Centre step-up surface must prove authorization before setting it.
- Child aggregates retain their existing concurrency model; later phases add versions as they are unified.
- Phase 5 must consume only reconciled deterministic links when creating transaction cases.
