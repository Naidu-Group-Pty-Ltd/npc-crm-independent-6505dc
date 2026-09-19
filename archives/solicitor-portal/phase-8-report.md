# Phase 8 delivery report — unified communications and notifications

## Architecture
The additive Phase 8 migration creates canonical conversations, participants, messages, attachments, receipts, delivery attempts/preferences, and migration issues. Scope guards prevent firm/NPC internal participant leakage. All tables and commands are service-role mediated.

## Migration
Legal thread/message IDs are retained as canonical IDs. Explicit client/finance mirror IDs become provenance on that one message. Unmatched legacy copies are preserved and reported; nothing is deleted or inferred by content similarity.

## Portal cutover
Solicitor, Client, Finance and Command Centre paths use participant-checked RPCs behind `CANONICAL_CONVERSATIONS_V2`. Client Portal adds a Legal channel and replies into the same conversation. Finance legal routing uses `purchase_files.assigned_finance_user_id`.

## Notifications
Receipts derive unread counts. Per-channel delivery records include scheduling, retry, error and dead-letter state. The worker completes in-app delivery and records retryable failures for provider channels that are not configured.

## Rollback and risks
Set `CANONICAL_CONVERSATIONS_V2=false` to resume legacy paths. Legacy tables remain intact. Before firm cutover, resolve missing transaction-case links, unmatched historical copies, conversations without required participants, and non-in-app provider configuration.

## Follow-up
Phase 9 replaces declared attachment metadata with immutable scanned document versions. Phase 10 renders the canonical Legal channel in the full Client Legal Workspace. Phase 11 adds the Finance Legal Coordination workspace.
