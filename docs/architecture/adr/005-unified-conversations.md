# ADR-005: Unified participant-based conversations

- **Status:** Accepted target; implementation deferred to Phase 8
- **Decision:** Use canonical conversations, participants, messages,
  attachments, and receipts. Each portal reads the same message through its
  audience policy/projection; messages are not copied between portal tables.
- **Privacy:** Participation is explicit and case-scoped. Practice-private and
  privileged content cannot acquire Client/Finance participants. Receipt and
  attachment access follow the same audience grant.
- **Migration:** Import legacy threads with stable source IDs and idempotency
  keys, reconcile counts/participants, dual-read behind a flag, retain originals
  until Phase 15.
