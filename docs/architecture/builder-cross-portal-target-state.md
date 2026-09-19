# Builder cross-portal architecture — target state

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Status:** proposed. Nothing here is implemented in Phase 0.

## Principles

- Keep Command Centre, Client, Finance, Solicitor and Builder domain records
  separate. The Builder domain is a fourth peer, not an extension of an existing
  one.
- Extend the existing transaction backbone; never create a second one.
- Client identity is an attribute, never an authorization boundary.
- A domain may propose a change to another domain, but cannot overwrite it.
- Every cross-portal write is a transactional command plus trusted audit and
  outbox event.
- Every portal reads an audience-specific allow-listed projection.
- Builder-private commercial data never leaves the Builder domain without an
  explicit governed contract.

## Portal topology

```text
Aurixa Command Centre  (internal, Supabase auth)
├── Client Portal administration
├── Finance Portal administration
├── Solicitor Portal administration
└── Builder / Developer Portal administration   /admin/builder-portal
                                                 ModuleGuard builder_portal_admin

Separate external portals  (route siblings, own providers, own sessions)
├── Client Portal              /client-portal/*
├── Finance Portal             /finance/*
├── Solicitor Portal           /solicitor/*
└── Builder / Developer Portal /builder/*
                               BuilderPortalAuthProvider
                               __Host-builder_session_token (HttpOnly)
```

## Transaction backbone

```text
                              transaction_cases
                                      |
        +----------------+------------+-------------+----------------+
        |                |                          |                |
  client_deals     purchase_files            legal_matters   builder_transactions
 Command Centre       Finance                    Legal            Builder
                                                                      |
                                              property_units, property_reservations,
                                              construction_cases, builder_variations,
                                              builder_progress_claims,
                                              builder_inspections, builder_defects
                                      |
        case_milestones -- case_tasks -- conversations -- document_records
                                      |
                              integration_outbox
                                      |
   client_case_read_model  finance_case_read_model  solicitor_case_read_model
   builder_case_read_model  command_case_health_read_model
```

`transaction_cases` gains no Builder columns. It gains one link slot,
`transaction_case_links.builder_transaction_id`, under the same invariants as the
existing three: same `client_id` enforced by trigger, at most one case per domain
record, atomic and audited link changes, never an address match.

Unsold inventory has no transaction case. A case exists only once a client is
attached at the `reserved` transition.

## Builder domain hierarchy

```text
Builder or Developer Organisation   builder_organisations
        ↓
Development                          builder_developments
        ↓
Project                              builder_projects
        ↓                            builder_project_parties  (org × project × party_role)
Stage or Building                    builder_project_stages
        ↓
Lot or Unit                          property_units
        ↓
Builder Transaction                  builder_transactions
        ↓
Transaction Case                     transaction_cases (via link)
```

A project may have distinct developer and builder organisations, expressed
through `builder_project_parties.party_role`, not through a single
`organisation_id`. See `docs/builder-portal/05-organisation-and-access-hierarchy.md`.

## Authoritative field ownership

| Data | Authority |
| --- | --- |
| Client identity and contact | Command Centre `clients` |
| NPC programme and deal stage | Command Centre |
| Loan, lender, finance approval, drawdown | Finance |
| Legal workflow, searches, requisitions, conflicts | Solicitor |
| Contractual settlement date after exchange | Solicitor |
| Sunset date | Solicitor, sourced from the contract |
| Property inventory identity, availability, release state | Builder |
| Unit pricing (list and released) | Builder |
| Reservations, holds, allocations | Builder |
| Construction milestones and physical build state | Builder |
| Estimated completion date | Builder |
| Variations | Builder, with client approval where required |
| Progress claims (the claim) | Builder |
| Progress payments (the money) | Finance |
| Inspections, defects, practical completion, handover | Builder |
| Warranty | Builder |
| Shared transaction identity | Transaction case |
| Cross-party milestones and tasks | Shared case services with declared source authority |
| Builder-private commercial data | Builder only, never projected |

