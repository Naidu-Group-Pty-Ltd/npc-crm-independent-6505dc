# Builder / Developer Portal — Inventory mirroring inventory

The Builder **Projects** module (Phase 3) — which itself mirrors the Solicitor
**Matters** module — is the canonical implementation template for the Builder
**Inventory** module. This inventory was produced by reading the complete
Projects implementation before any inventory file was written.

Permitted changes are limited to: project terminology → inventory terminology,
project data → stage/lot/unit data, Builder-domain requirements with no
equivalent one level up, and in-place correction of defects already documented
by this programme.

The Solicitor Portal has **no** inventory equivalent: a legal matter has no
sellable child aggregate. Where there is no Solicitor source, the Builder
Projects module is the source, so the architectural line back to the Solicitor
implementation is preserved rather than broken.

## 1. File-for-file map

### Database

| Projects source | Inventory equivalent | Change |
| --- | --- | --- |
| `builder_projects` | `builder_stages`, `builder_buildings`, `builder_lots`, `builder_units` | Terminology + domain fields. The four tables are children of one project; there is no second access table (§2). |
| `builder_project_status_history` | `builder_unit_status_history`, `builder_reservation_status_history` | Same append-only trigger pattern. Units carry a `status_kind` because availability and release move independently. |
| `builder_project_access` | *(none — deliberately)* | A unit is reached through its parent project's grant. Adding a unit-level grant table would create a second authorization model, which the mirroring rule forbids. |
| `builder_resolve_project_permission()` | `builder_resolve_unit_permission()` | Delegates to the project resolver first and returns false on a project denial. Stage-scoped and unit-scoped overrides may only DENY. |
| `builder_accessible_projects()` | `builder_accessible_units()` | Joins the accessible-projects set, then applies the unit resolver. |
| `builder_is_project_transition_allowed()` | `builder_is_unit_availability_transition_allowed()`, `builder_is_reservation_transition_allowed()` | Same shape, sales and reservation lifecycles. |
| `builder_transition_project()` | `builder_transition_unit_availability()`, `builder_transition_unit_release()`, `builder_transition_reservation()` | Same shape: reason required, `FOR UPDATE`, `row_version`, status check, history row, audit `PERFORM`ed in the same transaction. |
| `builder_upsert_project()` | `builder_upsert_stage/building/lot/unit()` | Same shape: `FOR UPDATE`, `_expected_version` mandatory on update, jsonb payload with `?`-guarded partial update, audit in the same transaction. |
| `builder_upsert_project_party()` | `builder_set_unit_price()`, `builder_create_unit_hold()`, `builder_create_reservation()`, `builder_create_allocation()` | Same shape for the child aggregates. |
| `builder_admin_revoke_project_access()` | `builder_release_unit_hold()`, `builder_release_allocation()` | Same shape: `_expected_version` mandatory, audit in the same transaction. |
| `builder_guard_permission_scope()` | *(widened in place)* | The guard now accepts `stage` and `unit` scopes and checks the scope id names an existing row. Widened additively, exactly as Phase 3 widened it for `project`. |

### Edge Functions

| Projects source | Inventory equivalent | Change |
| --- | --- | --- |
| `builder-portal-projects` | `builder-portal-inventory` | Terminology. Same shape: `enforceCsrf` → `resolveBuilderSession` → `builderGovernanceError` → server-held active organisation → parent-first loader → tri-state matrix → guarded command. |
| `builder-projects-admin` | `builder-inventory-admin` | Terminology. Same shape: `enforceCsrf` → `verifyAuth` → `requireModulePermission('builder_portal_admin')` → re-read parent → guarded command. |
| `_shared/builderProjects.ts` | `_shared/builderInventory.ts` | Terminology, same exports: enums, allow-listed select lists, `clean*` helpers, `build*Payload`. **Added**: `inventoryCommandFailure()`, one table mapping every raised database error code to an HTTP status, so the portal and admin error contracts cannot drift (§3). |
| `resolveBuilderProjectAccess()` | `loadUnit()` (in-function) | A unit has no grant of its own, so the loader resolves the parent project's grant and then calls `builder_resolve_unit_permission`. |
| `listAccessibleBuilderProjectIds()` | `listAccessibleBuilderUnitIds()` | Terminology; backed by `builder_accessible_units()`. |
| `logBuilderProjectActivity()` | *(reused)* | Its `entityType` union was widened to the entity types the migration's CHECK constraint now accepts. |

