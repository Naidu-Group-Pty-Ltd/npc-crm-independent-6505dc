# ADR-004: Transactional outbox

- **Status:** Accepted and implemented in Phase 6
- **Decision:** A cross-portal command changes its authoritative aggregate,
  history, trusted audit event, and `integration_outbox` row in one transaction.
- **Delivery:** Events have aggregate/event versions, idempotency and correlation
  keys. Consumers maintain checkpoints, are idempotent, retry visibly, and move
  terminal failures to dead letters. Reconciliation detects projection drift.
- **Alternatives rejected:** Direct best-effort Edge Function side effects allow
  partial success and silent divergence.
- **Rollback:** Stop consumers and revert reads to prior projections; committed
  outbox events remain durable for replay.

## Phase 6 implementation

The outbox is implemented with idempotency keys, correlation IDs, leases, exponential retries, delivery-attempt history, dead letters and per-consumer checkpoints. Database triggers enqueue case, domain and legal-message events in the same transaction as the primary write. The worker claims with `FOR UPDATE SKIP LOCKED`; target message tables use unique `integration_event_id` values and case projections use `case_id` upserts for idempotency.

Cross-portal message mirroring was removed from the request path. A successful primary mutation reports delivery as pending, never delivered. Manual dead-letter replay is one transactional service-role command exposed only through the authenticated Command Centre integration-health surface.
