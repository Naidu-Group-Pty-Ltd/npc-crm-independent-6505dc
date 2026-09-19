# ADR 008: Unified case milestones and settlement runway

- **Status:** Accepted for Phase 7
- **Date:** 2026-07-30

## Context
Legal and Finance currently maintain independent critical dates and settlement task rows. Copying completion between those records creates contradictory states, while merging the domain tables would erase ownership and private-note boundaries.

## Decision
`case_milestones` preserves each authoritative source date and its provenance. `case_tasks` is the single aggregate for a shared task; `source_refs` records every legacy contributor, and a guarded, versioned command synchronises legacy rows during the compatibility window. Audience-specific `visibility` is enforced by `get_case_runway`; domain-private tasks never become shared merely because they have the same case.

Divergent equivalent milestones create `case_milestone_conflicts`. Contractual settlement is legal-authoritative after exchange and finance approval is Finance-authoritative. An authority choice remains visible; conflicts without a clear authority require human confirmation.

## Consequences
- Finance and Solicitor render one completion state for shared tasks.
- Source records, timestamps, evidence, owners, visibility and notes remain available for reconciliation.
- Existing tables and endpoints remain as fallback adapters behind `CASE_RUNWAY_V1`.
- Client reads are limited to explicit client visibility and Command Centre sees shared coordination/conflicts, not practice- or finance-private tasks.
