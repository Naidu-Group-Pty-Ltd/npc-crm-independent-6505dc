# Template Library — Implementation Roadmap

Six pull requests. Each is independently revertable, and each leaves the existing
Reporting Engine Builder untouched.

> **Status.** PR 1 is merged-ready as the foundation branch. **PR 2–5 are
> delivered together** on `feature/template-library-implementation`, because the
> instruction was to make the functionality visible and usable rather than to
> land it dark — a data foundation with no UI is not usable, and a UI with no
> "Use template" is not functionality. The three review passes described in
> PR 2, PR 3 and PR 4 below still apply and are the recommended way to read the
> diff. What actually shipped is recorded in
> [`04-implementation.md`](./04-implementation.md).
>
> The `templateLibrary` flag now defaults **ON** and remains as a one-flip
> kill-switch. PR 6 (release hardening) is outstanding.

---

## PR 1 — Architecture, documentation and non-invasive foundation

**This PR.**

| | |
| --- | --- |
| **Objective** | Assess the codebase, document the architecture, and land only inert scaffolding. |
| **Components affected** | None. |
| **Files created** | `docs/template-library/README.md`, `01-current-state.md`, `02-architecture.md`, `03-roadmap.md`; `docs/architecture/adr/017-template-library-separation.md`; `src/lib/templateLibrary/types.ts`; `src/lib/templateLibrary/featureFlag.ts`; `src/lib/templateLibrary/__tests__/featureFlag.spec.ts` |
| **Files modified** | None. |
| **Database impact** | None. No migration. |
| **API impact** | None. |
| **Risk** | **None.** Nothing imports the new modules; the flag defaults off; no existing file changes. |
| **Testing** | `featureFlag.spec.ts`; `tsc --noEmit`; `npm run audit:style` must not regress. |
| **Rollback** | `git revert`. Deleting the two new source files has no effect on any running code. |
| **Acceptance** | Decisions D1–D5 answered; `git diff origin/main --name-only` touches nothing under the protected paths listed in [`README §2`](./README.md#2-confirmation-the-existing-builder-is-unchanged). |

---

## PR 2 — Template Library data foundation

| | |
| --- | --- |
| **Objective** | Additive tables, RLS, the write broker, and validation. No UI. |
| **Components affected** | None existing. |
| **Files created** | `supabase/migrations/<ts>_create_template_library.sql`; `supabase/functions/manage-template-library/index.ts`; `src/hooks/useTemplateLibrary.ts`; `src/lib/templateLibrary/validation.ts`; `src/lib/templateLibrary/taxonomy.ts`; specs for validation and taxonomy |
| **Files modified** | `src/integrations/supabase/types.ts` (regenerated — additive only); `supabase/functions-registry` if new functions are registered there |
| **Database impact** | `CREATE TABLE template_library_entries`, `CREATE TABLE template_library_instantiations`, indexes, RLS policies, grants. **No `ALTER TABLE` on any existing table. No data migration. No destructive change.** |
| **API impact** | One new edge function. `manage-templates` is **not** modified — the library deliberately does not join its table allow-list, so a library bug cannot reach the Builder's broker. |
| **Risk** | **Low.** New tables are unreferenced by existing code. The one shared artefact is the regenerated `types.ts`, which is additive; verify the diff adds only the two new tables. |
| **Testing** | Migration applies cleanly and is idempotent (`IF NOT EXISTS`); RLS denies anonymous select, denies authenticated select of non-published rows, denies authenticated write; edge function returns 403 for non-superadmin mutations; publish validation rejects unsupported block types, future schema versions and lint errors; **regression suite (below) run in full to prove nothing moved.** |
| **Rollback** | `DROP TABLE` both tables (nothing references them) and delete the function. Reverting the commit is sufficient; no data restoration is involved because no existing data is touched. |
| **Acceptance** | Existing template counts and behaviour identical before and after the migration; the Builder tab renders the same rows; `resolve_report_template` returns the same winner for a fixed input set. |

---

## PR 3 — Template Library browsing interface

| | |
| --- | --- |
| **Objective** | The tab, the grid, search, filters and preview — behind the flag. |
| **Components affected** | `Templates.tsx` — **additive only**: one import, one `TabsTrigger`, one `TabsContent`, and `md:grid-cols-8` → `md:grid-cols-9`. The Builder tab's JSX is not touched. |
| **Files created** | `src/components/templateLibrary/TemplateLibraryTab.tsx`, `TemplateLibraryGrid.tsx`, `TemplateLibraryCard.tsx`, `TemplateLibraryFilters.tsx`, `TemplateLibraryEmptyState.tsx`, `TemplatePreviewDialog.tsx`, `TemplatePreviewSvg.tsx`; `src/pages/admin/TemplateLibraryPreview.tsx`; component specs |
| **Files modified** | `src/pages/Templates.tsx` (≈6 lines), `src/App.tsx` (one route) |
| **Database impact** | None. |
| **API impact** | Read-only calls to the PR 2 function. |
| **Risk** | **Low-medium** — the first PR to touch a protected file. Mitigated by the flag (with it off, the tab does not render and `Templates.tsx` behaves exactly as today) and by a snapshot test asserting the eight existing tab values and order are unchanged. |
| **Testing** | Tab list renders 8 triggers flag-off and 9 flag-on, in the documented order; grid filters and search; empty, loading and error states; keyboard navigation and focus restoration; mobile tab overflow scroll; `npm run audit:style` no new violations; full regression suite. |
| **Rollback** | Flip the flag off — no deploy needed. Full revert if required. |
| **Acceptance** | With the flag off, `Templates.tsx` renders identically to `main` (verified by test); with it on, the library grid works and the Builder tab is unchanged. |

---

## PR 4 — Selection and duplication workflow

| | |
| --- | --- |
| **Objective** | "Use template" creates an independent working copy and opens it in the existing Builder. |
| **Components affected** | None existing. The Builder receives an ordinary template id on an existing route. |
| **Files created** | `src/components/templateLibrary/UseTemplateDialog.tsx`; `src/lib/templateLibrary/instantiate.ts`; `src/lib/templateLibrary/__tests__/instantiate.spec.ts` |
| **Files modified** | `src/components/templateLibrary/*` from PR 3 (wiring the button) |
| **Database impact** | Inserts into `report_templates` (existing shape, existing broker) and `template_library_instantiations`. No schema change. |
| **API impact** | Uses `manage-templates` `insert` **exactly as the Builder's "New template" already does**. No contract change. |
| **Risk** | **Medium** — the only PR that writes to `report_templates`. Mitigated by reusing the field-reset recipe already proven in `TemplateBranchingDialog.tsx:77-98`, by going through the existing permission-checked broker rather than a direct insert, and by an assertion test that a copy is created with `is_active=false`, `is_default=false`, `approval_status='draft'`, `created_by=null`. |
| **Testing** | Copy is independent — editing it leaves the entry's `schema` byte-identical; copy is never active or default; `created_by` is null (FK constraint); `config` is non-null; lineage row written; audit row written; `templates:edit` required; copy of an unsupported-block template still copies but cannot be activated (422 from the existing gate); **`resolve_report_template` returns the same winner before and after a copy is created** — the direct test for R1. |
| **Rollback** | Flag off. Copies already created are ordinary Builder templates and keep working; lineage rows become orphan metadata, harmless. |
| **Acceptance** | A user with `templates:edit` can go library → copy → Builder → edit → save → version → approve using only existing Builder functionality, and the source entry is unchanged. |

---

## PR 5 — Administration and publishing controls

| | |
| --- | --- |
| **Objective** | Superadmin management: promote, version, publish, deprecate, archive, audit. |
| **Components affected** | None existing. |
| **Files created** | `src/pages/admin/TemplateLibraryAdmin.tsx`; `src/components/templateLibrary/admin/*` (PublishDialog, EntryEditor, VersionList, EventLog); `supabase/migrations/<ts>_create_template_library_events.sql` |
| **Files modified** | `src/App.tsx` (one admin route), PR 2's edge function (new operations) |
| **Database impact** | `CREATE TABLE template_library_events`. Additive. |
| **API impact** | New operations on the library function only. |
| **Risk** | **Low-medium.** Superadmin-only surface; publish is gated by the validation suite. |
| **Testing** | Non-superadmin gets 403 on every mutation and cannot see the route; publish rejects invalid schemas; publishing a new version deprecates the previous one; archive is soft and reversible; no hard-delete path exists; every state change writes an event. |
| **Rollback** | Revert; `DROP TABLE template_library_events`. Published entries are unaffected. |
| **Acceptance** | A superadmin can take a Builder template to a published library entry and back to archived, with every transition audited, without touching `report_templates`. |

---

## PR 6 — Testing, performance and release hardening

| | |
| --- | --- |
| **Objective** | Prove no impact on the existing engine, then enable the flag. |
| **Components affected** | None. |
| **Files created** | `tests-e2e/templateLibrary.e2e.ts`; `src/lib/templateLibrary/__tests__/performance.spec.ts` |
| **Files modified** | `src/lib/templateLibrary/featureFlag.ts` (default OFF → ON), documentation |
| **Database impact** | None. |
| **API impact** | None. |
| **Risk** | **Medium** — this is the PR that makes the feature visible. Mitigated by the kill-switch staying in place afterwards. |
| **Testing** | Full regression matrix below, plus PDF output comparison and 40-entry performance runs. |
| **Rollback** | `VITE_TEMPLATE_LIBRARY=0` at build, `?templateLibrary=0` per visit, or `localStorage` per browser — the same three-level kill-switch as `editorV2Flag`. |
| **Acceptance** | Every regression test green; a byte-identical PDF for a fixed template before and after; library grid interactive in under one second with 40 entries. |

---

## Regression matrix

Run in full on PR 2, 3, 4 and 6. **A failure here stops the PR.**

| # | Area | Test | Expected |
| --- | --- | --- | --- |
| R1 | Template listing | Builder tab card count and order | Identical to `main` |
| R2 | Template creation | "New template" → Builder | Creates and navigates as today |
| R3 | Template editing | Open, edit a block, save | Persists; version guard behaves |
| R4 | Template deletion | Delete an inactive template | Succeeds; active → 409; locked → 423 |
| R5 | Versioning | Save with snapshot | New `report_template_versions` row; version increments |
| R6 | Open in Builder | Card → `/admin/template-builder/:id` | Loads the correct template |
| R7 | Data binding | Render with sample data | Same resolved output |
| R8 | PDF rendering | WeasyPrint render of a fixed template | **Byte-identical PDF** |
| R9 | Cover page | Cover Page tab CRUD | Unchanged |
| R10 | Branding | Branding tab, brand kit application | Unchanged |
| R11 | Q&A | Q&A tab upload/list | Unchanged |
| R12 | Cash flow | Cash Flow tab upload/list | Unchanged |
| R13 | Formats | Format group selection and counts | Unchanged |
| R14 | Settings | Global report settings save | Unchanged |
| R15 | Permissions | View / edit / delete on `templates` | Same allow and deny outcomes |
| R16 | Read scoping | Non-superadmin list | Same rows as `main` |
| R17 | Navigation | All template routes and guards | Unchanged |
| R18 | **Resolver** | `resolve_report_template` over a fixed corpus | **Same winner and same source label** |
| R19 | Report generation | `routeReportThroughTemplate` end to end | Same template id, same file |
| R20 | Activation gate | Activate without approval / adapter / superadmin | Same 422 / 403 |
| R21 | Existing suites | `src/lib/reportTemplate/__tests__` (217 specs) incl. `goldenRender.spec.ts`, `resolveTemplateParity.spec.ts` | All green |

### New-feature tests

| Area | Coverage |
| --- | --- |
| Browsing | Grid renders published only; drafts invisible to non-superadmins; pagination or virtualisation past 40 |
| Search & filter | Name/description/tag matching; multi-select filters compose as AND across axes and OR within one; URL sync; clear-filters |
| Preview | Modal opens/closes, focus trapped and restored; SVG fallback when hero images are missing; page-count accuracy |
| Duplication | Independence, flag reset, lineage, audit, `created_by=null`, `config` non-null, permission gating |
| Master protection | Entry `schema` unchanged after the copy is edited; no client path can write to the entries table; RLS denies authenticated writes |
| Invalid configuration | Malformed JSON, missing `pages`, unknown block type, `version: 2` → 422 with a clear message; never a client crash |
| Missing bindings | Unresolved `{{path}}` renders empty; `required_bindings` shown in preview |
| Permissions | View-only sees no "Use template"; non-superadmin cannot reach admin routes or mutations |
| Publishing | Validation gate; version increments; previous version deprecated |
| Archiving | Soft, reversible, leaves the grid, keeps lineage |
| Version management | Multiple versions per `family_id`; instantiation records the exact version |
| Rollback | Re-publishing a prior version restores it without data loss |
| Performance | 40 entries: initial paint, filter latency, memory; list query returns no heavy `schema` (guards R7) |

---

## Rollback strategy

Four independent levels, fastest first:

1. **Kill-switch (seconds, no deploy).** `?templateLibrary=0`, localStorage, or
   `VITE_TEMPLATE_LIBRARY=0`. The tab and routes disappear; `Templates.tsx` is
   back to eight tabs.
2. **Revert the UI PRs (one deploy).** PR 3–5 revert cleanly; the tables remain
   and are simply unread.
3. **Drop the tables (one migration).** `template_library_entries`,
   `template_library_instantiations`, `template_library_events`. Nothing in
   `report_templates` references them, so the drop is safe in either order once
   the RESTRICT FK between the library tables is handled. Working copies already
   created keep working — they are ordinary Builder templates.
4. **Full revert.** Because no existing table, policy, function or component is
   modified, `git revert` of all six PRs plus the drop migration returns the
   system to its exact current state. **There is nothing to restore, because
   nothing was replaced.**

---

## Files that may need to be created

```
docs/template-library/{README,01-current-state,02-architecture,03-roadmap}.md   PR1 ✓
docs/architecture/adr/017-template-library-separation.md                        PR1 ✓
src/lib/templateLibrary/types.ts                                                PR1 ✓
src/lib/templateLibrary/featureFlag.ts                                          PR1 ✓
src/lib/templateLibrary/__tests__/featureFlag.spec.ts                           PR1 ✓
src/lib/templateLibrary/{taxonomy,validation,instantiate}.ts                    PR2/4
src/hooks/useTemplateLibrary.ts                                                 PR2
supabase/migrations/<ts>_create_template_library.sql                            PR2
supabase/migrations/<ts>_create_template_library_events.sql                     PR5
supabase/functions/manage-template-library/index.ts                             PR2
src/components/templateLibrary/TemplateLibraryTab.tsx                           PR3
src/components/templateLibrary/TemplateLibraryGrid.tsx                          PR3
src/components/templateLibrary/TemplateLibraryCard.tsx                          PR3
src/components/templateLibrary/TemplateLibraryFilters.tsx                       PR3
src/components/templateLibrary/TemplateLibraryEmptyState.tsx                    PR3
src/components/templateLibrary/TemplatePreviewDialog.tsx                        PR3
src/components/templateLibrary/TemplatePreviewSvg.tsx                           PR3
src/components/templateLibrary/UseTemplateDialog.tsx                            PR4
src/components/templateLibrary/admin/*.tsx                                      PR5
src/pages/admin/TemplateLibraryPreview.tsx                                      PR3
src/pages/admin/TemplateLibraryAdmin.tsx                                        PR5
tests-e2e/templateLibrary.e2e.ts                                                PR6
```

## Existing files that may eventually need modification

Exhaustive. Nothing outside this list should change, and nothing on it changes in
PR 1.

| File | Change | PR | Nature |
| --- | --- | --- | --- |
| `src/pages/Templates.tsx` | +1 import, +1 `TabsTrigger`, +1 `TabsContent`, `md:grid-cols-8` → `-9` | 3 | Additive; Builder tab JSX untouched |
| `src/App.tsx` | +2 lazy imports, +2 routes | 3, 5 | Additive |
| `src/integrations/supabase/types.ts` | Regenerated | 2, 5 | Additive (generated) |
| `supabase/functions-registry` | Register the new function | 2 | Additive |
| `src/lib/templateLibrary/featureFlag.ts` | Default OFF → ON | 6 | One line |
| `docs/PDF_TEMPLATE_BUILDER.md` | Cross-reference the library | 6 | Documentation |

**Explicitly not on the list, at any stage:** `useReportTemplates.ts`,
`templateSchema.ts`, `resolveTemplate.ts`, `routeReportThroughTemplate.ts`,
`htmlRenderer.ts`, `pdfRenderer.ts`, `adapters/*`, `manage-templates/index.ts`,
`render-template-pdf/index.ts`, `TemplateBuilderEdit.tsx`, `TemplateBuilder.tsx`,
anything under `src/components/templateBuilder/`, anything under
`src/components/templates/`, and every existing migration.
