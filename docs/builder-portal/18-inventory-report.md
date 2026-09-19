# Builder / Developer Portal — Inventory module report

**Branch:** `claude/builder-portal-complete`
**Base:** the Phase 3 head (`4faa876`), not `main` — see §7.
**Status:** the Inventory module is complete. The modules after it are not.

## 1. What was built

| Layer | Artefact |
| --- | --- |
| Database | `supabase/migrations/20260804000000_builder_portal_inventory.sql` — 10 tables, 1 widened guard, 2 parentage triggers, 1 resolver, 1 accessible-set function, 13 guarded commands, 5 post-migration assertions |
| Server access control | `builder_resolve_unit_permission()`, `builder_accessible_units()`, widened `builder_guard_permission_scope()` |
| Edge Functions | `builder-portal-inventory` (external, cookie session), `builder-inventory-admin` (internal, staff JWT + `builder_portal_admin` + CSRF) |
| Shared helpers | `supabase/functions/_shared/builderInventory.ts` |
| Internal administration | `src/components/admin/builder-portal/AdminBuilderInventoryPanel.tsx`, wired as an **Inventory** tab on `/admin/builder-portal` |
| External pages | `src/pages/builder/BuilderInventory.tsx`, `src/pages/builder/BuilderUnitDetail.tsx` |
| Frontend client | `src/lib/builderInventory.ts`; hooks added to `src/lib/builderQueries.ts` |
| Navigation | `/builder/inventory` enabled in `BuilderPortalLayout` |
| Routes | `inventory` and `inventory/:unitId` inside the `/builder/*` sibling tree |

### Tables

`builder_stages`, `builder_buildings`, `builder_lots`, `builder_units`,
`builder_unit_pricing`, `builder_unit_holds`, `builder_reservations`,
`builder_allocations`, `builder_unit_status_history`,
`builder_reservation_status_history`.

Every one: RLS enabled, `REVOKE ALL … FROM anon, authenticated`, no
`USING (true)`, `row_version`, and a post-migration assertion that fails the
migration if RLS is missing anywhere.

### Guarded commands

`builder_upsert_stage`, `builder_upsert_building`, `builder_upsert_lot`,
`builder_upsert_unit`, `builder_transition_unit_availability`,
`builder_transition_unit_release`, `builder_set_unit_price`,
`builder_create_unit_hold`, `builder_release_unit_hold`,
`builder_create_reservation`, `builder_transition_reservation`,
`builder_create_allocation`, `builder_release_allocation`.

Each writes its state change and its `builder_log_activity` row in **one**
transaction. Neither Edge Function calls `.insert()`, `.update()`, `.delete()`
or `.upsert()` on a Builder table — a contract test asserts that.

## 2. Access control

The security centrepiece is `builder_resolve_unit_permission`:

1. The parent project's decision is authoritative. A project denial denies the
   unit immediately.
2. An active membership of the granting organisation is required and is read
   **before** any override runs. A missing one returns false.
3. A stage-scoped override may DENY.
4. A unit-scoped override may DENY.

No scoped override can allow. This is proved behaviourally, not asserted: the
local-database verification grants `inventory.view = allow` at stage scope, at
unit scope, and at both, then revokes the membership and confirms access stays
denied in every combination.

In the Edge Function, `loadUnit()` resolves the parent project first
(`resolveBuilderProjectAccess` → session organisation match → project still names
that organisation on the granted side → `projects.view`), then calls the database
resolver. A unit whose project the caller cannot see returns **404**, never 403 —
probing unit ids must not reveal that one exists.

The `project_id` filter on `list_units` and `inventory_stats` is intersected
server-side with the caller's accessible projects. An arbitrary id in the request
narrows the result; it can never widen it.

Holds and reservations are always created for the **session's** organisation.
`body.organisation_id` is never read anywhere in the portal function.

## 3. Data boundaries

The migration ends with an assertion that fails the migration if any inventory
column name matches `%cost%`, `%margin%`, `%supplier%` or `%contractor_price%`.
No such column exists, so no select list can name one.

Neither function references `builder_invoices`, `build_progress_payments`,
`client_financials`, any `aml_` table or any commission table. The security check
enforces this across every Builder function.

