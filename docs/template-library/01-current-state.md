# Template Library — Current-State Assessment

Everything below was traced in the codebase at commit `6b5fafc` (origin/main).
File and line references are load-bearing: they are the evidence for the
architecture recommendation in [`02-architecture.md`](./02-architecture.md).

---

## 1. The Template Management page

**File:** `src/pages/Templates.tsx` (583 lines)
**Route:** `/templates` → `App.tsx:429`, wrapped in `<ModuleGuard moduleKey="templates">`

A single component rendering eight tabs through shadcn `Tabs`. Tab state is
**local React state** (`useState('report-formats')`, line 120) — it is not in the
URL and not in a router. There is no `/templates/:tab` route.

| Tab value | Label | Renders | Data source |
| --- | --- | --- | --- |
| `report-formats` | Formats | `ReportFormatGroup` × 6, then `TemplateUploader` + `TemplateList` for the selected format | `report_structure_templates` |
| `builder` | Builder | Inline JSX — search, sort, card grid | `report_templates` via `useReportTemplates()` |
| `cover-editor` | Cover Page | `CoverPageOverlayManager` | `cover_page_overlays` |
| `pdf-layout` | PDF | `TemplateUploader` + `TemplateList` | `report_structure_templates` (`template_type='pdf_layout'`) |
| `qa-export` | Q&A | `QATemplateUploader` + `QATemplateList` | own hooks |
| `cashflow-export` | Cash Flow | `CashFlowTemplateUploader` + `CashFlowTemplateList` | own hooks |
| `branding` | Branding | `BrandingManager` | `client_branding_profiles` |
| `global-settings` | Settings | `GlobalReportSettings` | `global_report_settings` |

**Structural note that shapes the recommendation:** the Builder tab is not a
component. It is roughly 235 lines of inline JSX and an IIFE
(`{(() => { ... })()}`, lines 314–495) inside `Templates.tsx`. There is nothing
to extend and nothing to compose with. A Template Library tab must therefore be
a **new sibling `TabsContent`**, not a modification of the Builder tab — which
is also what the non-negotiable requirement demands.

The `TabsList` is `md:grid-cols-8` (line 186). Adding a ninth tab means changing
that one class. That is the **only** change to this file the whole feature needs,
and it happens in PR 3, not here.

---

## 2. The Visual PDF Template Builder

### Surface area

| Area | Location | Size |
| --- | --- | --- |
| Editor page | `src/pages/admin/TemplateBuilderEdit.tsx` | 3,342 lines |
| Landing page | `src/pages/admin/TemplateBuilder.tsx` | 510 lines |
| Editor components | `src/components/templateBuilder/**` | 86 files |
| Schema + engine | `src/lib/reportTemplate/**` | 60+ modules |
| Tests | `src/lib/reportTemplate/__tests__/**` | 217 spec files |

Routes (`App.tsx:443-444`):

```
admin/template-builder      → <ModuleGuard moduleKey="templates">
admin/template-builder/:id  → <ModuleGuard moduleKey="templates" requireEdit>
```

### The schema

`src/lib/reportTemplate/templateSchema.ts` (1,003 lines) is the single source of
truth. `ReportTemplateSchema` is a Zod object with `version: z.literal(1)`
(line 728). Positional values are **PDF points**; A4 is 595 × 842 pt.

Server-side, `supabase/functions/_shared/templateSchemaVersion.ts` enforces the
version explicitly: missing → treated as v1, equal → accepted, lower → migrated
stepwise via a `MIGRATIONS` map (currently empty), **higher → rejected with 422**.
`SUPPORTED_TEMPLATE_SCHEMA_VERSION = 1`.

This matters for the library: a library entry's stored schema is validated by the
same code path on the way in and on the way out. A library that ships schemas the
deployment does not support will fail closed, loudly — which is the correct
behaviour, but it means **library content is versioned against the deployment**
and needs a `compatibility_version` field.

### Renderers

Two engines, constrained by a CHECK on the column
(`report_templates_engine_check`, migration `20260605202422`):

- `weasyprint` — the production path. HTML from `htmlRenderer.ts` → the
  `render-template-pdf` edge function → WeasyPrint sidecar.
- `jspdf` — legacy/fallback, does not support every block type.

`routeReportThroughTemplate()` (`src/lib/reportTemplate/routeReportThroughTemplate.ts:56`)
**refuses to route anything that is not `weasyprint`** and returns `null` so the
caller falls back to the legacy generator.

---

## 3. Dependency map

### 3.1 What reads `report_templates`

