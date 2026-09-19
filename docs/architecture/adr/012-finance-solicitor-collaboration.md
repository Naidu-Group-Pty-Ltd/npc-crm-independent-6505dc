# ADR 012: Finance–Solicitor collaboration through transaction cases

- **Status:** Accepted for Phase 11
- **Date:** 2026-07-30

## Context
Finance and Solicitor need shared settlement context, documents and conversation without either portal reading the other's private operational tables. Legacy ad-hoc reads make field ownership and provenance unclear.

## Decision
The transaction case is the only collaboration anchor. Finance reads a legal coordination DTO from `finance_case_read_model`; Solicitor reads a finance coordination DTO from `solicitor_case_read_model`. Shared tasks come from the case runway, shared documents require explicit audience grants, and messages use the canonical `finance_solicitor` conversation with current case participants.

Finance never receives practice notes, conflict details, privileged analysis, legal audit metadata or unrestricted client financial-position data. Solicitor never receives income, expenses, assets, liabilities, borrowing capacity, commissions, SMR or restricted AML data. Every projected field carries source/version/update provenance.

Command Centre remains the control plane for unlinked records, mismatches, stale projections, access grants, conversation participants, delivery failures, reconciliation and replay. Projection refresh writes a durable outbox command and audit history; portals never silently update another domain.

## Consequences
- Finance and Solicitor render one shared settlement runway without merging private task systems.
- Cross-portal messages retain one canonical message ID.
- Link and projection failures are visible and replayable.
- `FINANCE_SOLICITOR_COLLABORATION` is opt-in and rollback preserves all additive projections.
