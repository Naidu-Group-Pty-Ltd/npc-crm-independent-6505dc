# Cross-portal cutover runbook

## Non-destructive sequence
1. **Expand** — apply additive Phase 1–15 migrations and deploy target APIs. Confirm every old route still resolves.
2. **Backfill** — run the read-only reconciliation scripts, resolve exceptions with a human decision, then run the approved backfill command. Never infer a client, firm, case, or mirror relationship from an address alone.
3. **Shadow / dual read** — keep legacy output authoritative while reading the target model. Review hash-only mismatches in `cross_portal_dual_read_comparisons`; no sensitive payload is persisted there.
4. **Controlled dual write** — route mutations through the owning service/RPC. Do not introduce browser-side or trigger-only cross-portal mutations. Compare projections and retry failed outbox work idempotently.
5. **Cutover** — record technical, security, operations, and business-owner approvals with external evidence references. The guarded RPC refuses cutover unless all readiness checks and the minimum stable window pass.
6. **Observe** — watch Phase 14 alerts, projection staleness, dead letters, access denials, document scan failures, and comparison divergence by correlation ID.
7. **Contract** — create a separate reviewed migration only after every enabled practice has completed the stable release window. Take a recoverable backup and rehearse rollback first.

## Immediate rollback
Use Command Centre **Integration → Controlled cutover → Rollback** for the affected practice and feature. Rollback does not delete target data. Pause contraction work, preserve correlation IDs, replay only idempotent events, and open an incident if privacy or cross-firm integrity is implicated.

## Legacy removal checklist
- Plaintext Solicitor session columns: zero populated rows and cookie-session rollback rehearsal complete.
- Client-level Solicitor authorization / default-allow merging: zero unresolved access exceptions and matter-level comparison clean.
- Direct message mirrors: canonical message IDs reconcile, uncertain historical duplicates remain preserved.
- Duplicate settlement-task tables: shared milestone projection clean and worker retries proven idempotent.
- One-sided link mutations: case health has no open mismatch.
- Direct legal visibility flags: client projection privacy contract passes.
- Broad audience reads: response-level prohibited-field tests pass for Client, Finance, Solicitor, and Command Centre.

No item above is removed by the Phase 15 expansion migration.
