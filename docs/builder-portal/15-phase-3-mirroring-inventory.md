# Builder / Developer Portal — Phase 3 mirroring inventory

The Solicitor Portal **Matters** module is the canonical implementation template
for the Builder **Projects** module. This inventory was produced by reading the
complete Solicitor implementation before any Builder file was written.

Permitted changes are limited to: Solicitor terminology → Builder terminology,
legal-matter data → project data, Builder-domain requirements with no Solicitor
equivalent, and in-place correction of Solicitor defects already documented by
this programme.

## 1. File-for-file map

### Database

| Solicitor source | Builder equivalent | Change |
| --- | --- | --- |
| `legal_matters` | `builder_projects` | Terminology + domain fields. **One structural change**: two organisations instead of one `firm_id` (§3). |
| `legal_matter_parties` | `builder_project_parties` | Terminology; party roles swapped to construction roles. |
| `legal_matter_status_history` | `builder_project_status_history` | Terminology. **Corrected**: made append-only by trigger. |
| `solicitor_matter_access` | `builder_project_access` | Terminology + `organisation_side`. |
| `enforce_solicitor_matter_access_firm()` | `builder_enforce_project_access_org()` | Same exact-non-null rule, applied to the named side. **Corrected**: also requires the grantee to hold an active membership of the granting organisation. |
| `prevent_solicitor_matter_access_firm_drift()` | `builder_prevent_project_access_org_drift()` | Same rule, both organisation columns. |
| `is_legal_matter_transition_allowed()` | `builder_is_project_transition_allowed()` | Construction lifecycle in place of the conveyancing lifecycle. |
| `transition_legal_matter()` | `builder_transition_project()` | Same shape: reason required, `FOR UPDATE`, `row_version`, status check, history row. **Corrected**: audit is `PERFORM`ed in the same transaction, so a failed audit rolls the transition back. |
| `solicitor_tri_state_permissions_valid()` | `builder_tri_state_permissions_valid()` | Identical validator. Phase 1 stored decisions in typed columns and never needed one. |
| *(none — in the Edge Function)* | `builder_admin_upsert_project_access()` / `builder_admin_revoke_project_access()` | The Solicitor writes `solicitor_matter_access` directly from the function and logs afterwards. Moved into guarded commands so the audit shares the transaction (Phase 0 NOCOPY-04). |

### Edge Functions

| Solicitor source | Builder equivalent | Change |
| --- | --- | --- |
| `solicitor-portal-matters` | `builder-portal-projects` | Terminology. Operations mirrored 1:1 for the Phase 3 scope: `list_projects`, `get_project`, `update_project`, `set_status`, `list_parties`, `upsert_party`, `delete_party`, `status_history`, `project_stats`. Later-phase operations (dates, runway, finance coordination) are **not** carried across. |
| `legal-matters-admin` + the matter-access operations of `solicitor-portal-admin` | `builder-projects-admin` | Terminology. Creation, editing, status and access administration in one internal function, matching how the Solicitor splits internal from portal. |
| `_shared/legalMatters.ts` | `_shared/builderProjects.ts` | Terminology, same exports: enums, select lists, `clean*` helpers, `build*Payload`, `TERMINAL_STATUSES`. |
| `resolveSolicitorMatterAccess()` | `resolveBuilderProjectAccess()` | Terminology. **Corrected**: no legacy client-assignment fallback and no dual-read shadow path — Builder has one authorization model. |
| `resolveMatterPermissions()` | `resolveBuilderProjectPermissions()` | Resolution delegated to the database, as Phase 1 already does for organisation permissions. |
| `listAccessibleMatterIds()` | `listAccessibleBuilderProjectIds()` | Terminology; backed by `builder_accessible_projects()`. |
| `logSolicitorActivity()` | `logBuilderProjectActivity()` | **Corrected**: returns whether the write succeeded instead of swallowing the failure. |
| `can(matrix, key, level)` | `builderMatrixCan(matrix, key, level)` | Renamed because `builderCan` was already taken by Phase 1's async organisation resolver; two same-named functions of different arity is an easy call-site mistake. |

### Frontend

