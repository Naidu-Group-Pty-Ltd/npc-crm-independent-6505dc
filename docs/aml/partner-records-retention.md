# Partner-domain records, retention and disposal (Phase 7)

Phase 7 of the AML/CTF partner/reliance programme: every partner-domain
record class joins the existing trigger-based retention, legal-hold and
disposal engine with a controlled classification. Migration:
`supabase/migrations/20260805150000_aml_partner_records_retention_phase7.sql`.

## Reconciliation (§7.1)

The repository already runs one retention engine, and Phase 7 extends it —
no duplicate logic was created:

| Existing control | Where |
| --- | --- |
| Per-class configuration (years, basis, method) | `aml.retention_schedules` (MLRO-editable via `upsert_schedule`) |
| Recorded legal trigger starts every clock | `aml.retention_triggers` (supersede-not-overwrite; no trigger = no clock = never disposal-eligible) |
| Legal holds | `aml.legal_holds`, checked at dry run AND re-checked at execution |
| Disposal workflow | `aml.retention_scans` / `_scan_items`: dry run → awaiting_approval → approved (MLRO) → executing → completed, with `dependency_blockers` + `disposal_evidence` (hashed) |
| Dependency checks | `dependencyBlockersFor` in `aml-records` |
| Biometric destruction | `disposeBiometric`: object removed FIRST, pointer cleared second, APP 11 access log |
| Audit | hash-chained `records_audit_events` |

## Record taxonomy (§7.2, §7.3)

`aml.record_class_catalogue` (queryable via the new `list_record_classes`
op) and its pure mirror `_shared/aml/partnerRetention.ts` classify **21
classes** — every object Phases 1–6 created plus the two raw-capture
classes. Each row carries: family (GOV…AUD), P1–P6 classification, default
visibility, storage zone, access-logging duty, retention trigger kind and
disposal rule.

Highlights:

- `arrangement_assessment_record` is **P4** (review findings are internal);
- `legal_hold_record` is **P4** (corrected pre-rollout from the original P5
  seed by `20260828000000_aml_record_classification_correction.sql`) — a
  hold is never client- or partner-visible either way;
- outbox events, delivery attempts, access logs, triggers and disposal
  evidence are AUD/RET **P4** ledger records, disposal `recorded_only` —
  the record proving why disposal was authorised is never itself disposed of;
- a table CHECK (`record_class_restricted_never_exportable`) makes a
  P4/P5/P6 class structurally impossible to mark partner-exportable, and the
  pure `evaluatePartnerExport` guard blocks those classes plus unknown codes.

## Storage zones (§7.7)

The six documented logical zones map onto EXISTING stores — no new bucket
exists or is implied: structured CDD database (aml schema tables), AML
document vault, biometric vault (`aml-biometrics` + APP 11 log), restricted
reporting/investigation vault (reports/EDD/alert tables), attestation store
(`compliance_attestations` + manifests), audit and retention ledger
(hash-chained events, logs, triggers, holds, disposal evidence). The
partner-domain deliberately holds **no object path anywhere** (Phase 4
design), so no partner record can name a storage location.

## Retention triggers (§7.5)

Eight new trigger kinds (superset CHECK swap — every historical value stays
valid): `record_created` (ONLY for classes that explicitly run on creation
date), `client_transaction_record_received`, `cdd_arrangement_end`,
`partner_relationship_end`, `evidence_delivery_end`,
`raw_id_copy_necessity_end`, `biometric_necessity_end`,
`audit_obligation_end`. There is no upload-age kind; scan candidates still
come exclusively from recorded triggers whose minimum retention date has
passed.

`sync_partner_triggers` (new op, flag-gated, idempotent ensure-pattern)
derives clocks from state the domain already recorded: ended links →
`partner_relationship_end` @ ended_at; expired/revoked deliveries and
terminally-reviewed requests → `evidence_delivery_end`; discharged
obligations → `audit_obligation_end`; transient notifications →
`record_created` (the one creation-date class). Agreements are ended by an
explicit MLRO action, so `cdd_arrangement_end` is recorded manually via
`record_retention_trigger`.

Schedules are seeded for eleven partner-domain entity types as **recorded
configuration** (s 107 seven-year defaults; `partner_notification` 2 years;
`raw_id_document_copy` years=0 because its clock is necessity, not a
period). The MLRO adjusts them through the existing op.

## Raw ID copies and biometrics (§7.8)

