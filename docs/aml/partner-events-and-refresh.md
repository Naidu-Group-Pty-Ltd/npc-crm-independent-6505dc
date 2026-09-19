# Partner compliance events, invalidation and refresh (Phase 6)

Phase 6 of the AML/CTF partner/reliance programme: AML state changes
propagate reliably to every linked portal without database state and portal
projections diverging. Migration:
`supabase/migrations/20260805140000_aml_partner_events_phase6.sql`.

## Collision analysis (§6.1)

Inspected before anything was created:

| Infrastructure | Finding |
| --- | --- |
| Outbox tables | `public.integration_outbox` (20260730220000) — UNIQUE idempotency_key, correlation_id, available_at/processed_at, lock lease, attempts |
| Delivery attempts | `public.integration_delivery_attempts` — per consumer, UNIQUE(outbox_id, consumer_name, attempt_number) |
| Dead letters | `public.integration_dead_letters` + `replay_integration_dead_letter(uuid, uuid)` |
| Checkpoints | `public.projection_checkpoints` |
| Claiming | `claim_integration_outbox` — FOR UPDATE SKIP LOCKED, 5-minute lock lease |
| Worker | `cross-portal-outbox-worker` — invokable POST, `x-worker-secret`, backoff `2**attempts` capped 3600 s, terminal at attempts ≥ 10, `CROSS_PORTAL_OUTBOX_V1` kill switch |
| Notification queues | portal notification tables with UNIQUE `integration_event_id` (idempotent delivery pattern) |
| AML audit events | `aml.case_events` hash chain (app-computed, `appendCaseEvent`) |

**Decision: extend, never duplicate.** `aml.integration_outbox` was NOT
created. The platform outbox already satisfies atomicity, idempotency,
retry, dead-lettering and replay; it is tenant-safe here (single-tenant
`'default'`, and AML event payloads carry only identifiers and controlled
codes). Phase 6 adds nullable envelope columns (`partner_org_id`,
`partner_case_link_id`, `causation_id`, `destination_class`,
`payload_classification`) with **no** cross-schema FKs, so the outbox stays
evidence (it never blocks an `aml` cascade delete) and the platform table
stays decoupled.

## Event creation is atomic (§6.2)

All emission goes through one choke point,
`aml.enqueue_partner_event(...)`:

- **flag-gated** — `aml_partner_event_outbox` off (the default) means the
  function returns NULL and writes nothing;
- **catalogue-validated** — `aml.partner_event_catalogue` is closed; an
  unknown event type raises;
- **tripwire-scanned** — `aml.assert_partner_event_payload_safe` mirrors the
  TypeScript restricted-key pattern (plus credential vocabulary) at every
  nesting depth;
- **duplicate-safe** — `ON CONFLICT (idempotency_key)` no-op.

Emission happens in `AFTER INSERT/UPDATE` triggers on the domain tables
(`partner_case_links`, `compliance_attestations`, `reliance_grants`,
`partner_records_requests`, `partner_evidence_deliveries`,
`independent_assessments`, `retention_triggers`, `legal_holds`), so the
event insert is part of the originating transaction by construction: no code
path can change domain state without the event, and a rolled-back
transaction creates neither. The edge function never calls
`enqueue_partner_event` (a contract test enforces this).

Two time-based events cannot come from a row transition and are enqueued by
the worker sweep (`sweepAmlTimeBasedEvents`): `aml.partner_access.expired`
(key `…expired:<grant_id>`) and `aml.arrangement.review_due` / `.overdue`
(key embeds `next_review_due`, so each due date emits once no matter how
many sweeps run).

## Event catalogue (§6.4)

23 events, each with a destination class (`ops` = Command Center visibility
only; `both` = the worker may additionally write a partner-safe
notification). Legal-hold, retention, disposal and arrangement events are
**ops-only — a partner never hears about them**. See
`aml.partner_event_catalogue` (SQL) and `PARTNER_EVENT_CATALOGUE`
(`supabase/functions/_shared/aml/partnerEvents.ts`); a contract test keeps
the two in lockstep. Payloads carry identifiers, controlled codes and hashes
only — never `revoke_reason`, hold reasons, decision notes or any free text.

## Consumer, retry and replay (§6.3, §6.7)

The worker gains one consumer, `aml_partner_events` (`event_type LIKE
'aml.%'`), inside the existing claim → attempt-ledger → backoff →
dead-letter machinery, unchanged.

The consumer **owns no authoritative writes**. It reads the current
aggregate row, asks the pure `partnerEventDeliveryDecision(...)` whether a
notification is still truthful, and its single write is an idempotent upsert
into `aml.partner_notifications` (UNIQUE `outbox_event_id`,
`ignoreDuplicates`). Consequences:

- a duplicate or replayed event yields exactly one notification row;
- a delayed `partner_access.created` after revocation is suppressed —
  revoked stays revoked (the consumer *couldn't* reopen it: it never writes
  grants);
- `attestation.issued` for a since-superseded version is suppressed;
- notification copy is the fixed catalogue in `PARTNER_EVENT_COPY` — event
  payload text never reaches a partner.

Failure handling is the platform's: backoff `2**attempts` capped at 3600 s,
terminal at 10 attempts into `integration_dead_letters` (replayable via the
existing RPC), error text truncated, no credentials or restricted bodies
recorded. Event rows are never deleted after success.