| Solicitor source | Builder equivalent | Change |
| --- | --- | --- |
| `src/pages/solicitor/SolicitorMatters.tsx` | `src/pages/builder/BuilderProjects.tsx` | Terminology. Same summary cards, debounced server-side search, status filter, table, pagination nav. |
| `src/pages/solicitor/SolicitorMatterDetail.tsx` | `src/pages/builder/BuilderProjectDetail.tsx` | Terminology. Same tabbed detail, `expected_version` on every write, reason-required status change. |
| `src/lib/legalMatters.ts` | `src/lib/builderProjects.ts` | Terminology, same exports: types, status order/labels/classes, formatters, countdown. |
| `src/lib/solicitorQueries.ts` | `src/lib/builderQueries.ts` | Terminology, same query-key structure, typed error and `invoke` wrapper. **Corrected**: a 4xx is not retried (see §4). |
| `SolicitorPortalShell` | `BuilderPortalShell` | Identical. |
| `AdminLegalMattersPanel` + `SolicitorPortalAdmin` access dialogs | `AdminBuilderProjectsPanel` | Terminology; mounted as a tab on the existing `BuilderPortalAdmin` page. |
| `/solicitor/matters`, `/solicitor/matters/:matterId` | `/builder/projects`, `/builder/projects/:projectId` | Same placement: inside the protected tree, inside the portal layout. |

## 2. Solicitor defects deliberately not copied

| ID | Solicitor behaviour | Builder behaviour |
| --- | --- | --- |
| NOCOPY-02 | Session token accepted from a header or body | `resolveBuilderSession(supabase, req)` — cookie only |
| NOCOPY-03 | `mergePermissions` OR-merges and defaults unknown keys to allow | `builder_resolve_project_permission` denies by default; an unknown key is denied |
| NOCOPY-04 | `logSolicitorActivity` logs the failure and continues | Access changes and transitions audit inside the transaction; a failed audit rolls the change back |
| NOCOPY-06 | Mutating portal endpoints without CSRF | `enforceCsrf` on both new functions |
| — | Matter status history is writable | Project status history is append-only by trigger |
| — | A grant can name a firm the user does not belong to (the firm trigger checks the user's `firm_id` column, not a live membership) | The access trigger requires an active membership via `builder_active_membership` |

## 3. The one structural difference: two organisations

A legal matter has exactly one `firm_id`. A Builder project is delivered by a
**builder** on behalf of a **developer**, and a portal user may belong to either
side. The brief requires this explicitly.

Everywhere the Solicitor rule says *"the matter's exact non-null firm"*, the
Builder rule says *"one of the project's two exact non-null organisations, on the
side the grant names"*:

- `builder_project_access.organisation_side` is `'developer'` or `'builder'`.
- The trigger resolves the project's organisation for that side and requires an
  exact, non-null match — the same test the Solicitor trigger applies to `firm_id`.
- `builder_projects_organisations_distinct` stops one organisation being both
  sides, which would silently collapse the two access paths into one.
- `builder_projects_has_an_organisation` stops a project existing that nobody
  could ever be granted access to.

`builder_developments` likewise has no Solicitor equivalent: a conveyancing file
stands alone, whereas projects group under a development. It is a parent record
only — it grants nothing on its own.

## 4. Deliberate, documented divergences

1. **Status is `text` + CHECK, not a Postgres enum.** Every Builder table created
   in Phases 1 and 2 uses text + CHECK. Introducing an enum here would diverge
   from the Builder schema rather than mirror the Solicitor one, and would break
   the Builder verification harnesses that assume the existing convention.
2. **Project-scope overrides reuse the Phase 1 seam.** Phase 1 created
   `builder_membership_permissions.scope_type IN (…,'project',…)` for exactly
   this purpose. No parallel permissions table was added.
3. **The `projects` permission key needed a role baseline.** Phase 1 catalogued
   the key but seeded no role defaults, so every grant resolved false and the
   module was unusable. The Phase 3 verification caught this; the migration now
   seeds it and asserts it post-migration.
4. **A 4xx is not retried in the browser.** react-query's default retry left a
   withheld project spinning for several seconds before the "not available"
   state rendered. A 4xx is the server's answer, not a transient failure.
5. **No legacy rollback path.** The Solicitor resolver still carries a
   client-assignment fallback and a dual-read shadow mode for its own migration.
   Builder has one authorization model and needs neither.