```
                          ┌─────────────────────────────────────┐
                          │        report_templates             │
                          │  (30 columns, ~80 rows in the       │
                          │   screenshot's environment)         │
                          └──────────────┬──────────────────────┘
                                         │
        ┌───────────────┬────────────────┼────────────────┬──────────────────┐
        │               │                │                │                  │
        ▼               ▼                ▼                ▼                  ▼
  useReportTemplates  useReportTemplate  resolve_report_   TemplateBranching  template_*
  (LIST — no filter)  (single, by id)    template()        Dialog             child tables
        │               │                (SQL, SECURITY    (duplicate)        (versions,
        ▼               ▼                 DEFINER)              │              approvals,
  Templates.tsx     TemplateBuilder            │                │              audit_log,
  Builder tab       Edit.tsx                   ▼                ▼              comments,
  card grid                            routeReportThrough  new report_         events,
                                       Template()          templates row       share_links,
                                              │                                render_jobs,
                                              ▼                                imports)
                                       LIVE CUSTOMER PDFs
```

Every one of these paths is a place a badly-scoped Template Library could do
damage. Two of them are the reason for the separate-table recommendation.

### 3.2 The write path

All template writes go through **one** edge function:
`supabase/functions/manage-templates/index.ts` (760 lines). It is a
service-role broker with a fixed table allow-list (29 tables) and a generic
`list | get | insert | update | upsert | delete` operation set.

For `report_templates` and `report_template_versions` it layers on:

| Guard | Location | Behaviour |
| --- | --- | --- |
| Module permission | `assertTemplatePermission` (line 253) | maps `delete`→`can_delete`, `insert/update/upsert`→`can_edit`, else `can_view` on module `templates` |
| Read scoping | `applyReportTemplateReadScope` (line 244) | non-superadmins get `scope='global' OR (scope='user' AND owner_user_id=me)`; agency templates are superadmin-only |
| Schema normalisation | `normaliseTemplateSchema` (line 70) | validates + migrates the version, coerces `tokens`/`slots`/`pages`, sanitises text overlay properties |
| Renderer safety | `validateProductionRendererSchema` (line 203) | rejects any schema containing a block type outside `PRODUCTION_SAFE_BLOCK_TYPES` (a 63-entry allow-list, lines 118–188) — **only when activating or setting default** |
| Activation gate | `validateReportTemplateUpdate` (line 320) | activating or defaulting requires: superadmin **and** `approval_status='approved'` **and** a non-null `report_type` **and** `hasProductionReportTemplateAdapter(report_type)` |
| Lock | `isLockSafeTemplateUpdate` (line 296) | when `locked_for_review`, only `approval_status`, `locked_*`, `is_active`, `is_default` may change → 423 |
| Delete gate | `validateReportTemplateDelete` (line 433) | active → 409; locked → 423 |
| Optimistic concurrency | line 641 | `expectedVersion` becomes `.eq('version', expectedVersion)`; a lost race returns 409 `version_conflict` with the current row |
| CSRF | `enforceCsrf` (line 476) | exact-origin check on cookie-authenticated mutations |

This is a well-defended contract. **The Template Library should use it exactly as
it is** rather than adding a parallel write path — the guards above are what stop
a library-created template from reaching production PDFs by accident.

### 3.3 Report generation

```
routeReportThroughTemplate(reportId, opts)
  └── candidateAdapters(reportType)          adapters/index.ts
        └── adapter.supportsProduction ?     ← only investmentReportAdapter is true
              └── resolveReportTemplate()    resolveTemplate.ts:88
                    └── RPC resolve_report_template(report_type, variant, agency, user)
                          ranked: user > agency > global-variant > global-any
                          then priority DESC, updated_at DESC
                    └── (JS fallback: rankReportTemplates, kept in parity by
                         __tests__/resolveTemplateParity.spec.ts)
              └── engine === 'weasyprint' ?  ← else return null, legacy generator runs
                    └── parseTemplate → preloadImages → renderTemplateToHtml
                          └── invokeSecureFunction('render-template-pdf')
```

**The single most important line in the assessment** is the resolver's WHERE
clause:

```sql
FROM public.report_templates t
WHERE t.report_type = lower(p_report_type)
  AND t.is_active = true
```

Any row in `report_templates` with a matching `report_type` and `is_active=true`
is a candidate for every live report of that type. Library entries must never sit
in that table's rows.

### 3.4 Adapters — the real compatibility ceiling

`src/lib/reportTemplate/adapters/index.ts:16` registers ten adapters. Exactly
**one** (`investmentReportAdapter`) has `supportsProduction: true`. The other
nine are `previewOnlyAdapter(...)` — they resolve no routing context and build no
binding context.

Independently, `manage-templates` gates activation on a five-entry allow-list
(`PRODUCTION_REPORT_TEMPLATE_TYPES`, line 301):
`investment`, `compass`, `investment_compass`, `investment_report`,
`property_investment`.