## Material change and refresh (§6.5, §6.6)

`apply_material_change` (staff op, MLRO-only, flag-gated) recomputes the
Phase 3 material-input hash from live case data and compares it — group by
group (`evaluateMaterialChange`) — with the inputs reconstructed from the
stored v2 payload (`materialInputsFromV2Payload`). Presentation-only
changes cannot register because the evaluator only ever sees material
inputs.

When material, `aml.apply_partner_material_change(...)` applies the
consequences in **one transaction**:

1. attestation → `refresh_required_at` + safe reason code (once);
2. grants on that attestation → `refresh_required_at`, or revoked when
   `mode='revoke'`;
3. determinations pinned to the stale content hash → `refresh_required_at`
   (a flag — the decision row itself is never edited);
4. one **open obligation per affected canonical link** in
   `aml.partner_refresh_obligations` (partial UNIQUE on
   `(partner_case_link_id, required_action) WHERE status='open'`);
5. the transition triggers emit `aml.attestation.refresh_required` /
   `aml.partner_determination.refresh_required` in the same transaction.

The RPC touches **only** those three refresh columns and the obligations
table — never `aml.cases`, the service gate, risk state or screening
(contract-tested). The case-event audit append happens after commit from the
edge function, per the existing pattern: audit/notification failure never
rolls back the authoritative transaction.

Flagged content stops being served everywhere: the workspace skips the
manifest intersection, `deriveAttestationState` returns `refresh_required`
(the DTO nulls non-current procedures), and the bearer-token redeem answers
a safe 409 (`attestation_refresh_required`). Partners see the safe reason
code and fixed wording only; `internal_trigger_codes` / `trigger_source`
are staff-only and excluded from every partner read.

An obligation completes when the partner re-records its determination
(`record_partner_determination` closes open `review_and_redetermine`
obligations for the link, stamping `completed_against_attestation_hash`).

## Staged enablement (§6.9) — read before flipping the flag

`aml_partner_event_outbox` is seeded **false**. Never enable it remotely as
part of this programme.

| Stage | State | Behaviour |
| --- | --- | --- |
| 0 (now) | flag off | Zero outbox writes; material-change op answers 409; byte-identical to Phase 5. |
| 1 | flag on, worker not scheduled | Authoritative transitions write events; the ops card shows a **growing pending backlog** — visible, not a false promise. Material change and obligations work. |
| 2 | flag on + worker invoked on a schedule | Full delivery: notifications, expiry/arrangement sweeps. |

If the flag is turned off with a backlog in flight, the consumer skips AML
events without writing anything; the events remain as evidence and the card
keeps counting them.

**Deployment ownership (not performed here):** deploying the modified
`cross-portal-outbox-worker` and `aml-reliance` functions, applying this
migration, scheduling the worker POST (existing `x-worker-secret` auth) and
enabling the flag are operator actions. Source presence is not deployment
truth; the ops card says exactly that.

## Operational visibility (§6.8)

`PartnerEventsOpsCard` (mounted on `/admin/aml-integration-health`, the
existing AML ops surface) reads `get_partner_events_health`: pending /
retrying / dead-letter counts, oldest pending age, open + overdue refresh
obligations, refresh-flagged attestations, arrangement reviews due ≤ 30 d —
and each figure expands into the underlying filtered rows. Flag state is
labelled recorded configuration; the card never claims the worker is
deployed or scheduled.

## Rollback

Exact statements in the migration's `-- ROLLBACK:` header (drop triggers →
functions → tables → new columns → outbox envelope columns → flag). All
additive; rolling back Phase 6 restores Phase 5 behaviour byte-for-byte.
Code rollback: revert the Phase 6 commit.

## Tests

- `src/lib/aml/partnerEvents.test.ts` — behavioural: catalogue completeness
  and destinations, partner-safe copy (forbidden-vocabulary scan +
  tripwire), material-change evaluation (identity/screening/gate changes
  register; presentation-only cannot; reconstruction reproduces the stored
  hash), stale-event delivery decisions (replay/ordering).
- `src/lib/aml/amlPartnerEvents.contract.test.ts` — source contracts:
  extend-not-duplicate, trigger atomicity, flag-gated enqueue, structural
  idempotency, consumer write-prohibition, RPC mutation allowlist, safe
  payloads, scope, ops-card honesty, SQL↔TS catalogue lockstep.

---

## Phase 9 release-candidate status (controlled rollout)

The partner/reliance domain (Phases 1–8 + pre-rollout remediation) is
**source implemented and locally tested** on branch
`claude/aml-ctf-remediation-and-controlled-rollout`: record classifications
corrected (raw ID copy P3, legal hold P4, SMR P5 seeded), controlled
expiring audited P3 evidence access completed, action-level write flags
added (all default false; service/settlement blocking reserved and
enforced nowhere). The 60-migration chain, behaviour battery, rollback
rehearsal and flag dependency order were proven on a disposable local
Postgres (`supabase/tests/aml-local-rehearsal/`). **Staging is not
deployed, staging is not verified, production is not deployed** — no
statement in this document may be read as claiming otherwise. The rollout
sequence, evidence sheets, UAT plan, sign-off register (no sign-offs
obtained) and open legal/MLRO decisions live in `docs/aml/rollout/`.
