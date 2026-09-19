# ADR 019: Builder domain records are separate from `transaction_cases`

## Status

Proposed. Blocks Phase 1 of the Builder / Developer Portal programme. Recorded
at baseline `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`. Depends on ADR 018.
Extends ADR 001 (transaction case backbone).

## Context

The Builder domain is large: organisations, developments, projects, stages,
estates, buildings, lots, units, house-and-land packages, inventory,
availability, reservations, holds, allocations, sales, deposits, contract issue
and execution status, construction cases, milestones, delays, variations, client
selections, progress claims, inspections, defects, practical completion,
handover, warranty, incentives and rebates.

At baseline none of it exists. The only construction-adjacent records are
`build_progress_payments` and `builder_invoices` — both keyed on `client_deals`,
both Finance-owned, both carrying Aurixa commission data, and neither carrying
any builder, project, stage or unit identity.

`transaction_cases` already exists as the shared identity anchor, with
`case_type` permitting `'construction'` and `transaction_case_links` carrying
three domain slots. The tempting shortcut is to add Builder columns to
`transaction_cases` — unit reference, construction status, estimated completion —
because the case is already joined to every portal.

ADR 001 explicitly rejected that shape for the original three domains: "A
monolithic cross-portal table collapses ownership." The same reasoning applies
here with more force, because the Builder domain has an entire hierarchy above
the transaction and an entire execution model below it.

There is a second, Builder-specific pressure. Most Builder records have **no
client at all**. A unit in `available` or `temporarily_held` state is inventory,
not a transaction. `transaction_cases.client_id` is `NOT NULL`. Modelling
inventory as cases is not merely untidy — it is impossible without weakening the
core constraint of the backbone.

## Decision

Builder domain records live in **Builder-owned tables**. `transaction_cases`
gains no Builder columns.

1. **One new link slot.** `transaction_case_links.builder_transaction_id uuid
   UNIQUE REFERENCES builder_transactions(id)`, plus `'builder_transaction'` in
   `transaction_case_link_history.domain_type` and `'builder_portal'` in
   `link_source`.

2. **`builder_transactions` is the only Builder aggregate the case knows about.**
   `property_units`, `property_reservations`, `construction_cases`,
   `builder_variations`, `builder_progress_claims`, `builder_inspections` and
   `builder_defects` are reached through it and are never linked to the case
   directly.

3. **Unsold inventory has no transaction case.** A case is created at the
   `reserved` transition, when a client first attaches. Before that the unit
   lives entirely in the Builder domain. This preserves `client_id NOT NULL` and
   keeps unreleased inventory out of every case-scoped read model and projection.

4. **The organisation hierarchy is six levels**, each an aggregate with its own
   parent foreign key: organisation → development → project → stage/building →
   lot/unit → transaction. Every child mutation is scoped to a server-verified
   parent; the chain is walked on the server.

5. **A project may have distinct developer and builder organisations**, expressed
   through `builder_project_parties (project_id, organisation_id, party_role)`
   with `party_role IN ('developer','builder','sales_agent','project_manager')`.
   `builder_organisations.org_type` is `'builder' | 'developer' |
   'builder_developer'`. There is no single `organisation_id` on a project.

6. **Shared services are used, not duplicated.** Builder creates no
   `builder_milestones`, `builder_messages`, `builder_documents` or
   `builder_notifications`. It uses `case_milestones` with
   `source_domain = 'builder'`, canonical `conversations`, the immutable
   `document_records` service, and shared `notification_deliveries`.

7. **The Builder claim and the Finance payment are distinct.** Builder owns
   `builder_progress_claims` (the claim against a construction milestone).
   Finance continues to own `build_progress_payments` (lender submission and
   funds release). Builder never reads or writes the Finance table.

## Invariants

- Every record linked to a case shares the case's `client_id`, enforced by
  `guard_transaction_case_links()`.
- Each `builder_transaction` belongs to at most one case; each case has at most
  one builder transaction.
- Link and unlink are atomic, actor-attributed and appended to
  `transaction_case_link_history`.
- Address similarity never creates a link (ADR 001, restated).
- Mutable Builder aggregates carry `row_version`; stale writes return **409**.
- A unit has at most one active reservation or hold, enforced by a partial unique
  index; a conflicting attempt returns **409**.
- Builder-private commercial data is never projected outside the Builder domain.

## Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| Builder columns on `transaction_cases` | Collapses ownership (ADR 001); cannot represent unsold inventory, which has no client |
| Reusing `client_deals` as the builder transaction | `client_deals` is Command Centre-owned, client-scoped, and has no project, stage or unit identity; overloading it would make one row answerable to two portals |
| Extending `build_progress_payments` into the Builder milestone model | Finance-owned, `client_deals`-keyed, free-text stage names, commission-trigger flags; the physical build state and the money movement are genuinely different concerns with different owners |
| Separate `builder_organisations` and `developer_organisations` tables | Duplicates identity, users, sessions and audit for one real-world concept; an entity that is both would need two rows and two logins |
| A single `organisation_id` on `builder_projects` | Cannot express a project with a distinct developer and builder, which is the common case |
| Linking `property_units` and `construction_cases` to the case directly | Turns the case into a container rather than a shared identity; multiplies the link surface and the cross-client guard obligations |

## Consequences

- The Builder domain is a substantial new schema surface, delivered across
  several phases rather than one migration.
- `guard_transaction_case_links()` and its trigger definition must be replaced in
  the same migration that adds the new column, including extending the trigger's
  `UPDATE OF` column list. A column without both is a cross-client linking hole
  (migration risk MIG-02).
- Two construction-stage vocabularies will coexist:
  `build_progress_payments.stage_name` (free text, in production) and the Builder
  milestone keys (controlled). They are reconciled by an explicit mapping applied
  at projection time; neither is rewritten (MIG-05).
- Builder transactions are **not** backfilled from `client_deals`. There is no
  evidence of which builder or project an existing deal belongs to, and inference
  is prohibited by ADR 001. Links are made explicitly by a human through the
  Command Centre administration page (MIG-07).

## Migration and rollback

Additive expansion only. New tables are created empty; no existing table, column
or behaviour is removed. Rollback for any phase is to stop writing the new
tables and leave them in place; the single additive column on
`transaction_case_links` is nullable and inert when unused.
