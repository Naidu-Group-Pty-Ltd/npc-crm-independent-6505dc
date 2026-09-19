# AML Canonical Contracts (Phase 1)

Phase 1 of the tri-portal completion directive: separate workflow-status
dimensions, explicit activation fields, portal-safe response contracts, field
provenance and the legacy-activation migration plan. Source of truth for value
lists: `src/lib/aml/caseDimensions.ts` (TypeScript) mirrored by
`supabase/migrations/20260725153000_aml_case_workflow_dimensions.sql` (SQL).

## 1. Workflow-status dimensions (directive §16)

One legacy `aml.cases.status` enum previously carried KYC progress, review
state, escalation and outcomes. The case now has four explicit dimensions
(new nullable columns on `aml.cases`):

| Dimension | Column | Values |
|---|---|---|
| Internal case stage | `case_stage` | draft · activated · awaiting_client · client_in_progress · client_submitted · staff_review · checks_in_progress · additional_info_required · decision_pending · cleared · cleared_with_conditions · enhanced_cdd · blocked · closed |
| Client Portal status | `client_portal_status` | not_started · action_required · in_progress · submitted · under_review · additional_info_required · complete · contact_adviser |
| Finance Portal status | `finance_portal_status` | not_requested · information_required · submitted · clarification_required · under_review · accepted · no_further_action |
| Service gate | `service_gate_status` (+ `service_gate_effective_at`, `service_gate_policy_version`) | not_activated · cdd_incomplete · information_outstanding · under_review · conditions_outstanding · approved_with_controls · approved · locked · terminated |

Risk stays on the existing `risk_rating` / `risk_score` columns — it is a
dimension of its own and is never derived from, or written into, the others.

**Compatibility rule (until the cutover phase):** the legacy `status` column
remains authoritative for V2 surfaces. The `aml-cases` edge function keeps the
dimension columns coherent on `create` / `activate_client` / `transition` using
the deterministic maps, and retries without the new columns when a target
environment has not applied the migration (contract-first deploy tolerance).
The service gate is synced conservatively from legacy transitions only as a
stop-gap — explicit gate decisions arrive in Phase 8 and the gate must never be
inferred solely from stage or risk.

## 2. Explicit activation contract (directive §17)

New columns on `aml.cases`, written at activation time and backfilled from
`metadata->'activation'` for pre-existing rows:

