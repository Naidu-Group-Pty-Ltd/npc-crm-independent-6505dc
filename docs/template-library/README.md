# Template Library — Integration Plan

Planning documentation for introducing a premium Template Library alongside the
existing Reporting Engine Builder. **This phase adds no user-facing behaviour.**

| Document | Covers |
| --- | --- |
| [`01-current-state.md`](./01-current-state.md) | Current-state assessment, dependency map, identified risks |
| [`02-architecture.md`](./02-architecture.md) | Recommended architecture, user journey, data model, governance |
| [`03-roadmap.md`](./03-roadmap.md) | Staged PR roadmap, testing strategy, rollback, file lists |
| [`04-implementation.md`](./04-implementation.md) | **What was built**, the tenancy judgement, verification, open items |
| [`05-deployment.md`](./05-deployment.md) | **Runbook** — migrations, function deploy, smoke test, adding templates |
| [`../architecture/adr/017-template-library-separation.md`](../architecture/adr/017-template-library-separation.md) | The one decision everything else follows from |

---

## 1. Executive summary

The platform already has a mature reporting engine: a 3,342-line visual editor,
86 builder components, a 1,003-line Zod template schema, an HTML → WeasyPrint
render pipeline, SQL-side template resolution, version snapshots, branching,
approvals and an audit log. The Template Library does not need to rebuild any of
that. It needs to become a **catalogue that feeds it**.

The core recommendation is one sentence:

> Store library templates in their own table, and let "Use template" write an
> ordinary `report_templates` row through the write path the Builder already
> uses.

That gives a clean separation — master templates are catalogue data, working
copies are Builder data — without changing a single line of the Builder.

### Why not put library templates in `report_templates` with an `is_library` flag

This was the first option assessed, and it is the one that looks cheapest. It is
rejected for two concrete, verifiable reasons:

1. **It would immediately change the existing Builder tab.** `useReportTemplates()`
   (`src/hooks/useReportTemplates.ts:91`) lists `report_templates` with **no
   filter**. Thirty to forty library rows would appear as thirty to forty new
   cards in the Builder grid the moment they were seeded. That is a direct
   violation of the non-negotiable requirement, and it is not a styling problem
   that can be patched — the list has no concept of exclusion to extend.

2. **It puts catalogue data inside the production resolver's search space.**
   `resolve_report_template()` (migration `20260611120000`) selects
   `FROM report_templates WHERE report_type = $1 AND is_active = true`. Every
   library row would be one mis-set `is_active` away from silently becoming the
   template used for a live customer report. The blast radius of that mistake is
   every PDF the platform generates for that report type.

