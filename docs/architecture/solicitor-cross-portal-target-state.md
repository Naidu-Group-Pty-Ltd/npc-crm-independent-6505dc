# Solicitor cross-portal architecture — target state

## Principles

- Keep Command Centre, Solicitor, Finance, and Client domain records separate.
- Add a lightweight transaction backbone; do not create a monolithic portal row.
- Client identity is an attribute, never an authorization boundary.
- A domain may propose a change to another domain, but cannot overwrite it.
- Every cross-portal write is a transactional command plus trusted audit and outbox.
- Every portal reads an audience-specific allow-listed projection.

## Transaction backbone

```text
                         transaction_cases
                                 |
              +------------------+------------------+
              |                  |                  |
        client_deals       purchase_files      legal_matters
       Command Centre         Finance             Legal
              |                  |                  |
              +------------------+------------------+
                                 |
          case_milestones -- conversations -- document_records
               case_tasks -- messages       -- document_versions
                                 |
          Command Centre / Client / Finance / Solicitor projections
```

`transaction_cases` carries shared identity, coordination state, lifecycle,
`client_id`, canonical property identity, jurisdiction, risk level, timestamps,
and `row_version`. `transaction_case_links` carries explicit links, provenance,
actor, and time. Every linked record must have the same client; each domain record
can belong to at most one case. Unlinking is audited. Address similarity alone
never creates a link.

## Authoritative field ownership

| Data | Authority |
| --- | --- |
| Client identity/contact | Command Centre `clients` |
| NPC programme/deal stage | Command Centre |
| Loan, lender, finance approval | Finance |
| Legal workflow/searches/requisitions/conflicts | Solicitor/legal |
| Contractual settlement after exchange | Solicitor/legal |
| Shared transaction identity | Transaction case |
| Cross-party milestones/tasks | Shared case services with declared source authority |
| Private legal notes | Solicitor only |
| Private finance notes | Finance only |
| Customer progress | Sanitised case projection |

## Audience contracts

| Projection | Allowed examples | Always excluded examples |
| --- | --- | --- |
| Solicitor | Legal workflow, parties, searches, private legal notes, sanitised finance status | Income/assets/liabilities, private finance notes, restricted AML/SMR |
| Finance | Finance file, lender state, contractual milestones, sanitised legal state/contact | Practice notes, conflict detail, privileged advice |
| Client | Friendly status, shared summary, visible milestones/tasks/documents, legal conversation | Legal/NPC/Finance private notes, conflicts, privileged communications |
| Command Centre | Operational health, shared status, failures, assignments, NPC/client summaries | Practice-private notes by default |

These become separately named DTO/select contracts. Client data is materialised
into a sanitised read model rather than read directly from operational legal rows.

## Access, workflow, events, messages, and documents

- `solicitor_matter_access` grants a user access to one exact non-null-firm
  matter, independently of workflow ownership. Grants expire and can be revoked.
- Policy values are `inherit | allow | deny`; an explicit matter value wins over
  baseline. Permanent forbidden keys remain hard-denied.
- Commands lock aggregates, validate `expected_version` and transition graphs,
  enforce blockers, update state/history/audit/outbox, and commit atomically.
  Stale or invalid transitions return HTTP 409.
- `integration_outbox` uses aggregate/event versions, idempotency keys,
  correlation IDs, retries, dead letters, checkpoints, and reconciliation runs.
- Conversations use canonical participants, messages, attachments, and receipts;
  portals do not copy messages into separate stores.
- Logical document records point at immutable hashed/scanned versions with
  audience grants. Superseded objects remain subject to retention/legal hold.
- AI processing requires firm opt-in, per-document permission, redaction,
  prompt/model/source provenance, idempotency, budgets, residency/retention
  acknowledgement, and human review.

## Delivery and rollback

Phases 1–14 expand behind server-evaluated feature flags and compatibility
adapters. Dual-read mismatches are measured without leaking payloads. Cutover
requires reconciliation. Legacy columns/tables survive until Phase 15. Each phase
has its own migration, branch, PR, rollback criteria, and contract/security gates.

## Phase 3 governance and projection contract

Legal resource APIs apply one server-side governance gate after authentication: password rotation, acceptance of the current effective terms version, mandatory onboarding, and active user/practice are all required. Browser route guards improve the journey but are not authorization controls.

Matter data is selected by audience. Solicitor list/search is note-free and Solicitor detail alone includes practice `internal_notes`; Command Centre uses `npc_internal_notes`; Finance receives a minimal legal summary; Client Portal reads only `client_legal_case_summary`. Future phases must extend these contracts rather than reverting to `select('*')` or a shared broad selection.
