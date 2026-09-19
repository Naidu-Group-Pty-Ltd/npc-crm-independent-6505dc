# Migration-risk assessment

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`

Phase 0 changes no schema. Every risk below is a risk to a **later** phase and is
recorded now so the mitigation is designed before the migration is written.

Severity: **High** — can corrupt or lose data, or is one-way.
**Medium** — can silently break a boundary or a consumer.
**Low** — mechanical, reversible.

## MIG-01 — `portal_terms_acceptances` owner generalisation · High

`portal_terms_acceptances` today is:

```sql
portal            text NOT NULL CHECK (portal='solicitor')
solicitor_user_id uuid NOT NULL REFERENCES solicitor_portal_users(id) ON DELETE CASCADE
UNIQUE (terms_version_id, solicitor_user_id)
```

Supporting Builder terms acceptance requires dropping a `NOT NULL`, adding a
nullable `builder_user_id`, adding an exactly-one-owner CHECK, and replacing the
composite unique constraint. Dropping a `NOT NULL` is effectively one-way:
restoring it later requires every row to have a non-null value, which will be
false once Builder rows exist.

**Mitigation.** Do the whole change in one migration, in this order: add
`builder_user_id`; add `CHECK (num_nonnulls(solicitor_user_id, builder_user_id) = 1)`
as `NOT VALID`, then `VALIDATE`; create the two partial unique indexes
(`... WHERE solicitor_user_id IS NOT NULL` and `... WHERE builder_user_id IS NOT
NULL`); only then drop the old composite unique and the `NOT NULL`. Never drop
the `NOT NULL` first. Verify zero rows violate the exactly-one CHECK before
validating.

**Alternative to evaluate first.** A separate `builder_terms_acceptances` table
avoids the one-way change entirely at the cost of a second acceptance store. This
is one of the few places where a Builder-specific table may be justified; the
decision belongs in an ADR before the migration is written.

## MIG-02 — `transaction_case_links` slot without a guard clause · High

Adding `builder_transaction_id` without simultaneously extending
`guard_transaction_case_links()` **and** the trigger's `UPDATE OF` column list
creates a cross-client linking hole. An `UPDATE` touching only the new column
would not fire the trigger at all.

**Mitigation.** Column, `domain_type` CHECK, guard function and trigger
definition ship in one migration. A contract test asserts that a cross-client
builder link raises `CROSS_CLIENT_CASE_LINK`, and that an update of only
`builder_transaction_id` fires the trigger.

## MIG-03 — Five `cross_portal_*` tables FK to `solicitor_firms` · High

`cross_portal_firm_rollouts`, `cross_portal_rollout_history`,
`cross_portal_dual_read_comparisons`, `cross_portal_cutover_approvals` and
`cross_portal_reconciliation_runs` all reference `solicitor_firms(id)`, and
`resolve_cross_portal_feature_mode(_firm_id, _feature_key)` reads the first of
them. The Builder Portal therefore cannot use the platform's own feature-flag and
cutover control plane without generalising all five.

**Mitigation.** Treat this as its own phase with its own ADR. Options: (a) add
`org_kind` + `org_id` alongside the existing `firm_id`, keeping `firm_id`
populated for solicitor rows through a compatibility adapter; (b) introduce a
`portal_organisations` supertype that `solicitor_firms` and
`builder_organisations` both key into. Option (b) is cleaner and more expensive.
Do not begin Builder cutover work before this is decided — a Builder rollout with
no flag control has no rollback path.

## MIG-04 — Widening a CHECK without updating its consumers · Medium

Adding `'builder'` to `case_milestones.source_domain`, `'builder_private'` to the
visibility lists, `'builder_user'` to `case_task_assignments.assignee_type`,
`'builder_user'` / `'builder_org'` to `conversation_participants.participant_type`
or `'builder'` to `document_access_grants.audience` makes rows *storable* before
the functions that read them know what to do with them.

Specific hazards:

- `guard_conversation_participant_scope()` — a Builder participant type it does
  not recognise may fall through to a permissive default.
- `authorize_document_download()` and `list_accessible_documents()` — a Builder
  audience grant exists but never authorises, or worse, matches a default branch.
- `get_case_runway(_case_id, _audience)` — an unrecognised audience may return
  the wrong visibility set.
- Any `CASE` on `visibility` that lacks a `builder_private` arm leaks
  Builder-private rows through its `ELSE`.

**Mitigation.** Every CHECK widening ships in the same migration as the update to
every function that switches on that column. Enumerate the consumers first:
`grep` the migration corpus for the column name before writing the change. A
contract test asserts a Builder-private row is invisible to every non-Builder
audience.

## MIG-05 — Two construction-stage vocabularies · Medium

`build_progress_payments.stage_name` is free text on `client_deals`, already in
production use. Builder construction milestones introduce a controlled
vocabulary (`site_start`, `base_slab`, `frame`, `lock_up`, `fixing`,
`practical_completion`). The two will disagree.

**Mitigation.** Do not migrate or rewrite `build_progress_payments`. Builder
milestones are new rows in `case_milestones` with `source_domain = 'builder'`.
Add a mapping table or a documented mapping function from free-text stage names
to milestone keys, applied at projection time only. Reconcile in a read-only
report before any behaviour depends on the mapping. Preserve
`build_progress_payments` exactly as-is; it drives commission triggers.

## MIG-06 — Reservation uniqueness backfill · Medium

The one-active-reservation-per-unit rule is enforced by a partial unique index.
If reservations are ever imported from an external builder CRM, duplicates will
exist at import time and the index creation will fail.

**Mitigation.** Create the index `CONCURRENTLY` after a reconciliation query
proves zero duplicates. Write duplicates to a
`builder_reservation_reconciliation_issues` table (following
`transaction_case_reconciliation_issues`) rather than silently resolving them.
Never auto-resolve a duplicate reservation — it represents two people believing
they hold the same property.

## MIG-07 — Backfilling Builder transactions from `client_deals` · Medium

`client_deals` with `deal_type` indicating house-and-land carry `build_price`,
`construction_loan_type`, `expected_build_start` and `estimated_completion`.
These look like Builder transactions but have no builder organisation, no
project, no stage and no unit.

**Mitigation.** Do **not** infer Builder transactions from `client_deals`. There
is no evidence of which builder or project a deal belongs to; any inference is a
guess, and the platform's stated principle is that address similarity and
inference never create links (ADR-001). Builder transactions are created going
forward. Existing deals link to a Builder transaction only when a human makes the
link explicitly through the Command Centre administration page.

## MIG-08 — `PortalDomain` widening in `crossPortalFieldOwnership.ts` · Low

Adding `'builder'` to the union type is mechanical. The risk is in the rules, not
the type: a rule that lists `'builder'` in `readable_by` for a Finance-private or
Legal-private field silently opens a boundary.

**Mitigation.** The field-ownership matrix is reviewed as a security artefact,
not a type change. `tests/builder-portal/phase0-builder-domain-boundaries.test.mjs`
characterises the current rule set so any addition is visible in the diff.

## MIG-09 — Enum versus CHECK for the Builder role column · Low

`solicitor_portal_role` is a Postgres enum, so adding a role is a migration and
removing one is effectively impossible. The Builder role set is larger and less
settled (eleven proposed roles with four open questions).

**Mitigation.** Use `text` with a `CHECK` constraint for
`builder_portal_users.portal_role`. Widening is a constraint replacement.

## MIG-10 — Missing `dashboard_modules` registration · Low

`solicitor_portal_admin` is used by `ModuleGuard`, three navigation surfaces and
three Edge Functions, but no migration inserts it into `dashboard_modules`.
Whatever grants the permission today is not the migration corpus.

**Mitigation.** Register `builder_portal_admin` in `dashboard_modules` in the
same migration that first uses it. Investigate and, if confirmed, repair the
`solicitor_portal_admin` gap in the same change — it is a pre-existing defect,
not Builder scope, but it will be cheapest to fix while the file is open.

## Delivery constraints (binding for every later phase)

- One phase per branch, one phase per pull request.
- Timestamped migrations, non-destructive expansion only.
- Backfill before cutover; reconcile before legacy removal.
- Compatibility adapters where a consumer cannot change in the same phase.
- Feature flags for every cutover (which requires MIG-03 to be resolved first).
- No table, column or behaviour is removed during expansion.
