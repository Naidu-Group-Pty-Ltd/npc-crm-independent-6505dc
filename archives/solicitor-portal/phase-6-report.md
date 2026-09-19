# Solicitor Cross-Portal Programme — Phase 6 Report

## Scope

Phase 6 implements field ownership, durable outbox delivery, hardened audit verification and audience projections. It does not begin Phase 7 milestone/task unification or Phase 8 canonical conversations.

## Field ownership

The executable registry at `_shared/crossPortalFieldOwnership.ts` defines owner, readers, writers, projection targets and conflict policy. Legal generic mutation allowlists consult it. Practice notes, NPC notes and Finance private notes remain single-domain fields. Restricted client financial-position and AML/SMR fields remain outside shared cases and hard-denied.

## Transactional outbox

The additive migration creates `integration_outbox`, `integration_dead_letters`, `projection_checkpoints`, and `integration_delivery_attempts`. Database triggers enqueue case, linked-domain and external-audience legal-message events atomically. Events contain identifiers and versions, not private note bodies. The worker uses leases with `FOR UPDATE SKIP LOCKED`, exponential retry, ten-attempt dead lettering, correlation IDs, per-attempt evidence and manual replay.

Client and Finance target messages have unique `integration_event_id` values. Projection rows use case primary keys. A crash after target insertion therefore deduplicates on retry rather than producing a second message or notification.

## Projections

Four explicit models are maintained: Client, Finance, Solicitor and Command Centre health. Client and Finance schemas cannot hold practice/NPC notes. Only the Solicitor model contains `internal_notes`. The Client Portal dual-reads the Phase 6 model behind `CASE_PROJECTIONS_V1`, retaining the Phase 3 compatibility projection for rollback.

## Audit hardening

The general Solicitor `audit_record` operation now returns 404. High-assurance commands continue to insert audit rows transactionally. Verification is recomputed strictly in PostgreSQL using the same canonical JSON/hash function as insertion; metadata mismatches are no longer tolerated. Scheduled worker mode records verification runs and emits a durable failure event for immediate Command Centre visibility.

## Operations, rollback and risks

Command Centre Integration Health shows pending events, attempts, checkpoint consumers and dead letters and permits permission-gated manual replay. Set `CROSS_PORTAL_OUTBOX_V1=false` to pause consumers while preserving queued events. Set `CASE_PROJECTIONS_V1=false` to restore the Phase 3 Client read path and stop scheduling the worker to pause delivery. Keep outbox, projections and evidence tables intact. Outstanding events remain replayable.

The migration and worker require rehearsal with production-shaped data. The interim worker still projects legacy legal conversations into existing portal message tables; Phase 8 replaces those copies with canonical participant conversations. Phase 7 must attach shared milestone/task events to this outbox.