The full matrix, including read and write permissions per portal, is
`builder-cross-portal-field-ownership.md`.

## Audience contracts

| Projection | Allowed examples | Always excluded |
| --- | --- | --- |
| Builder | Own inventory, own construction state, own transactions, sanitised finance status, sanitised legal status, client identity for linked transactions | Income, expenses, assets, liabilities, employment, borrowing capacity, serviceability, AML/SMR/MLRO, commissions, privileged legal advice, conflict checks, finance-private and Command-Centre-private notes |
| Client | Purchased property, approved plans and inclusions, reservation and contract progress, approved construction milestones and photographs, estimated completion, variations requiring action, inspection and defect progress, handover, approved documents | Construction costs, margins, supplier and contractor pricing, internal sales notes, internal delay reasons, unreleased inventory and pricing, internal dispute commentary |
| Finance | Property identification, purchase price, deposit status, contract status, construction milestones, progress claims, valuation access, approved variations affecting finance, estimated completion, settlement readiness | Builder cost and margin data, internal sales notes, internal delay reasons, unreleased inventory |
| Solicitor | Builder or developer legal entity, property identification, contracts and amendments, plans and specifications, deposit status, sunset dates, completion notices, occupancy documents, settlement readiness | Builder cost and margin data, internal sales notes, commercial negotiations, internal dispute commentary |
| Command Centre | Operational health, portal readiness, integration health, assignment state, audit records | Builder-private commercial detail by default |

Each contract is a separately named projection select on the server. There is no
`select('*')` and no shared broad selection.

## Access, workflow, events, messages and documents

- `builder_user_access` grants a user access at one exact scope level
  (organisation, development, project, stage, unit or transaction) within a
  verified organisation. Grants expire and are revocable.
- Policy values are `inherit | allow | deny`. The most specific scope wins; at
  equal specificity `deny` wins. There is no default-allow key set and no
  OR-merge path. `read_only` clamps `edit` and `delete` after resolution.
- `BUILDER_FORBIDDEN_KEYS` is hard-denied inside `can()` and stripped by the
  admin control plane, independent of any stored matrix.
- Commands lock the aggregate, validate `expected_version` and the transition
  graph, write state, history, trusted audit and outbox in one transaction, and
  return **409** for stale writes, duplicate active allocations, conflicting
  reservations, invalid transitions and concurrency failures.
- High-risk mutations fail closed when the trusted audit write fails.
- Builder milestones are rows in the shared `case_milestones` with
  `source_domain = 'builder'`; the existing `case_milestone_conflicts` machinery
  handles disagreement with Legal and Finance sources unchanged.
- Builder participates in canonical `conversations` as `builder_user` /
  `builder_org`; no Builder message store is created.
- Builder documents are `document_records` with immutable hashed and scanned
  `document_versions` and `document_access_grants` naming a `'builder'` audience;
  no Builder document table is created.

## Internal administration

`/admin/builder-portal` inside `DashboardLayout` behind
`ModuleGuard moduleKey="builder_portal_admin"`, with the module key registered in
`dashboard_modules` in the same migration that first uses it. Server-side
enforcement is `verifyAuth()` + `requireModulePermission('builder_portal_admin')`
+ `enforceCsrf()`. The service role lives only in `builder-portal-admin`.

No internal navigation surface ever links to `/builder/*`, and the external
portal is never a `dashboard_modules` row.

## Delivery and rollback

Phases expand behind server-evaluated feature flags and compatibility adapters.
Dual-read mismatches are measured without leaking payloads. Cutover requires
reconciliation. No table, column or behaviour is removed during expansion.

**Ordering constraint.** The cutover control plane
(`cross_portal_firm_rollouts` and its four sibling tables) currently keys on
`solicitor_firms`. Generalising it is a prerequisite for any flag-controlled
Builder rollout, because a Builder cutover with no flag has no rollback path.
That generalisation is a phase of its own with its own ADR, and it precedes
Builder feature work.

Each phase has its own branch, pull request, timestamped migration, rollback
criteria, contract tests and security gates.
