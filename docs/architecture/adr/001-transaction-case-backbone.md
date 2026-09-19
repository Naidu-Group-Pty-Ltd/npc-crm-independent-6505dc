# ADR-001: Transaction case backbone

- **Status:** Accepted and implemented in Phase 5
- **Decision:** Add `transaction_cases` as shared identity/lifecycle/projection
  anchor and `transaction_case_links` for explicit legal matter, purchase file,
  and client deal links. Retain all three domain aggregates.
- **Invariants:** All records share `client_id`; each domain record links to at
  most one case; link/unlink is atomic and audited; address similarity is never
  enough to link; mutable case state has `row_version`.
- **Alternatives rejected:** A monolithic cross-portal table collapses ownership;
  continuing direct optional links permits drift.
- **Migration/rollback:** Additive schema, deterministic backfill plus exceptions,
  dual-read behind a flag. Disable new reads/writes to roll back; retain rows.

## Phase 5 implementation decision

The backbone is now implemented as one lightweight `transaction_cases` aggregate plus a one-per-case `transaction_case_links` record. Each domain record has an independent unique slot, remains authoritative in its existing table, and can belong to at most one case. A database trigger requires every linked record to share the case client.

Backfill evidence is restricted to existing forward IDs and reverse IDs. Address normalization is retained only as descriptive case metadata and is never a matching predicate. Active unlinked domain records receive standalone cases rather than being guessed together; invalid or duplicate explicit links are written to `transaction_case_reconciliation_issues`.

All subsequent link changes use row-versioned service-role commands and append `transaction_case_link_history`. One compatibility adapter inside those commands maintains legacy link columns until reconciliation and later cutover phases complete.
