# 44 — The extraction boundary, measured

The Builder Portal is being extracted from the per-clone deployment to a
central multi-vendor platform — one Supabase project serving every workspace,
at `builders.aurixasystems.com.au`, with one auth gateway and a
connection/handshake graph back to each clone. This document records what the
boundary between the builder schema and the rest of the prime **actually is**,
measured rather than believed, because the two disagree in both directions.

Run the measurement, don't re-read it: `npm run builder:db:network-check`
builds a database containing nothing of the prime, replays every builder
migration against `scripts/builder-portal/local-db/02-network-standalone.sql`,
and audits the boundary from `pg_constraint`. This page records what that run
and the production catalogue established on 2026-09-14; the run is the fact,
this page is the explanation.

## The filename is not the boundary, in either direction

- **23 migrations that touch builder objects do not carry "builder" in their
  name** — among them `20260801000300_portal_terms_multi_portal` (the one-way
  MIG-01 generalisation), `20260801000400_cross_portal_rollout_org_
  generalisation` (which seeds `builder_portal_identity_v1` and adds
  `builder_organisation_id` to five rollout tables), and
  `20260901000700_partner_portal_agreement_cascade`.
- **One migration that carries "builder" is not the portal's**:
  `20260717000000_add_builder_invoice_current_payment` is a Command Centre
  finance feature. `builder_invoices` / `build_progress_payments` are finance
  tables that merely wear the prefix, and they stay in the clone.

So the boundary is enumerated from `pg_constraint`, never from a glob — and
any decommission migration must be written from the production catalogue, not
from the file list.

## The measured foreign-key boundary

**Outbound (builder → prime): exactly two, both to `public.clients`.**

| edge | rule | replacement in the network |
|---|---|---|
| `builder_transactions.client_id` | `SET NULL` | `(connection_id, remote_client_ref)` — opaque, workspace-minted |
| `builder_stock_selections.client_id` | `NOT NULL … CASCADE` | the selection's client half stays in the CLONE; the network holds only a selection announcement |

**Inbound (prime → builder): nine in production, and seven cascade.**

| edge | rule |
|---|---|
| `transaction_case_links.builder_transaction_id` | `SET NULL` — the fourth domain slot; stays in the clone, re-pointed at the mirror |
| `document_processing_jobs.builder_document_version_id` | `CASCADE` — the queue travels; this edge becomes internal to the network |
| `portal_terms_acceptances.builder_user_id` | `CASCADE` |
| `aml.partner_organisations.builder_organisation_id` | `NO ACTION` |
| `cross_portal_firm_rollouts.builder_organisation_id` | `CASCADE` |
| `cross_portal_rollout_history.builder_organisation_id` | `CASCADE` |
| `cross_portal_cutover_approvals.builder_organisation_id` | `CASCADE` |
| `cross_portal_dual_read_comparisons.builder_organisation_id` | `CASCADE` |
| `cross_portal_reconciliation_runs.builder_organisation_id` | `CASCADE` |

The inbound side is where the decommission risk lives: `DROP TABLE
builder_organisations CASCADE` would take rows from five `cross_portal_*`
tables the **Solicitor** cutover also lives in, and from
`portal_terms_acceptances`, which holds every portal's consent records. Drop
constraints first, tables second, and never let `CASCADE` decide.
`cross_portal_reconciliation_runs` is the cautionary example: its builder FK
appears in **no** builder-named migration at all.

Nothing in the builder schema references `auth.users` structurally — but
`builder_stock_selections.selected_by_user_id` carries an `auth.users` id **by
convention with no FK**, so a naive `pg_dump --table='builder_*'` exports clone
staff identities. The transform strips it.

## The corpus cannot be replayed in version order

The stock settlement migrations carry August version strings
(`20260816140000_…`) while the tables they alter are created by
`20260915000000_builder_stock_list_marketplace`. Production holds all of them
because they were applied in merge order, which no fresh replay can recover —
13 of 59 files only apply on a second pass. Two consequences:

1. `network-standalone-check.mjs` replays by **fixpoint** (apply what can be
   applied, defer the rest, stop when a pass makes no progress) and prints the
   deferred set, which is the real dependency order.
2. The network's baseline **must be a consolidated squash**. Replaying the
   files into a fresh project is not a conservative alternative — it is not
   possible.

## What `02-network-standalone.sql` means

- **Part 1 — travels.** Terms (reshaped to `builder_terms_*`, other portals'
  columns gone), the document-processing queue (reshaped builder-only), feature
  flags, operational events/alerts, the outbox's dead-letter ledger. The
  network owns its own copy of each.
- **Part 2 — shims.** `clients`, the transaction-case spine, the Command
  Centre module registry, and the cross-portal release-control plane. Each is
  deleted by the Phase 2 squash; **the shim list is the squash's edit list**,
  and when the squash exists, applying it against Part 1 alone must succeed.

A builder migration that fails against this fixture means the boundary moved:
update the fixture and the extraction plan together, or the plan is describing
a schema that no longer exists.