**Consequence for a 30–40 template library:** entries for suburb, postcode,
statewide, comparison, cash-flow, Q&A, portfolio, borrowing-capacity and Formara
report types can be browsed, previewed, copied and edited, but **cannot be
activated for production report generation** until an adapter exists. This is not
something the Template Library can or should fix. It must be surfaced honestly on
each card. See decision **D2**.

### 3.5 Branding, cover page, cash flow, Q&A, formats

These are **independent subsystems**, not Builder dependencies:

| Subsystem | Table | Coupling to `report_templates` |
| --- | --- | --- |
| Branding profiles | `client_branding_profiles` | none — separate tab, separate manager |
| Brand kits | `brand_kits` | `report_templates.brand_kit_id` (nullable) |
| White-label tokens | `whitelabel_settings` (**singleton**) | via `token:*` resolution at render time |
| Cover page overlays | `cover_page_overlays` | none |
| Q&A / Cash Flow exports | own tables + hooks | none |
| AI structure templates | `report_structure_templates` | soft — the Cascade tab maps structure sections to blocks |

The white-label pipeline is documented in `docs/WHITE_LABEL_TOKEN_CONTRACT.md`:
`whitelabel_settings → BrandProvider → resolveBrandTokens → CSS vars`. Templates
consume brand values as `token:primary`-style references resolved at render time.

