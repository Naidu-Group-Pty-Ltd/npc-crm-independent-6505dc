# Builder / Developer domain boundaries

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Status:** proposed. No table in this document is created in Phase 0.

## Principle

The transaction case is a **shared identity**, not a shared record store.
Builder-specific data lives in Builder-owned tables. `transaction_cases` gains no
Builder columns; it gains one link slot (`builder_transaction_id`, GEN-09).

```text
transaction_cases              shared identity, thin
├── client_deals               Command Centre domain
├── purchase_files             Finance domain
├── legal_matters              Legal domain
└── builder_transactions       Builder domain          <-- proposed
        │
        ├── property_units          inventory identity
        ├── property_reservations   holds and allocations
        ├── construction_cases      build execution
        ├── builder_variations
        ├── builder_progress_claims
        ├── builder_inspections
        └── builder_defects
```

## Proposed Builder-owned aggregates

| Aggregate | Purpose | Key relationships |
| --- | --- | --- |
| `builder_organisations` | Builder or developer legal entity | root of the hierarchy |
| `builder_portal_users` | Portal identity | `→ builder_organisations` |
| `builder_developments` | A land release or masterplan | `→ builder_organisations` (owning org) |
| `builder_projects` | A deliverable project within a development | `→ builder_developments` |
| `builder_project_stages` | Stage or building | `→ builder_projects` |
| `property_units` | Lot, unit or house-and-land package | `→ builder_project_stages` |
| `property_reservations` | Temporary hold, reservation, allocation | `→ property_units` |
| `builder_transactions` | A sale of one unit to one client | `→ property_units`, `→ transaction_cases` via link |
| `construction_cases` | Build execution for one transaction | `→ builder_transactions` |
| `builder_variations` | Client and builder-initiated changes | `→ builder_transactions` |
| `builder_progress_claims` | Drawdown claims | `→ construction_cases` |
| `builder_inspections` | Scheduled and completed inspections | `→ construction_cases` |
| `builder_defects` | Defect register and rectification | `→ construction_cases` |
| `builder_project_parties` | Which org plays which role on a project | `→ builder_projects`, `→ builder_organisations` |

Milestones, tasks, conversations, documents, notifications and audit come from
the shared services. Builder does **not** create `builder_milestones`,
`builder_messages`, `builder_documents` or `builder_notifications`.

## Data classification

### Builder-private — never leaves the Builder domain

Internal construction costs · profit margins · supplier prices · contractor
prices · internal feasibility information · internal sales notes · private
project risks · internal delay reasons · commercial negotiations · unreleased
inventory · unreleased pricing · internal dispute commentary · internal
management notes · staff performance information.

Enforcement: these columns live on Builder tables only, are excluded from every
named projection select, and any shared row carrying them uses
`visibility = 'builder_private'` (GEN-04). No document access grant may name a
non-Builder audience for a Builder-private document.

### Never enters the Builder Portal

Solicitor-private notes · privileged legal advice · conflict-check results ·
client borrowing calculations · serviceability information · client income,
expenses, assets, liabilities and employment · AML/CTF records · MLRO notes ·
finance-private notes · Command Centre-private notes · commission ledgers.

Enforcement: a `BUILDER_FORBIDDEN_KEYS` set, hard-denied inside the Builder
`can()` equivalent independent of any stored matrix, following the
`SOLICITOR_FORBIDDEN_KEYS` pattern but with a Builder-appropriate list:

```text
income · expenses · assets · liabilities · employment · borrowing_capacity ·
serviceability · commissions · aml_restricted · smr · mlro ·
legal_privileged · conflict_checks · finance_private · command_private ·
solicitor_private
```

The Builder admin control plane must strip these keys before persisting any
permission matrix, exactly as `solicitor-portal-admin` does today.

## Outbound governed contracts

Each list below is an **allow-list**. A field not named is not shared. Every
contract is a named projection select on the server, never `select('*')`.

### Builder → Client Portal (approved and sanitised only)

purchased property details · approved plans · approved inclusions · reservation
progress · contract progress · approved construction milestones · approved
construction photographs · estimated completion information · variations
requiring client action · inspection information · defect progress · handover
information · approved documents.

Every item requires an explicit Builder approval action before it becomes
client-visible. There is no implicit client visibility.

### Builder → Finance Portal (finance-relevant only)

property identification · purchase price · deposit status · contract status ·
construction milestones · progress claims · valuation access · approved
variations affecting finance · estimated completion · settlement readiness.

Excluded: internal cost, margin, supplier and contractor pricing, internal
delay reasons, unreleased inventory and pricing.

### Builder → Solicitor Portal (legally relevant only)

builder or developer legal entity · property identification · contracts ·
contract amendments · plans and specifications · deposit status · sunset dates ·
completion notices · occupancy documents · settlement readiness.

Excluded: internal cost and margin data, internal sales notes, commercial
negotiations, internal dispute commentary.

### Builder → Command Centre

Operational health, portal readiness, integration health, assignment state and
audit records. Builder-private commercial detail is not projected into the
Command Centre by default; any exception requires an explicit governed contract
and an ADR.

## Inbound contracts

| From | Builder may read | Builder must never read |
| --- | --- | --- |
| Command Centre | client identity for a linked transaction, shared lifecycle status | NPC-internal notes, commission ledger |
| Finance | finance status, finance clause date, settlement readiness signal | lender selection detail, borrowing capacity, income and liabilities, AML records, finance-private notes |
| Solicitor | contractual settlement date, legal status, completion notices | practice-internal notes, privileged advice, conflict-check results |
| Client | client-initiated selections, variation approvals, defect reports | anything not directed at the Builder |

## Boundary invariants

1. Every Builder child-resource mutation is scoped to a server-verified parent.
   Organisation, development, project, stage, building, lot, unit, transaction,
   case and client IDs supplied by the browser are treated as untrusted input.
2. A Builder user's reachable set is derived server-side from their grants; it is
   never derived from an ID in the request.
3. Prices, deposits, completion dates, milestone statuses, document visibility,
   MIME types and file sizes are never trusted from the client. MIME type and
   byte size are established by the document processing pipeline, matching the
   existing `complete_document_processing()` behaviour.
4. Cross-domain projection is one-directional and explicit. A Builder write never
   overwrites a Finance-owned or Legal-owned field; it proposes, and the owning
   domain decides. See `docs/architecture/builder-cross-portal-field-ownership.md`.
5. Unreleased inventory and unreleased pricing are invisible outside the owning
   Builder organisation until an explicit release action occurs.
