# Proposed Builder roles and permissions assessment

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`
**Status:** proposed and explicitly not final. Roles are settled in the phase
that implements `builder_user_access`, after the party model in
`05-organisation-and-access-hierarchy.md` is agreed.

## Comparison against the existing portal role architectures

| Portal | Role storage | Role values | Access granularity |
| --- | --- | --- | --- |
| Solicitor | `solicitor_portal_users.portal_role`, a Postgres enum | `principal`, `solicitor`, `conveyancer`, `paralegal`, `assistant` | separate: `solicitor_matter_access.access_role` per matter |
| Finance | `finance_portal_users` + `finance-portal-permissions.ts` | partner-oriented | per client assignment |
| Command Centre | `user_roles` + `user_permissions` + `dashboard_modules` | staff roles | per module, view/edit/delete |

Two structural lessons carry into Builder:

1. **The Solicitor Portal separates the identity role from the access role.**
   `portal_role` describes what the person is; `solicitor_matter_access.access_role`
   describes what they may do on one matter. Builder adopts the same split —
   `builder_portal_users.portal_role` for identity, `builder_user_access.access_role`
   per grant.
2. **A Postgres enum for the role is a liability.** `solicitor_portal_role` is an
   enum, so adding a role is a schema migration and removing one is effectively
   impossible. The Builder role set is larger and less settled. Builder should use
   a `text` column with a `CHECK` constraint, which widens with a cheap
   constraint replacement rather than an enum alter.

## Proposed identity roles (`builder_portal_users.portal_role`)

| Role | Scope of concern | Typical grants |
| --- | --- | --- |
| `org_administrator` | organisation | organisation-level grant; manages users and access within the org |
| `development_manager` | development | development-level grants across projects |
| `project_manager` | project | project-level grant |
| `sales_manager` | sales across projects | project or development grant, sales keys |
| `sales_consultant` | individual sales | unit or transaction grants, sales keys |
| `construction_manager` | build execution across projects | project grant, construction keys |
| `site_supervisor` | one site | stage grant, construction and inspection keys |
| `contract_administrator` | contracts and variations | project grant, contract and variation keys |
| `customer_service_officer` | client-facing coordination | transaction grants, messaging keys |
| `defects_coordinator` | defects and warranty | project grant, defect and warranty keys |
| `read_only` | observation | any scope; clamps edit and delete to false |

`read_only` is a genuine role in the Solicitor implementation
(`access_role === 'read_only'` clamps `edit` and `delete` after resolution) and
behaves the same way here.

### Open questions before these are finalised

1. Should `org_administrator` be a role, or a boolean capability that any role
   can hold? The Solicitor Portal uses `principal` as a role, which prevents a
   practice from having a non-principal administrator.
2. Do `development_manager` and `project_manager` differ in permission keys, or
   only in the scope level of their grant? If only in scope, one role suffices.
3. Does `sales_manager` need cross-consultant visibility of internal sales notes?
   That is Builder-private data and should be an explicit key, not a role
   privilege.
4. Should `party_role` on `builder_project_parties` (developer vs builder) act as
   a second permission dimension that intersects with `access_role`? The
   cross-organisation table in `05-organisation-and-access-hierarchy.md` implies
   yes; that must be settled before roles are written.

## Proposed permission keys

Following `SOLICITOR_PERMISSION_KEYS`, each key resolves at `view` / `edit` /
`delete`:

```text
projects · developments · inventory · pricing · availability ·
reservations · allocations · transactions · contracts · deposits ·
construction · milestones · variations · progress_claims ·
inspections · defects · handover · warranty · selections ·
documents · messages · tasks · settlement_status ·
finance_status · legal_status · audit · org_admin
```

`finance_status` and `legal_status` are **read-only inbound projections**. Their
`edit` and `delete` levels are always false, mirroring how the Solicitor default
matrix denies `edit` on `finance_status` and `audit`.

## Permanently forbidden keys (`BUILDER_FORBIDDEN_KEYS`)

Hard-denied inside the Builder `can()` equivalent, independent of any stored
matrix, and stripped by the admin control plane before persistence:

```text
income · expenses · assets · liabilities · employment ·
borrowing_capacity · serviceability · commissions ·
aml_restricted · smr · mlro · legal_privileged · conflict_checks ·
finance_private · command_private · solicitor_private
```

This reproduces the `SOLICITOR_FORBIDDEN_KEYS` mechanism — a `Set` consulted
first inside `can()` so no stored policy can ever grant these — with the key list
appropriate to the Builder audience.

## Resolution semantics (binding, not proposed)

These are corrections of identified Solicitor defects and are not negotiable:

1. **Deny by default.** An unconfigured key resolves to `{ view: false, edit:
   false, delete: false }`. There is no `DEFAULT_ALLOW_KEYS` equivalent
   (correction of NOCOPY-01).
2. **Tri-state only.** Stored values are `inherit`, `allow` or `deny`. There is
   no boolean matrix and no OR-merge path, so no legacy adapter is ever needed.
3. **Specificity ordering.** More specific scope wins. At equal specificity,
   `deny` wins.
4. **View implies nothing; edit implies view.** Granting `edit` or `delete`
   forces `view` to `allow`; denying `view` forces `edit` and `delete` to `deny`.
   This mirrors `normalizeTriStateMatrix()` in `solicitor-portal-admin`.
5. **`read_only` clamps last**, after resolution, across every key.
6. **Forbidden keys are checked first** and cannot be overridden.

## Command Centre administration permission

The internal administration page uses one internal module key,
`builder_portal_admin`, enforced by `ModuleGuard` in the browser and
`requireModulePermission('builder_portal_admin')` plus `enforceCsrf()` on the
server. It is unrelated to the Builder portal permission keys above, which govern
external builder users only.

The key is **not created in Phase 0**. When created, it must be registered in
`dashboard_modules` in the same migration that first uses it — the gap that
`solicitor_portal_admin` currently has (NOCOPY-03).