**This is a gift for the library.** A library template that uses `token:*`
everywhere and hard-codes no colour is white-label-ready by construction. That
should be a **publish-time validation rule**, not a hope — see
[`02-architecture.md §7`](./02-architecture.md#7-white-labelling-and-branding-compatibility).

### 3.6 Permissions

Two independent questions, both must say yes (`useModulePermissions.ts`):

```
canEdit = isModuleIncluded('templates')            ← usePlanEntitlements (plan slug
          && (isSuperadmin || canEdit('templates'))  from Mission Control)
                                                   ← usePermissions (user_permissions
                                                     joined to dashboard_modules)
```

A superadmin bypasses the **role** check but not the **plan** check. An unknown
plan opens all gates (documented deliberate choice — a slow lookup must not
revoke a paying customer's access).

Server-side, `manage-templates.getModulePermissionContext` recomputes the same
thing from `custom_users.role`, `user_roles` and `user_permissions`. Superadmin is
`user_roles.role='superadmin'` or `custom_users.role IN ('super_admin','superadmin')`.

### 3.7 There is no organisation or tenant model

Searched and confirmed absent: no `organizations`, `organisations`, `tenants` or
`agencies` table exists in `supabase/migrations/`. `whitelabel_settings` is
explicitly a **singleton** ("Create a table for white-label settings (singleton
pattern)", migration `20251224083828`).

`report_templates.agency_id` exists but is an orphan. Migration
`20260726143000_scope_report_template_reads.sql` states the position in the code:

> There is currently no authoritative user-to-agency membership relation. Never
> trust a caller-supplied agency_id: ordinary users may see global templates and
> user-scoped templates that they own, while agency templates remain available
> only to the authoritative superadmin control plane.

This is decision **D1**, and it is the one place where the brief asks for
something the codebase cannot currently support.

---

## 4. Identified risks

| # | Risk | Likelihood if unmitigated | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| **R1** | Library rows land in the production resolver's candidate set and hijack live report generation | High — one `is_active=true` | **Critical** — every PDF for that report type | Separate table. Library entries are structurally not resolvable. |
| **R2** | Library rows appear as cards in the existing Builder tab | **Certain** — `useReportTemplates()` has no filter | High — direct breach of the non-negotiable requirement | Separate table. |
| **R3** | Copy-on-use writes a malformed row (`config` is `NOT NULL`; `created_by` FK is to `auth.users`, not `custom_users`) | Medium | Medium — insert fails, or FK violation | Reuse the exact field-reset recipe already proven in `TemplateBranchingDialog.tsx:77-98`, including `created_by: null`. |
| **R4** | A library template contains block types outside `PRODUCTION_SAFE_BLOCK_TYPES`, so the copy can never be activated | Medium — the allow-list is narrower than the editor's palette | Medium — user hits a 422 late, after investing edits | Validate at **publish** time, not activation time. Store the result on the entry and show it on the card. |
| **R5** | Users expect a library template to produce a live report for a report type with no production adapter | **High** — nine of ten adapters are preview-only | High — trust damage | Per-entry compatibility badge; explicit "preview only" state. Decision **D2**. |
| **R6** | Thumbnails stored as signed URLs break after 24 hours | **Certain** if `render-template-pdf`'s response URL is persisted | Medium — a catalogue of broken images | Never persist signed URLs. Client-rendered SVG for cards; a public bucket for hero images. See [`02-architecture.md §5`](./02-architecture.md#5-previews-and-thumbnails). |
| **R7** | Heavy `schema` JSONB in list queries times out | Medium — `useReportTemplates.ts:38-45` documents multi-hundred-MB schemas from PDF imports blowing the statement timeout | High — the library page fails to load | Library list queries must select scalar metadata only, exactly as `TEMPLATE_LIST_SELECT` does. Never `select('*')` on a list. |
| **R8** | Adding a ninth tab breaks the `md:grid-cols-8` layout | High if unnoticed | Low — cosmetic | One class change in PR 3, verified against the mobile overflow-scroll path already present (line 185). |
| **R9** | Library adds a parallel write path that skips `manage-templates` guards | Medium — it is the easy shortcut | **Critical** — bypasses activation, lock and permission gates | Architectural rule: **all** `report_templates` writes go through `manage-templates`. No exceptions, no direct `supabase.from('report_templates').insert()`. |
| **R10** | Seeding 30–40 entries inflates the bundle if template schemas are imported as TypeScript | Medium | Medium — slower first paint for every user, including those who never open the library | Schemas live in the database, fetched on demand. Never in a bundled module. |
| **R11** | `template_audit_log.template_id` is `NOT NULL` with an FK to `report_templates` | — | Low | Library-side events (publish, archive) cannot go in that table. Instantiation events can, and should. |

---

## 5. What already exists that the library should reuse

Not building these again is most of the risk reduction.

| Need | Existing implementation | Reuse as |
| --- | --- | --- |
| Duplicate a template into an independent editable copy | `TemplateBranchingDialog.tsx:70-113` — fetch, spread, clear `id`/timestamps, reset `version`/`approval_status`/`is_active`/`is_default`/`locked_*`, insert via `manage-templates`, audit, navigate to the editor | The instantiation recipe, verbatim |
| Browse a catalogue with search, categories and thumbnails | `PageTemplatesMarketplaceDialog.tsx` — search + category chips + SVG previews rendered from the schema | The card grid and preview pattern |
| Render a preview without a PDF round-trip | `PreviewSvg` in the same file — `<svg viewBox="0 0 595 842">` from `page.size` | Card thumbnails |
| Feature flag with URL / storage / env precedence | `src/lib/reportTemplate/editorV2Flag.ts` + its spec | The library's kill-switch (added in this PR) |
| Version snapshots | `report_template_versions` + `useReportTemplateVersions` | Working-copy versioning — unchanged |
| Approvals | `template_approvals` + `TemplateApprovalDialog` | Working-copy approval — unchanged |
| Audit | `template_audit_log` + `logTemplateAudit` | Instantiation events |
| Compatibility linting | `lintTemplate.ts` (`renderer-unsupported`, `renderer-partial`, `unresolved-binding`, `missing-slot`, `bleed`, `low-contrast`, …) | Publish-time validation |
| Missing-data behaviour | `bindingResolver.ts` renders `''` for unknown paths; `| default` / `| fallback` filters supply substitutes | The contract for absent bindings — no new mechanism needed |
| Scalar-only list select | `TEMPLATE_LIST_SELECT` (`useReportTemplates.ts:68`) | The pattern for the library list query |

---

## 6. Existing template tables

| Table | Purpose | Library relevance |
| --- | --- | --- |
| `report_templates` | Builder templates. 30 columns. | Working copies are written here. **No library rows.** |
| `report_template_versions` | Version snapshots, `UNIQUE(template_id, version)` | Unchanged |
| `template_approvals` | pending / approved / changes_requested / cancelled | Unchanged |
| `template_audit_log` | `template_id NOT NULL` FK, `action`, `metadata` | Instantiation events only (R11) |
| `template_comments` | Owner-scoped since `20260729120000` | Unchanged |
| `template_events` | Analytics; service-role only | Optional library telemetry |
| `template_render_jobs` | Render job records with `signed_url_expires_at` | Evidence for R6 |
| `template_share_links` | Opaque public preview tokens | Possible future "share a library preview" |
| `template_components` | Reusable component payloads with `tags TEXT[]` | **Closest existing precedent** for the library table's shape |
| `template_imports` | PDF import runs | Unchanged |
| `report_structure_templates` | AI structure guides, drives the Formats tab | Unchanged |
| `brand_kits`, `client_branding_profiles`, `whitelabel_settings`, `cover_page_overlays` | Branding + cover | Unchanged |

`report_templates` full column list (from `src/integrations/supabase/types.ts`):

```
id, name, description, config(NOT NULL), is_default, created_by, created_at, updated_at,
report_type, tier, schema, version, is_active, thumbnail_url,
engine(CHECK jspdf|weasyprint), custom_css, active_theme, brand_kit_id,
parent_template_id(FK self), branch_label, is_draft, approval_status,
locked_for_review, locked_at, locked_by,
variant(CHECK composite|financial|due_diligence), scope(CHECK global|agency|user),
priority, agency_id, owner_user_id
```
