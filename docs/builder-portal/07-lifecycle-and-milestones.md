# Proposed Builder transaction lifecycle and construction milestones

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Status:** proposed. No state machine is implemented in Phase 0.

## Transaction lifecycle

```text
Available
  → Temporarily Held
  → Reserved
  → Deposit Pending
  → Contract Issued
  → Contract Signed
  → Unconditional
  → Under Construction
  → Practical Completion
  → Handover Ready
  → Settlement Ready
  → Settled
```

### Proposed status values

`available` · `temporarily_held` · `reserved` · `deposit_pending` ·
`contract_issued` · `contract_signed` · `unconditional` · `under_construction` ·
`practical_completion` · `handover_ready` · `settlement_ready` · `settled`

Plus two terminal off-ramps that the linear list omits but which every real
pipeline needs: `withdrawn` and `terminated`. Without them a lapsed hold or a
rescinded contract has nowhere to go, and the state machine would be forced to
model failure as a reverse transition.

### Transition graph

| From | Permitted next |
| --- | --- |
| `available` | `temporarily_held`, `reserved`, `withdrawn` |
| `temporarily_held` | `reserved`, `available` (hold lapsed), `withdrawn` |
| `reserved` | `deposit_pending`, `available` (reservation released), `terminated` |
| `deposit_pending` | `contract_issued`, `reserved` (deposit failed), `terminated` |
| `contract_issued` | `contract_signed`, `terminated` |
| `contract_signed` | `unconditional`, `terminated` |
| `unconditional` | `under_construction`, `settlement_ready` (established stock), `terminated` |
| `under_construction` | `practical_completion`, `terminated` |
| `practical_completion` | `handover_ready` |
| `handover_ready` | `settlement_ready` |
| `settlement_ready` | `settled` |
| `settled` | terminal |
| `withdrawn`, `terminated` | terminal |

The only backward transitions are the three explicit failure paths above
(`temporarily_held → available`, `reserved → available`, `deposit_pending →
reserved`). Every other backward move is invalid and returns HTTP 409.

### Concurrency and conflict rules

Following the existing `update_case_task_status(_expected_version)` pattern:

- `builder_transactions` carries `row_version`. Every mutation supplies
  `expected_version`; a mismatch returns **409**.
- A unit has **at most one active reservation or hold** at a time, enforced by a
  partial unique index on `property_reservations(unit_id) WHERE released_at IS
  NULL AND expired_at IS NULL`. A second attempt returns **409**.
- An invalid transition returns **409**, not 400 — it is a state conflict, not a
  malformed request. This matches the programme's stated 409 contract.
- A temporary hold carries a server-computed `expires_at`. Expiry is evaluated
  server-side; a client-supplied expiry is ignored.
- Status is never written directly. It is the result of a guarded command that
  validates the transition, writes status history, writes a trusted audit record
  and enqueues an outbox event in one transaction.

### Status projection to other portals

| Builder status | Client Portal | Finance Portal | Solicitor Portal |
| --- | --- | --- | --- |
| `available`, `temporarily_held` | not visible | not visible | not visible |
| `reserved` | "Property reserved" | reservation recorded | not visible until contract |
| `deposit_pending` | "Deposit due" | deposit status | not visible |
| `contract_issued` | "Contract issued" | contract status | contract issued |
| `contract_signed` | "Contract signed" | contract status | contract executed |
| `unconditional` | "Unconditional" | unconditional | unconditional |
| `under_construction` | "Under construction" + approved milestones | milestones + progress claims | construction commenced |
| `practical_completion` | "Practical completion" | practical completion | completion notice |
| `handover_ready` | handover information | settlement readiness | settlement readiness |
| `settlement_ready` | settlement information | settlement readiness | settlement readiness |
| `settled` | settled | settled | settled |

Unreleased inventory (`available` and `temporarily_held`) is invisible outside
the owning Builder organisation. This is a data-boundary requirement, not a UI
choice.

## Construction milestones

```text
Site start
Base or slab
Frame
Lock-up
Fixing
Practical completion
Inspection
Defect rectification
Handover
Warranty
```

### Proposed milestone keys

`site_start` · `base_slab` · `frame` · `lock_up` · `fixing` ·
`practical_completion` · `inspection` · `defect_rectification` · `handover` ·
`warranty`

These map onto the existing shared `case_milestones` table with
`source_domain = 'builder'` and `authority = 'builder'` (GEN-03), each carrying
`milestone_type` from the list above, a `due_at`, a status from the existing
`case_milestones.status` CHECK list, and a `visibility`.

### Relationship to the existing `build_progress_payments`

`build_progress_payments` already models drawdown stages on `client_deals`
(`stage_number`, `stage_name`, `percentage`, lender submission and funds
release). It is **Finance-owned and internal** and carries commission-trigger
flags.

The correct relationship is:

- Builder owns the **construction milestone** (physical build state).
- Finance owns the **progress payment** (money movement, lender submission).
- A Builder progress claim references a construction milestone and is projected
  to Finance; Finance decides the drawdown.
- The Builder Portal never reads `build_progress_payments` or `builder_invoices`
  directly — those carry commission amounts (security risk SEC-06).

Reconciling the two stage vocabularies (`build_progress_payments.stage_name` is
free text) is migration risk MIG-05.

### Milestone authority and conflicts

`case_milestones` already carries an `authority` column and
`case_milestone_conflicts` already exists for competing sources. When a Builder
construction milestone and a Legal or Finance milestone disagree on the same
`milestone_type`, the existing conflict machinery applies unchanged — Builder
adds a source, not a parallel conflict system.

| Milestone type | Authority |
| --- | --- |
| Construction milestones (`site_start` … `handover`) | Builder |
| `practical_completion` | Builder |
| Contractual settlement date | Solicitor (existing) |
| Finance approval / clause dates | Finance (existing) |
| Estimated completion date | Builder, with Finance and Solicitor as readers |
| Sunset date | Solicitor, sourced from the contract |

### Client visibility

A construction milestone becomes client-visible only after an explicit Builder
approval action. Default `visibility` for a new Builder milestone is
`builder_private` (GEN-04); promotion to `shared` or `client` is a deliberate,
audited command. Construction photographs follow the same rule and additionally
pass through the immutable document service.