A separate table has neither property. The full options analysis, including the
two rejected alternatives and their trade-offs, is in
[`02-architecture.md §1`](./02-architecture.md#1-where-the-library-lives).

### Status

The planning phase (PR 1) and the implementation phases (roadmap PR 2–5) are
both delivered, **with forty templates seeded** — at least two in every category
a filter chip offers — so the library is usable on the day it is switched on. It is live behind a kill-switch flag that defaults ON.
See [`04-implementation.md`](./04-implementation.md) for what shipped, the two
real defects the render tests caught, and how it was verified.

The existing Reporting Engine Builder is unchanged. The only edit to an existing
component is 20 additive lines in `src/pages/Templates.tsx` that mount a ninth
tab; the Builder tab's markup and logic are untouched.

---

## 2. Confirmation: the existing Builder is unchanged

Verified by `git diff origin/main --stat`. This branch modifies **no** file under:

- `src/pages/Templates.tsx` — the Template Management page and all eight tabs
- `src/pages/admin/TemplateBuilder.tsx`, `src/pages/admin/TemplateBuilderEdit.tsx`
- `src/components/templateBuilder/**` (86 files)
- `src/components/templates/**`
- `src/lib/reportTemplate/**` (schema, renderers, resolver, adapters, exporters)
- `src/hooks/useReportTemplates.ts`
- `src/App.tsx` — routes and navigation
- `supabase/functions/**` — including `manage-templates` and `render-template-pdf`
- `supabase/migrations/**` — no migration is added

The Formats, Builder, Cover Page, PDF, Q&A, Cash Flow, Branding and Settings
tabs, the `Open in Builder` action, template creation, deletion, versioning,
approval, branching, report generation and PDF rendering are all byte-identical
to `main`.

---

## 3. Decisions — all resolved

Rationale in [`02-architecture.md §9`](./02-architecture.md#9-open-decisions);
the tenancy judgement is worked through in
[`04-implementation.md §1`](./04-implementation.md#1-the-tenancy-judgement).

| # | Decision | Why it blocks | Recommendation |
| --- | --- | --- | --- |
| **D1** | **There is no organisation or tenant table in this codebase.** `report_templates.agency_id` exists but has no membership relation — migration `20260726143000` states this explicitly. | Determines what "visible and usable by tenant" can mean. | **RESOLVED — deployment-as-tenant.** `whitelabel_settings` is a singleton, so one deployment is one tenant. Every authenticated user with `templates:view` sees the library; working copies are `scope='user'` owned by their creator. `visibility` is shaped to accept `'agency'` later. No tenancy model was invented inside this feature. |
| **D2** | Only the `investment` report-type family has a production adapter (`adapters/index.ts:16` — everything else is `previewOnlyAdapter`), and only five aliases pass `hasProductionReportTemplateAdapter` (`manage-templates/index.ts:301`). | A library of 30–40 templates will be mostly **preview-only**: a suburb or cash-flow template can be copied and edited, but cannot be activated for live report generation today. | Ship the library with an honest per-entry compatibility badge. Do not hide the limitation; do not widen the adapter allow-list as a side effect of this feature. |
| **D3** | Who authors the initial 30–40 templates, and in what format? | Determines whether PR 2 needs a seed pipeline, an import path from the existing Builder, or both. | Author them **in the existing Builder**, then "promote to library" — reuses the editor, the linter and the renderer, and guarantees every entry is valid by construction. |
| **D4** | Should a working copy track updates to its source library template? | Changes whether the copy is a snapshot or a live reference. | **Snapshot.** Notify, never auto-update. Reasoning in [`02-architecture.md §4`](./02-architecture.md#4-what-happens-when-a-master-template-changes). |
| **D5** | Is `templates:edit` sufficient to use the library, or does it need its own module key? | Affects `dashboard_modules` seeding and the permission matrix. | Reuse `templates`. Browsing needs `templates:view`; "Use template" needs `templates:edit` — which is exactly what creating a Builder template already needs. |

---

## 4. Known risks carried into the next phase

Full register with likelihood, impact and mitigation in
[`01-current-state.md §4`](./01-current-state.md#4-identified-risks). The three
that matter most:

- **R1 — Resolver contamination.** Mitigated structurally by the separate table.
- **R2 — Builder list pollution.** Mitigated structurally by the separate table.
- **R6 — Signed-URL rot.** `render-template-pdf` returns 24-hour signed URLs from
  the private `investment-reports` bucket. A thumbnail URL persisted from that
  response **will break the next day**. The preview strategy in
  [`02-architecture.md §5`](./02-architecture.md#5-previews-and-thumbnails)
  avoids storing signed URLs entirely.

---

## 5. Observations found during assessment (not fixed here)

Reported because they are relevant to the design, not because this PR should
change them. None is a regression; all predate this work.

1. `src/pages/Templates.tsx:119` computes `canEditTemplates` and imports
   `useIsMobile`, and **uses neither**. The Builder's "New template" and delete
   controls are therefore not permission-gated in the UI. Enforcement is
   server-side in `manage-templates` (`assertTemplatePermission`), so this is a
   UI polish gap rather than a security hole — a user without `templates:edit`
   sees the buttons and gets a 403. The Template Library should gate its own
   controls in the UI rather than copy this pattern.
2. `useReportTemplateMutations().create` does not set `created_by`,
   `owner_user_id` or `scope`, so every Builder template is created with the
   column default `scope = 'global'`. Combined with `applyReportTemplateReadScope`,
   that means all authenticated users can read all Builder templates.
   `TemplateBranchingDialog.tsx:94` documents why `created_by` is deliberately
   left null: the column is a foreign key to `auth.users`, and this platform's
   custom-auth user ids are not in that table. **Any library instantiation code
   must respect this** — stamping a `custom_users.id` into `created_by` will
   fail the FK.
3. `report_templates.config` is `JSONB NOT NULL` from the original 2025 migration
   and is still required on insert, though the Builder writes `{}`. A seed or
   import path must supply it.