A reservation records a purchaser by name, email and phone, plus the agreed
reservation fee. It does not reach into the Client aggregate, and it is not a
Finance ledger entry — receipt and reconciliation remain Finance-owned.

## 4. Concurrency

Every mutable aggregate carries `row_version`. Every update path requires
`expected_version`:

- Missing → **HTTP 400**, code `EXPECTED_VERSION_REQUIRED`. It is never silently
  replaced with the current database value; a contract test asserts the
  substitution pattern does not appear in either function.
- Stale → **HTTP 409**, code `STALE_VERSION`.
- The check is inside the guarded command, under `FOR UPDATE`, so it is atomic.

Status transitions additionally check the current status (`STALE_STATUS`, 409)
and the transition allow-list (`INVALID_TRANSITION`, 409).

A unit cannot move to `released` without a current price
(`BUILDER_UNIT_PRICE_REQUIRED`), and partial unique indexes enforce one active
hold, one live reservation, one active allocation and one current price per unit.

## 5. Test results

| Suite | Result |
| --- | --- |
| `npm run builder:db:verify:inventory` (live PostgreSQL) | **136 / 136** |
| `npm run builder:db:verify:phase3` (regression) | **117 / 117** |
| `npm run test:builder-portal` | **325 / 325** (44 new) |
| `npm run test:e2e:builder-portal` (real Chromium) | **27 / 27** (9 new) |
| `npm run typecheck:builder-edge` (Deno, 13 functions) | clean |
| `npx tsc --noEmit -p tsconfig.app.json` | clean |
| `npm run security:builder-portal` | passed (13 functions, 22 browser sources) |
| `npm run builder:types:check` | up to date (23 table blocks) |
| `npm run build` | succeeded |
| `npm run audit:style` | **zero new violations** (counts identical with the branch stashed) |
| `npm run test:solicitor-portal` | **116 / 117** — the same pre-existing failure measured before this branch existed |

## 6. Defects found by verification

Each of these was found by running the code, not by reading it.

1. **Access role `manager` does not exist.** The verification fixture used it;
   project access roles are `responsible | team_member | supervisor | read_only`.
2. **A fresh row's `row_version` is 1**, so a stale-write test using `1` as the
   "stale" value succeeded. Changed to a value that cannot be current.
3. **A single `SELECT` sees one snapshot.** Asserting a transition and reading
   the resulting status in one statement read the pre-transition value. Split
   into two statements.
4. **The `success` field was missing from two client response types**
   (`builderCompleteOnboarding`, `builderSelectOrganisation`), which the
   application-wide type check surfaced. The runtime was already correct; the
   type parameters were incomplete. Corrected in place.
5. **A computed table name defeats the generated Supabase types.** Listing
   stages, buildings or lots through one `supabase.from(table)` call produced
   `TS2590: union type too complex`. Written out per table in both functions.

## 7. A note on the base branch

The instruction was to branch from `main`. `main` is at `5a75c29`, which contains
Phase 2 but **not** Phase 3 — the Projects module is still an open draft PR
(#1752). Branching from `main` as literally instructed would have discarded the
entire Projects module, and the Inventory module is built directly on top of it:
`builder_resolve_unit_permission` calls `builder_resolve_project_permission`, and
every inventory table is a child of `builder_projects`.

This branch is therefore based on the Phase 3 head. If Phase 3 is merged first,
this branch rebases cleanly onto `main`; if the intent was for Phase 3 to be
abandoned, this branch would need rebuilding and that should be said explicitly.

## 8. What is not built

The following remain outstanding from the "complete portal" scope. None of them
is started, and none is stubbed — there are no placeholder tables, routes or
functions for them, and their navigation items remain visibly disabled.

- Transactions, pipeline, transaction-case relationships
- Construction cases, stages, milestones, progress updates, photographs
- Variations, progress claims, inspections, defects, practical completion,
  handover, warranty
- Documents, conversations and messages, tasks, notifications
- Dashboard summaries beyond the current counts, activity history,
  organisation settings, user settings

Nothing was deployed. No migration was applied to production, no Edge Function
was deployed, no production data was modified, and no rollout row was created —
the security check asserts the last of these.