### Frontend

| Projects source | Inventory equivalent | Change |
| --- | --- | --- |
| `src/pages/builder/BuilderProjects.tsx` | `src/pages/builder/BuilderInventory.tsx` | Terminology. Same summary cards, debounced server-side search, filters, table, pagination nav. **Added**: a project filter, kept in the URL so a filtered view is linkable. |
| `src/pages/builder/BuilderProjectDetail.tsx` | `src/pages/builder/BuilderUnitDetail.tsx` | Terminology. Same tabbed detail, `expected_version` on every write, reason-required status change. |
| `src/lib/builderProjects.ts` | `src/lib/builderInventory.ts` | Terminology, same exports: types, status order/labels/classes, transition allow-lists, formatters. |
| `src/lib/builderQueries.ts` | *(extended in place)* | Same query-key structure, same `invoke` wrapper, same `retryBuilderQuery` policy. Hooks added, nothing changed. |
| `AdminBuilderProjectsPanel` | `AdminBuilderInventoryPanel` | Terminology. Same `invokeSecureFunction` call shape, same dialog structure, same `canEdit` gating. |
| `tests/builder-portal/phase3-projects.test.mjs` | `tests/builder-portal/inventory.test.mjs` | Same structure: migration, boundaries, access control, mutations, function contracts, frontend wiring. |
| `scripts/builder-portal/local-db/verify-phase-3.mjs` | `scripts/builder-portal/local-db/verify-inventory.mjs` | Same harness, same fixture shape. |
| `tests-e2e/builder-portal/phase3-projects.e2e.ts` | `tests-e2e/builder-portal/inventory.e2e.ts` | Same structure, same stubbing approach. |

## 2. Why there is no unit access table

The Projects module resolves access from `builder_project_access`. Giving units
their own grant table would mean two grant tables, two revocation paths and two
places a stale grant could survive — a second authorization model, which the
mirroring rule forbids.

Instead the unit resolver **delegates**:

1. `builder_resolve_project_permission(user, unit.project_id, key, level)`.
   If the project denies, the unit denies. Full stop.
2. The active membership of the granting organisation is re-read and must exist.
3. A stage-scoped override may DENY. It may not allow.
4. A unit-scoped override may DENY. It may not allow.

A narrower scope can only ever subtract. This is the same direction of travel as
Phase 3's grant-level override, which also cannot lift a forbidden key or the
`read_only` clamp.

## 3. Defects corrected in place

| Defect | Where it was found | Correction |
| --- | --- | --- |
| A permission key catalogued with no seeded role baseline resolves false for every valid grant, making the module unusable. | Phase 3 hit this with the `projects` key. | `inventory`, `pricing` and `reservations` are seeded, and a post-migration assertion fails the migration if any permission key lacks a baseline. |
| A table using the shared touch trigger without every column the trigger writes fails on every update. | Phase 3 hit this with `builder_project_parties` and `row_version`. | Every inventory table carries `row_version`, and a post-migration assertion fails the migration if a touch-triggered table lacks it. |
| A new permission scope that the database scope guard rejects can never be stored, so the override the resolver reads is unreachable. | Phase 3 hit this with the `project` scope. | The guard accepts `stage` and `unit`, verifies the scope id names an existing row, and the local verification proves both scopes can be stored **and** resolved. |
| Two functions mapping the same database error code to different HTTP statuses drift apart silently. | Observed while writing the second function. | One `inventoryCommandFailure()` table in the shared module, and a contract test asserting every `MESSAGE=` the migration raises is mapped. |

## 4. What was deliberately not carried across

- **No cost, margin, supplier price or contractor price column.** The migration
  asserts at apply time that no inventory column matches `%cost%`, `%margin%`,
  `%supplier%` or `%contractor_price%`. The customer-facing list price is the
  only commercial figure in the module.
- **No Finance-owned payment data.** `builder_invoices` and
  `build_progress_payments` are not referenced by either function. A reservation
  fee records what was agreed, not what was received; receipt and reconciliation
  stay with Finance.
- **No client aggregate.** A reservation records a purchaser by name and
  contact. A Client record is linked at transaction level, not here, so the
  inventory module never reaches into client income, expenses, assets,
  liabilities, employment, borrowing capacity or serviceability.
- **No transaction-case link.** `transaction_case_links` is untouched.
