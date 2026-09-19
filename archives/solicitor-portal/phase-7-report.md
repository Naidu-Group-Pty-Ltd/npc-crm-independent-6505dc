# Phase 7 delivery report — unified milestones and settlement runway

## Architecture and migration
- Additive migration `20260730230000_unified_milestones_settlement_runway_phase7.sql` creates the five case coordination tables, service-role-only policies, audience projection RPC and guarded task command.
- Deterministic backfill follows `transaction_case_links`; it does not use addresses. Legacy source IDs, source timestamps, status, completion evidence, ownership, visibility and notes are retained.
- Equivalent shared task keys converge to one row/version. Conservative reconciliation marks the task complete only when both contributing sources are complete.
- Date disagreements create governed conflicts. Legal contractual-settlement authority is recorded rather than overwriting Finance provenance.

## Interfaces
Solicitor, Finance, Client and Command Centre endpoints call the same audience-filtered runway RPC. Legacy reads/writes remain available when `CASE_RUNWAY_V1=false` or a case has not been linked.

## Risk and rollback
Risk is enum/status drift in legacy data and incomplete case links. Reconciliation reports expose both. Rollback disables `CASE_RUNWAY_V1`; all legacy tables remain populated by the compatibility command and no schema is removed.

## Follow-up dependencies
Phase 8 may attach canonical conversations to task/milestone IDs. Phase 10 can render the already sanitised client runway. Phase 15 removes adapters only after reconciliation passes.