Finding, recorded in the migration: the platform stores **one** class of
raw identity object — the biometric facial image
(`verification_checks.biometric_storage_path`, hard-delete schedule,
object-before-pointer destruction, APP 11 access log, consent id retained
as authority evidence). **Full ID-document copies are not stored as
objects** — document sighting keeps structured attributes only (document
type, sighting kind, certifier capacity). Both raw classes are catalogued
with necessity-end clocks and hard delete; the correction migration places
the retained ID-document copy at **P3** (restricted CDD evidence,
controlled evidence channel only — never ordinary export) and the raw
biometric stays **P6** (no partner route exists at all), so any future
capture must adopt them instead of inheriting the structured-CDD clock.
The actual disposal duration for necessity-based classes remains an
MLRO/privacy configuration decision — nothing is hard-coded.

## Dependencies and holds (§7.6)

`dependencyBlockersFor` gains partner-domain checks (the counting stays in
the engine; the decision is the pure `partnerDependencyBlockers`, identical
at dry run and execution): an active partner-case link, an unrevoked
unexpired grant, an open records request, a live evidence delivery or an
open refresh obligation each block disposal, with internal reason codes
(`active_partner_case_link`, `active_reliance_grant`,
`open_partner_records_request`, `live_evidence_delivery`,
`open_refresh_obligation`) that are never shown to clients or partners.
All pre-existing blockers (open reports/obligations/investigations/alerts,
evidence references, relationship-not-ended) are untouched.

## Disposal workflow (§7.9)

Unchanged and reused: dry run → dependency report → MLRO approval →
execution with hold/dependency/trigger re-verification → per-item
disposal evidence with content hash → hash-chained audit. Phase 7 adds:

- **conservative scan sources** — only `partner_case_link`,
  `partner_records_request`, `partner_refresh_obligation` (soft-delete,
  carry `updated_at`) and `partner_notification` (hard-delete fixed-copy
  rows) are enumerated with a source. Attestations, grants, manifests and
  evidence-delivery read models are evidence: their scan items dispose as
  `recorded_only` and rows survive with the case file;
- **disposal lifecycle events** — `aml.retention_scans` transitions emit
  `aml.disposal.approved` / `.executed` / `.failed` through the Phase 6
  choke point, atomic with the transition, ops-only destination (disposal
  never notifies a partner). The Phase 6 catalogue rows flip from
  `emitted_by='phase7'` to `'trigger'`.

## Exports (§7.10)

`export_privacy_bundle` gains a flag-gated `partner_sharing` section: what
was shared about the subject under CDD arrangements — link, request and
delivery **metadata only**. P4/P5/P6 classes never enter any export; the
partner-facing guard is `evaluatePartnerExport`. Partners still cannot
invoke any retention or disposal operation — the workspace op set carries
none.

## Flag and staged enablement (§7.11)

`aml_partner_records_retention` seeded **false**, never enabled remotely.
Off = the retention engine behaves byte-identically to before: new trigger
kinds and partner entity types are rejected (409 `partner_retention_disabled`),
`sync_partner_triggers` refuses, partner dependency blockers do not run,
exports carry no partner section. On = the partner domain joins the engine.
Existing retention controls are never weakened by either state — the
extension only ever ADDS blockers and classes.

## Rollback

Exact statements in the migration `-- ROLLBACK:` header (drop trigger →
function → catalogue table → schedule seeds → event-catalogue emitter
revert → flag; the CHECK swap is restored only after confirming no row uses
a new kind). Code rollback: revert the Phase 7 commit.

## Tests

- `src/lib/aml/partnerRetention.test.ts` — behavioural: 19 families, P1–P6,
  six zones, 21 fully-classified classes, structural non-exportability of
  P4/P5/P6, trigger-kind coverage with no upload-age kind, creation-date
  confined to its one declaring class, necessity clocks on raw captures,
  export guard, dependency evaluation.
- `src/lib/aml/amlPartnerRetention.contract.test.ts` — source contracts:
  extend-not-duplicate, superset CHECK swap, SQL↔TS catalogue lockstep,
  flag gating at every partner entry point, blockers at dry run AND
  execution, object-before-pointer biometric ordering, conservative scan
  sources, disposal event emitters, export restrictions, MLRO-only
  approval/execution.
- Pre-existing `src/lib/aml/biometricRetention.test.ts` continues to guard
  the biometric destruction contract unchanged.

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