| Column | Meaning |
|---|---|
| `activation_timing` | `pre_agreement` · `conditional_agreement` · `post_agreement_trigger` · `legacy_unclassified` |
| `agreement_state` | `not_executed` · `conditional_executed` · `operative` · `terminated` |
| `activation_policy_version` | Program version recorded at activation (Model B's `program_version`) |
| `legacy_activation_model` | Preserved historic `A` / `B` label — never rewritten |
| `migration_classification` | `auto_classified` · `human_reviewed` · `ambiguous_pending_review` |
| `migration_reviewed_by` / `migration_reviewed_at` | Human sign-off for ambiguous records |

Model label → explicit meaning (labels preserved, not reversed):

- **Model A** ("designated service triggered") → `activation_timing = post_agreement_trigger`, `agreement_state = operative`.
- **Model B** ("pre-service") → `activation_timing = conditional_agreement`, `agreement_state = conditional_executed`; requires tenant legal approval + program version (unchanged server guardrail).

Both models start the gate at `service_gate_status = cdd_incomplete`.

### Legacy-activation migration plan

1. The migration backfills every case where `case_stage IS NULL` using the
   deterministic status maps and `metadata->'activation'->>'model'`.
2. Cases with a recorded model are `auto_classified`; cases without one get
   `activation_timing = legacy_unclassified` + `migration_classification =
   ambiguous_pending_review` and require human review
   (`migration_reviewed_by/at`).
3. Every backfilled row is recorded in `aml.workflow_dimension_migrations`
   (previous status + metadata preserved) — a side table rather than
   `aml.case_events`, so SQL never writes into the SHA-256 hash chain.
4. Production `aml.cases` was empty when this migration was authored
   (verified 2026-07-25), so the backfill is a no-op there; it exists for
   staging/local data and reproducibility.

## 3. Portal-safe response contracts

### Client Portal (`aml-client-portal` `overview`; Appendix C.1)

- The `case.status` field on the wire is now the **portal-safe dimension
  token** (also exposed as `portal_status`), never the internal enum. Labels
  and tones derive from the token.
- `recent_submissions` no longer includes `reviewer_notes` (staff-authored
  free text); client-facing explanations travel through `client_requests`.
- Existing behaviour preserved: consent gating, sections, requirements,
  progress, open requests, signed uploads.

### Finance Portal (`aml-finance` `limited_status`; Appendix C.2)

Response is now exactly:

```json
{
  "finance_status": "not_requested | information_required | submitted | clarification_required | under_review | accepted | no_further_action",
  "service_readiness": "service_ready | service_not_ready",
  "open_finance_discrepancies": 0,
  "updated_at": null
}
```

Raw `status` and `risk_rating` are **removed from the server response** (not
merely hidden in UI). `service_readiness` is `service_ready` only for an
explicit `approved` / `approved_with_controls` gate (legacy fallback: only a
`cleared` case). The blocked `create_case_handoff` / `redeem_case_handoff`
ops are unchanged (they remain 403; replacement channel is Phase 7).

## 4. Field provenance (`aml.field_provenance`; Appendix C.3)

Append-first record of where each material value came from: `field_key`,
`value`, `source_type` (client_portal · finance_portal · document · provider ·
purchase_file · staff), source record/party/entity, submitter, confidence,
`verification_status`, `conflict_status` (none · conflict · superseded ·
resolved), canonical acceptance (`is_canonical`, `canonical_value`,
`accepted_by/at`, `resolution_reason`). RLS default-deny; service-role access
via SECURITY DEFINER edge functions only. Reconciliation workflows populate it
from Phase 5/7 onwards; Phase 1 ships the model.

## 5. Duplicate-open-case enforcement

Partial unique index `aml_cases_one_open_per_client` on
`aml.cases(client_id) WHERE client_id IS NOT NULL AND status NOT IN
('cleared','blocked','closed')` closes the read-then-write race in
`activate_client`; the edge function maps unique violations (23505) to the
existing 409 contract.

## 6. Migration & rollback

- Apply: standard migration deploy (file
  `20260725153000_aml_case_workflow_dimensions.sql`). Additive only; no
  changes to existing columns, enums, or the hash chain. Note the
  **32 earlier unapplied migrations** recorded in the Phase 0R assessment
  (issue I-01) must be applied first or together.
- Deploy order tolerance: edge functions may deploy before or after the
  migration — inserts/updates retry without the new columns when absent, and
  reads use `select('*')` with legacy fallbacks.
- Rollback: the exact statements are in the migration header comment (drop the
  two new tables, the partial index and the added columns). Safe while the V3
  workspace flags remain off; no legacy data is modified beyond backfilling
  previously-NULL columns.

## 7. Verification (Phase 1 gate)

- Unit: `src/lib/aml/caseDimensions.test.ts` (mapping totality, gate
  conservatism, no internal-state leakage, finance-safe vocabulary).
- Contract greps: `risk_rating` absent from `limited_status` response
  construction; `reviewer_notes` absent from the portal payload.
- Regression commands per the directive §0.10 — results recorded in the phase
  gate evidence (PR).

## 8. Questionnaire → canonical party reconciliation (Phase 6)

`aml-entities` op `import_from_questionnaire` (write roles only) reconciles a
case's submitted `purchasing_structure`, `entity_details` and
`related_parties` answers into the existing entity engine. Rules:

- **Entity resolution order**: existing case `subject` link → ABN/ACN match →
  create (only for Company / Trust / SMSF / Partnership structures with a
  declared legal name). ABN vs ACN is decided by digit count (11 vs 9).
- **No silent overwrite**: on an existing entity, declared registration
  fields (`legal_name`, `abn`, `acn`, `incorporation_date`) only fill columns
  that are currently empty. A mismatch is reported and recorded in
  `aml.field_provenance` with `conflict_status='conflict'` — the recorded
  value is never replaced by the import.
- **Party mapping**: Beneficial owner / Beneficiary / Trustee / Director →
  `aml.beneficial_owners` (control type mapped; UBO set for declared
  beneficial owners or a parsed ownership ≥ 25%); Authorised representative →
  `aml.authorised_representatives`. Dedupe by case-insensitive full name;
  existing rows are left untouched (DOB mismatches are flagged as conflicts).
  Roles with no canonical home (co-purchaser, donor, private lender, other) —
  and every party on a case with no entity structure — are preserved in
  provenance and returned as `parties_needing_review`.
- **Provenance**: every material declared value lands in
  `aml.field_provenance` (`source_type='client_portal'`, source record id =
  the questionnaire response row). Idempotent per (source record, field key):
  re-imports add rows only for new or changed sources.
- **Audit**: each import appends a hash-chained `aml.case_events` entry with
  the reconciliation counts.
- **Reads**: `list_provenance` (any AML role, case-scoped) powers the
  workspace conflicts panel. Ownership internals are never exposed to the
  Client Portal or Finance Portal — `aml-client-portal` and the finance-safe
  `limited_status` contract have no path to these tables (enforced by the
  Phase 6 contract tests).

## 9. Finance request loop (Phase 7, directive §15)

The Command Center ↔ Finance Portal workflow runs on `aml.finance_requests`
(RLS deny-by-default; service-role only):

- **Staff side (`aml-finance`, AML write roles)**: `create_finance_request`
  (kinds: funding_information · financial_evidence · clarification; message is
  staff-authored finance-safe wording — a linked discrepancy id stays
  server-side and its detail never travels with the request),
  `review_finance_request`, `resolve_finance_request` (outcome + optional
  gate to `under_review`/`accepted`/`no_further_action`). Each step advances
  `aml.cases.finance_portal_status` (§15.3) and appends a hash-chained case
  event.
- **Partner side (`finance-portal-aml-requests`, finance-portal session
  auth)**: scoped strictly by `finance_portal_client_assignments` via the
  denormalised `client_id` on the request row — the function never reads
  `aml.cases` for scoping. The response projection is the §15.1 whitelist
  (id, kind, subject, message, status, purchase_file_id, timestamps): no case
  identifiers, no risk/screening data, no discrepancy internals.
- **Canonical submissions**: a funding submission becomes an
  `aml.finance_comparisons` row (`source='finance_portal'`) and runs through
  the shared `_shared/amlFinanceEngine.ts` discrepancy engine — the same
  implementation the staff function uses. Detected differences are recorded
  as `aml.finance_discrepancies` (`detected_by='finance_submission'`) and are
  NOT echoed to the partner; they reach the partner only as later
  staff-authored clarification wording. Evidence descriptions become
  `aml.evidence_references` rows.
- **Rollback**: `DROP TABLE IF EXISTS aml.finance_requests;` (migration
  header). The comparison/discrepancy/evidence tables predate Phase 7 and are
  untouched.

## 10. Service-gate decisions (Phase 8, §16 + Appendix C.4)

The service gate is a separate workflow dimension and is never inferred from
case stage or risk rating. After activation (which sets `cdd_incomplete`),
the ONLY writer is `aml-risk` op `set_service_gate` (reviewer/MLRO;
`locked`/`terminated` MLRO-only):

- Every change requires a reason (≥10 chars) and records an
  `aml.service_gate_decisions` row carrying the full C.4 contract:
  {status, effective_at, conditions[], decision_id, approved_by,
  policy_version, audit_event_id}. The audit event id comes from the
  hash-chained case event written for the change.
- **Approval preconditions**: `approved`/`approved_with_controls` require a
  recorded `cleared` decision and no unresolved mandatory holds
  (authoritative IDV/sanctions signals re-checked server-side).
  `approved` additionally requires zero open conditions;
  `approved_with_controls` requires ≥1 open condition documenting the
  controls (frozen onto the gate record).
- `gate_contract` returns the latest C.4 record (falling back to the
  dimension columns pre-first-decision). Both tables
  (`service_gate_decisions`, `analyst_recommendations`) are browser
  read-only: SELECT policies for AML roles, writes via the SECURITY DEFINER
  function only.

## 11. Recommendation → decision loop and override rule (Phase 8, §12.8)

- Analysts record `recommend` (outcome + rationale ≥10 chars); a new
  recommendation supersedes the pending one; `decide` stamps pending
  recommendations `actioned` with the decision id.
- Rating overrides require reason AND evidence at request time
  (`evidence_note`), a reviewer/MLRO decision-maker, the policy version
  stamped at resolution (`program_version`), and hash-chained audit events —
  the full §12.8 rule.
- `recalc_status` reports assessment staleness from material-input changes
  (screening, verification, funding, questionnaire, counterparty) so ratings
  are recomputed rather than silently stale.

## 12. Delayed CDD and uncooperative counterparties (Phase 9, §12.5)

- `set_delayed_cdd` records a dated deadline (YYYY-MM-DD) plus a
  justification (≥10 chars); overdue deadlines surface in the workspace.
- `mark_uncooperative` requires a reason (≥10 chars) AND at least two
  recorded contact attempts across the counterparty's information requests
  (reasonable-steps evidence); it escalates the counterparty case.
- Both fields are stripped from the generic `upsert_cp_case` patch — they
  change only through the dedicated audited ops, and every action appends a
  hash-chained case event ("Counterparty Action" in the §19 audit taxonomy).

## 13. Ongoing CDD and the relationship lifecycle (Phase 10, §12.9 + §18)

Ongoing customer due diligence runs for the applicable relationship period and
is driven by three review classifications on
`aml.existing_customer_reviews`: `periodic`, `trigger_based` and the legacy
`pre_commencement` remediation queue.

- **Risk-based periodic cycle**: interval months come from
  `aml.tenant_settings.review_interval_config` (defaults
  prohibited 3 · high 12 · medium 24 · low 36 · unrated 12).
  `schedule_periodic_review` books the next review and stamps
  `aml.cases.next_periodic_review_at`; `complete_review` on a periodic review
  records `last_periodic_review_at` and books the following cycle, so the
  cadence cannot lapse silently. The cron scan raises the review when its
  scheduled date arrives.
- **Trigger-event reviews**: `record_trigger_review` accepts only the
  catalogue (risk_increase · screening_match · adverse_media ·
  ownership_change · transaction_change · counterparty_uncooperative ·
  client_circumstances · other), each with its own SLA and priority, and
  requires a detail note (≥10 chars) that lands on the case timeline.
- **Assignments and deadlines**: `assign_review` records ownership;
  `extend_review_deadline` requires a reason (≥10 chars), refuses to move a
  deadline earlier or to touch a closed review, preserves `original_due_at`,
  increments `extension_count` and audits every change. Overdue reviews
  escalate to `remediation_required` on the cron scan.
- **Relationship end** (§18 retention trigger): `end_relationship` is
  reviewer/MLRO-only, requires a reason (≥10 chars), and is refused while
  enhanced due diligence or alerts remain open unless the MLRO records it.
  It sets `monitoring_status='ended'` with
  `relationship_ended_at`/`relationship_end_reason`/`_recorded_by`, clears the
  next-review date and marks open reviews `exited` with outcome
  `relationship_ended` — cancelled, never deleted. All completed history and
  evidence remain on the case for retention.
- **Monitoring suppression**: the cron scan loads ended cases once and skips
  them for rescreening alerts, stale-verification alerts and periodic-review
  creation. `schedule_periodic_review` and `record_trigger_review` return 409
  `relationship_ended` for those cases.
- **Pause/resume**: `set_monitoring_status` handles `active`/`paused` with a
  reason; it cannot end a relationship, and reinstating monitoring on an
  ended relationship is MLRO-only (it reverses a regulatory record).
- **Read**: `case_monitoring_summary` powers the workspace section —
  relationship state, cycle interval, next/last review, screening-refresh due
  and overdue flag, open and recent reviews, open alerts and open EDD.

## 14. Trigger-based retention and audit integrity (Phase 11, §18 + §19)

§18 is explicit that retention **must not** be "automatic deletion seven years
after upload". The clock now starts at a recorded trigger event.

- **`aml.retention_triggers`** (browser read-only; service-role writes only)
  records, per record: category, `trigger_kind` (relationship_end ·
  occasional_transaction_complete · transaction_date ·
  program_version_obsolete · investigation_complete · report_complete ·
  legal_hold_release), trigger date, legal/program basis, retention period,
  derived `minimum_retention_date`, privacy restriction and disposal method.
  Re-recording **supersedes** the prior trigger (never edits it), so the basis
  for any retention decision stays reconstructable.
- **`record_retention_trigger`** requires a valid trigger kind and a legal
  basis (falling back to the schedule's). **`sync_case_triggers`** derives
  triggers from state already recorded elsewhere — Phase 10 relationship end,
  acknowledged reports, completed EDD — and is idempotent.
  **`list_retention_records`** returns the full §18 display contract
  including live legal-hold state and whether the retention period has run.
- **Disposal safety** — the §18 sequence is enforced end to end:
  1. `dry_run_scan` enumerates candidates **only** from operative triggers
     whose minimum retention date has passed; a record with no trigger has not
     started its clock and is never enumerated.
  2. Dependency check (`dependencyBlockersFor`): open regulatory report, open
     reporting obligation, open investigation, open alert, still referenced as
     evidence, or relationship not ended → `blocked`.
  3. Legal-hold check at scan and again at execution.
  4. MLRO approval (`request_approval` → `approve_scan`).
  5. Audit event on every step (hash-chained `records_audit_events`).
  6. **Disposal evidence** written only after the action succeeds, recording
     exactly what was performed (`hard_delete` row deletion vs `soft_marked`
     with no field-level redaction), the trigger, basis, approver, executor
     and both check results, hashed. A failed disposal is recorded `failed`,
     never `disposed`; an item whose trigger was superseded or whose date has
     not been reached is `blocked` even after approval.
- **§19 independent-review evidence**: `verify_audit_chain` recomputes every
  row hash and re-walks the `prev_hash` linkage for `aml.case_events` or
  `records_audit_events`, reporting `row_hash_mismatch` /
  `prev_hash_discontinuity` breaks — a reviewer establishes integrity rather
  than trusting the stored hashes. `export_audit_bundle` (MLRO-only, reason
  ≥10 chars, itself audited) emits the case, full event trail, retention
  records and legal holds with an embedded integrity statement and a
  bundle hash.
