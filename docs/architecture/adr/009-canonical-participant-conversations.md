# ADR 009: Canonical participant-based conversations

- **Status:** Accepted for Phase 8
- **Date:** 2026-07-30

## Context
Legal, Client and Finance messages were separate rows connected by best-effort mirroring. A successful mirror followed by a failed source insert produced ghost messages; the inverse lost delivery. Thread counters also drifted independently from actual reads.

## Decision
A message is stored once in `messages` under a case-scoped `conversation`. Visibility is the intersection of conversation scope and active `conversation_participants`; portal names or client IDs alone never grant access. `firm_internal` accepts only practice participants, and `npc_internal` accepts only Command Centre participants.

`message_receipts` is the sole unread source. `notification_deliveries` stores one idempotent per-recipient/channel delivery with scheduling, attempts, failures and dead-letter state. Quiet hours delay delivery instead of suppressing or immediately inserting an in-app copy.

Legacy rows remain for compatibility. Explicit mirror IDs collapse to the legal canonical message; uncertain rows remain untouched and are recorded as migration issues. The `CANONICAL_CONVERSATIONS_V2` flag restores legacy reads during reconciliation.

## Consequences
- Every participating portal receives the same message UUID.
- Client replies post to the existing `client_solicitor` conversation.
- Finance participation derives from the purchase file's explicit assignee, never the first client assignment.
- Non-in-app channels remain visibly retryable until their provider dispatcher is configured.
