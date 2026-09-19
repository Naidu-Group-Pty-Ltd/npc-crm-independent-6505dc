# Template Library — Recommended Architecture

Every recommendation here is traceable to a finding in
[`01-current-state.md`](./01-current-state.md).

---

## 1. Where the library lives

### Options assessed

**Option A — library rows inside `report_templates`, marked with a flag**

- *Advantages:* zero new tables; the Builder can open a library template with no
  new code; one resolver; `parent_template_id` already exists for lineage.
- *Disadvantages:* library rows appear in the Builder tab immediately, because
  `useReportTemplates()` lists the table with no filter
  (`useReportTemplates.ts:91`) — that is a breach of the non-negotiable
  requirement on day one. Library rows also sit inside the production resolver's
  candidate set (`resolve_report_template` selects on `report_type` +
  `is_active`), so one mis-set flag changes live customer PDFs. Catalogue
  metadata (industry, tags, tier, preview images, usage counts) would have to be
  bolted onto a table whose every column is already load-bearing for report
  generation.
- *Verdict:* **rejected.** The first disadvantage alone disqualifies it.

**Option B — a separate `template_library_entries` table; "Use template" copies into `report_templates`**

- *Advantages:* structural isolation from both the resolver and the Builder list —
  the two highest-impact risks become impossible rather than merely unlikely.
  Catalogue metadata gets its own schema without polluting the reporting schema.
  Master templates cannot be edited by the Builder because the Builder cannot see
  them. The copy is an ordinary Builder template from birth, so versioning,
  approvals, branching, locking and rendering work with no new code.
- *Disadvantages:* one new table and one new read path; the schema JSONB is stored
  in two shapes (catalogue + copy), so a compatibility check is needed at copy
  time; lineage needs somewhere to live.
- *Verdict:* **recommended.**

**Option C — library entries as static files bundled in the app**

- *Advantages:* no database work at all; version-controlled with the code.
- *Disadvantages:* 30–40 template schemas in the JS bundle — the codebase already
  documents multi-hundred-MB schemas from PDF imports
  (`useReportTemplates.ts:38`), so this is a serious payload risk for every user
  including those who never open the library. No publishing workflow, no usage
  analytics, no per-tenant availability, and a content change requires a deploy.
- *Verdict:* **rejected**, though a small static *manifest* (categories,
  industries, tag vocabulary) is fine and is recommended in §6.

### Recommendation

**Option B.** New table `template_library_entries`. Library templates are
catalogue data. Working copies are Builder data. The boundary between them is a
copy operation, not a flag.

```
┌──────────────────────────┐         "Use template"          ┌─────────────────────────┐
│ template_library_entries │  ──────────────────────────────▶│    report_templates     │
│  (master catalogue)      │   copy schema + reset flags     │  (working copies —      │
│                          │   via manage-templates insert   │   unchanged behaviour)  │
│  • never resolvable      │                                 │                         │
│  • never in Builder list │◀── template_library_             │  • existing Builder     │
│  • superadmin-writable   │    instantiations (lineage)     │  • existing resolver    │
└──────────────────────────┘                                 └─────────────────────────┘
```

---

## 2. Where it appears in the UI

**Recommendation: a ninth tab on the existing Template Management page**, value
`template-library`, positioned immediately after `builder`.

- *Why a tab:* the user's mental model is already "templates live here". A
  separate top-level route splits template work across two navigation entries for
  no benefit. The tab list already scrolls horizontally on mobile
  (`Templates.tsx:185`), so a ninth tab costs one class change
  (`md:grid-cols-8` → `md:grid-cols-9`) and nothing else.
- *Why not a sub-tab inside Builder:* that would mean editing the Builder tab's
  JSX, which the non-negotiable requirement forbids.
- *Why not a modal from "New template":* it would change the existing creation
  flow, which the requirement also forbids.

Unlike the Builder tab, the library tab must be **a component**, not inline JSX:
`src/components/templateLibrary/TemplateLibraryTab.tsx`. `Templates.tsx` gains
one import, one `TabsTrigger` and one `TabsContent` — roughly six lines, all
additive, all in PR 3.

Full-page preview gets its own route, `/admin/template-library/:entryId`, so a
preview is linkable and shareable. It is guarded by
`<ModuleGuard moduleKey="templates">` like every other template route.

The whole surface sits behind the feature flag added in this PR
(`src/lib/templateLibrary/featureFlag.ts`, default **OFF**). With the flag off the
tab does not render and the route returns the existing not-found behaviour, so
production is byte-identical to today until the flag is flipped.

---

## 3. How a library template becomes an editable working copy

**Duplicate — a snapshot copy with recorded lineage.** Not a reference, not
inheritance.

The recipe is the one `TemplateBranchingDialog.tsx:70-113` already proves in
production:

```ts
// Conceptual — PR 4 implements this in src/lib/templateLibrary/instantiate.ts
const insert = {
  name,                                  // user-supplied
  description,                           // user-supplied, optional
  schema: entry.schema,                  // deep copy from the library entry
  config: entry.config ?? {},            // NOT NULL on the column
  custom_css: entry.custom_css ?? null,
  report_type: entry.report_type,
  tier: entry.tier,
  engine: entry.engine,                  // 'weasyprint'

  // Everything that makes a template live is reset:
  version: 1,
  is_active: false,
  is_default: false,
  is_draft: true,
  approval_status: 'draft',
  locked_for_review: false,
  locked_at: null,
  locked_by: null,
  parent_template_id: null,              // FK is to report_templates; a library
                                         // entry is not in that table
  created_by: null,                      // FK → auth.users; custom-auth ids are
                                         // NOT in auth.users. See
                                         // TemplateBranchingDialog.tsx:91-94
  scope: 'user',
  owner_user_id: currentUserId,
};
// Written through invokeSecureFunction('manage-templates', { operation:'insert', … })
```

Then insert a `template_library_instantiations` row, write a
`template_audit_log` entry with `action: 'library_instantiated'` (the FK is
satisfied — the new template exists), and navigate to
`/admin/template-builder/${created.id}`.

The user lands in the existing Builder, editing an ordinary template. From that
moment the Template Library is out of the picture.

**Why snapshot rather than reference:** a reference would mean the Builder has to
understand a template it does not own, and a library edit would silently change
a customer's saved design. A snapshot means the master is unreachable from the
editor — accidental master editing becomes impossible rather than merely
guarded.

**Master protection, in layers:**

1. Masters are in a different table; the Builder has no query that reaches them.
2. `template_library_entries` RLS grants `SELECT` to authenticated users and
   `INSERT/UPDATE/DELETE` to `service_role` only.
3. The library's own write path checks superadmin before any mutation.
4. Published entries are immutable: an edit creates a new version rather than
   changing the published row (§8).

---

## 4. What happens when a master template changes

**Recommendation: notify, never auto-update** (decision **D4**).

`template_library_instantiations` records `entry_version_at_copy`. When an entry
is republished at a higher version, working copies derived from the older version
can be surfaced with a passive "a newer version of the source template is
available" note in the Builder's existing metadata area — or, in the first
release, nowhere at all.

- *Auto-update rejected:* a customer's approved, active, branded report design
  changing because a catalogue entry was edited is a data-integrity incident, not
  a feature.
- *Migration assistant deferred:* a "re-apply the new master, keep my content"
  merge is a genuinely hard diff problem. `diffSchema.ts` and
  `BeforeAfterDiff.tsx` exist and could underpin it later. Out of scope.

---

## 5. Previews and thumbnails

Constraint (**R6**): `render-template-pdf` uploads to the **private**
`investment-reports` bucket and returns a **24-hour signed URL**
(`render-template-pdf/index.ts:184-187`). **A signed URL must never be persisted
as a thumbnail.**

Three-tier recommendation:

| Surface | Mechanism | Why |
| --- | --- | --- |
| **Card thumbnail** in the grid | Client-rendered SVG from the entry's stored `preview_schema` (page 1 only), exactly as `PageTemplatesMarketplaceDialog.PreviewSvg` already does | Instant, zero storage, always matches the schema, no signed-URL rot, no bucket |
| **Full preview modal** | Pre-rendered PNG per page in a **new public bucket** `template-library-previews`, generated once at publish time, path `${entryId}/v${version}/page-${n}.png` | Photoreal, CDN-cacheable, immutable per version, no expiry |
| **"Render live sample"** action | On-demand WeasyPrint render with sample data, behind an explicit button | Accurate but slow and metered — never on the browse path |

`preview_schema` is a **trimmed** copy of page 1 with base64 image data stripped —
enough for an SVG silhouette, small enough to include in the list query. The full
`schema` is fetched only when the user opens a preview or clicks "Use template"
(the same on-demand pattern as `useReportTemplate(id)`).

The list query selects scalar metadata plus `preview_schema` only. It must never
`select('*')` (**R7**).

---

## 6. Categorisation

A four-axis taxonomy, all stored on the entry:

| Axis | Type | Values | Source of truth |
| --- | --- | --- | --- |
| `category` | text, CHECK | `investment`, `suburb`, `postcode`, `statewide`, `comparison`, `cash_flow`, `client_form`, `compliance` | Mirrors the existing `FORMAT_GROUPS` in `Templates.tsx:108` |
| `report_type` | text, nullable | the existing report-type vocabulary | Must match `report_templates.report_type` so the copy resolves correctly |
| `industry` | text[] | `property`, `finance`, `legal`, `general` | Static manifest |
| `tags` | text[] | free vocabulary | `template_components.tags` precedent |

Plus `style` (`corporate`, `editorial`, `minimal`, `luxury`, `technical`),
`orientation` (`portrait`/`landscape`) and `page_size` (`A4`, `Letter`, …, from
`paperSizes.ts`).

The controlled vocabularies live in a small static manifest
(`src/lib/templateLibrary/taxonomy.ts`) so filter chips render without a network
round-trip; the **values on each entry** live in the database. This is the one
place Option C's static-file idea is correct.

---

## 7. White-labelling and branding compatibility

The existing pipeline (`docs/WHITE_LABEL_TOKEN_CONTRACT.md`) resolves
`token:primary`-style references at render time from `whitelabel_settings` /
`brand_kits`. A template that uses tokens throughout is white-label-ready; one
that hard-codes `#0C2340` is not.

**Recommendation: make this a publish-time gate, not a hope.**

`brand_safe boolean` on the entry, computed at publish by walking the schema for
literal colour values outside `tokens`. An entry that fails is not blocked from
publishing — some templates legitimately fix a colour — but it is badged
"fixed palette" in the UI so nobody is surprised when a partner's brand does not
apply.

`brand_kit_id` on `report_templates` is nullable and untouched by the copy, so a
working copy picks up whatever brand kit the Builder assigns it, exactly as today.

---

## 8. Publishing, versioning and deprecation

```
draft ──▶ in_review ──▶ published ──▶ deprecated ──▶ archived
  ▲           │              │
  └───────────┘              └──▶ (new version starts a new draft row)
```

- `status` on the entry: `draft | in_review | published | deprecated | archived`.
- `version integer` on the entry, incremented on each publish.
- **Published entries are immutable.** Editing a published entry creates a new
  row at `version + 1` in `draft`, sharing a `family_id`. Publishing the new
  version moves the old one to `deprecated`. This is why usage lineage records a
  version: an instantiation always points at an exact, unchanging snapshot.
- Only `published` entries are visible to non-superadmins.
- `deprecated` entries stay resolvable for lineage and stay visible to
  superadmins, but leave the browse grid.
- `archived` is soft-delete. **There is no hard delete in the library UI.**

Publish-time validation, all reusing existing code:

| Check | Implementation |
| --- | --- |
| Schema parses at the supported version | `parseTemplate` + `validateAndMigrateTemplateSchemaVersion` |
| No block type outside the production allow-list | the same `PRODUCTION_SAFE_BLOCK_TYPES` set used by `manage-templates` |
| No lint errors of severity `error` | `lintTemplate.ts` |
| Declared bindings resolve against `KNOWN_DATA_PATHS` | `bindingValidation.ts` |
| Report type has a production adapter | `hasProductionReportTemplateAdapter` — result stored, not enforced (**D2**) |
| Brand tokens used rather than literals | new walker, §7 |

`compatibility_version` on the entry records
`SUPPORTED_TEMPLATE_SCHEMA_VERSION` at publish, so a deployment can filter out
entries it cannot parse rather than erroring on them.

### Handling unsupported or missing data fields

No new mechanism is needed — the existing behaviour is already correct and should
be documented rather than replaced:

- An unresolved `{{path}}` renders as an **empty string** (`bindingResolver.ts`).
- `| default:'—'` and `| fallback:'—'` supply substitutes.
- `lintTemplate` raises `unresolved-binding` in the editor.

The library's contribution is **declaring** requirements up front:
`required_bindings text[]` on the entry, surfaced in the preview as "This template
uses: property.address, financials.weeklyRent, …" so a user knows what the
template needs before they copy it.

---

## 9. Open decisions

Restated from the [README](./README.md#3-decisions-required-before-pr-2) with the
architectural consequence of each.

**D1 — Tenancy.** No organisation/tenant/agency table exists. `agency_id` on
`report_templates` is an orphan column and migration `20260726143000` says so
explicitly.

*Recommendation:* ship `visibility text NOT NULL DEFAULT 'global' CHECK (visibility IN ('global','agency'))`.
Only `'global'` is reachable in PR 2–5. When a tenancy model arrives, `'agency'`
becomes usable with no migration to the column. **Do not build a tenant model
inside this feature**, and do not describe the library as tenant-isolated until
one exists. This is the single largest gap between the brief and the codebase.

**D2 — Adapter coverage.** Nine of ten adapters are preview-only; five report-type
aliases can be activated. A 30–40 template library will be mostly preview-only.
*Recommendation:* store `production_ready boolean` per entry, badge it on the
card, and let users copy and edit regardless. Do not widen the allow-list as a
side effect of this feature.

**D3 — Authoring.** *Recommendation:* author in the existing Builder, then
"Promote to library" (superadmin action in PR 5). The template is validated by
the editor and the renderer before it ever becomes catalogue content. A bulk
seed path can follow later if content is authored externally.

**D4 — Update propagation.** *Recommendation:* snapshot + notify. §4.

**D5 — Permission module.** *Recommendation:* reuse `templates`. Browsing needs
`templates:view`, "Use template" needs `templates:edit` (identical to creating a
Builder template), publishing needs superadmin. No new `dashboard_modules` row,
no permission-matrix migration.

---

## 10. Recommended user journey

```
Template Management  ▸  Template Library tab
      │
      ├─ Grid of published entries (SVG thumbnails, 3-up desktop / 1-up mobile)
      │    ├─ Search:  name, description, tags        (client-side, debounced 200ms)
      │    └─ Filters: category · report type · industry · style · orientation
      │                · compatibility          (multi-select chips, URL-synced)
      │
      ├─ Card  ▸  [Preview]  [Use template]
      │
      ├─ Preview  →  /admin/template-library/:entryId
      │    ├─ Page-by-page hero images
      │    ├─ Sections & supported components
      │    ├─ Required data bindings
      │    ├─ Compatibility panel: report type · adapter · engine · brand-safe
      │    └─ [Use template]
      │
      └─ Use template  ▸  modal
           ├─ Name*            (prefilled "<entry name> copy", validated non-empty)
           ├─ Description      (optional)
           ├─ Compatibility warning if production_ready = false
           └─ [Create working copy]
                 └─ POST manage-templates insert  →  lineage row  →  audit
                       └─ navigate /admin/template-builder/:newId
                             └─ EXISTING BUILDER — unchanged from here on
```

### States

| State | Treatment |
| --- | --- |
| Loading | Skeleton cards, same `<Skeleton className="h-44">` grid as `Templates.tsx:353` |
| Empty (no entries) | "No templates published yet" + a superadmin-only link to the publishing view |
| Empty (filters exclude all) | "No templates match these filters" + a "Clear filters" button — mirrors `Templates.tsx:390-399` |
| Fetch error | Inline error card with a retry action. Never a blank grid. |
| Preview render fails | Fall back to the SVG thumbnail with a "preview unavailable" note; never block "Use template" |
| Creating a copy | Button enters pending state, modal stays open, all inputs disabled |
| Copy succeeded | `toast.success('Working copy created')` then navigate — same `sonner` pattern as `useReportTemplates` |
| Copy failed | Toast with the server message; modal stays open with input preserved so the user can retry |
| No `templates:edit` | "Use template" hidden, not disabled. Preview stays available. |
| Not in plan | Existing `includedInPlan` upgrade affordance |

### Accessibility and responsiveness

Reuse the design system throughout (`Card`, `Badge`, `Dialog`, `Input`, `Select`,
`Skeleton`, `Tabs`). Filter chips are real toggle buttons with `aria-pressed`; the
grid is a list with accessible names on each card; the preview modal traps focus
and restores it on close (shadcn `Dialog` gives this); thumbnails carry
descriptive `alt` text. Grid is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`,
matching the Builder tab. Semantic tokens only — `npm run audit:style` must not
regress.

---

## 11. Recommended data model

### `template_library_entries` (new)

Every column is additive; no existing table is altered.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `family_id` | uuid NOT NULL | Stable across versions of the same template |
| `slug` | text NOT NULL | `UNIQUE (slug, version)`; stable public identifier |
| `name` | text NOT NULL | |
| `description` | text | |
| `long_description` | text | Rendered in the preview |
| `category` | text NOT NULL | CHECK, §6 |
| `report_type` | text | Must match `report_templates.report_type` |
| `tier` | text | `compass` / `executive` / `snapshot` |
| `variant` | text | CHECK matching `report_templates.variant` |
| `industry` | text[] | DEFAULT `'{}'` |
| `tags` | text[] | DEFAULT `'{}'` |
| `style` | text | |
| `orientation` | text NOT NULL DEFAULT `'portrait'` | CHECK |
| `page_size` | text NOT NULL DEFAULT `'A4'` | |
| `page_count` | integer NOT NULL DEFAULT 0 | Denormalised from the schema at publish |
| `schema` | jsonb NOT NULL | The `ReportTemplate` payload |
| `config` | jsonb NOT NULL DEFAULT `'{}'` | Copied into the working copy's NOT NULL `config` |
| `custom_css` | text | |
| `engine` | text NOT NULL DEFAULT `'weasyprint'` | CHECK, mirrors `report_templates` |
| `preview_schema` | jsonb | Trimmed page 1 for SVG cards (§5) |
| `preview_image_paths` | text[] | Public-bucket paths, **never signed URLs** |
| `thumbnail_path` | text | Public-bucket path |
| `supported_modules` | text[] | Block types present in the schema |
| `required_bindings` | text[] | §8 |
| `brand_safe` | boolean NOT NULL DEFAULT false | §7 |
| `production_ready` | boolean NOT NULL DEFAULT false | §9 D2 |
| `compatibility_version` | integer NOT NULL DEFAULT 1 | `SUPPORTED_TEMPLATE_SCHEMA_VERSION` at publish |
| `status` | text NOT NULL DEFAULT `'draft'` | CHECK, §8 |
| `version` | integer NOT NULL DEFAULT 1 | |
| `access_tier` | text NOT NULL DEFAULT `'standard'` | `standard` / `premium` / `enterprise` — maps to `planEnablesSubModule` later |
| `visibility` | text NOT NULL DEFAULT `'global'` | CHECK `('global','agency')`, §9 D1 |
| `agency_id` | uuid | Reserved, unusable until D1 resolves |
| `source_template_id` | uuid | Nullable FK → `report_templates(id)` ON DELETE SET NULL — the Builder template it was promoted from |
| `created_by_user_id` | uuid | **`custom_users.id`, no FK to `auth.users`** — see R3 |
| `created_at` / `updated_at` / `published_at` / `deprecated_at` | timestamptz | |
| `usage_count` | integer NOT NULL DEFAULT 0 | Denormalised counter |
| `last_used_at` | timestamptz | |

Indexes: `(status, category)`, `(status, report_type)`, `(family_id, version DESC)`,
GIN on `tags`, GIN on `industry`, `UNIQUE (slug, version)`.

> **Naming note.** `created_by_user_id` deliberately differs from
> `report_templates.created_by`. That column is an FK to `auth.users` and this
> platform's custom-auth ids are not in `auth.users` — which is why
> `TemplateBranchingDialog` sets it to `null`. Reusing the name would invite the
> same trap.

### `template_library_instantiations` (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `entry_id` | uuid NOT NULL | FK → `template_library_entries(id)` ON DELETE RESTRICT |
| `entry_version_at_copy` | integer NOT NULL | §4 |
| `template_id` | uuid | FK → `report_templates(id)` **ON DELETE SET NULL** — deleting a working copy must not erase usage history |
| `created_by_user_id` | uuid | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

Index `(entry_id, created_at DESC)`.

### Field-by-field response to the requested data model

| Requested | Provided as | Note |
| --- | --- | --- |
| Template ID / name / description | `id`, `name`, `description` | |
| Category / report type / industry / tags | `category`, `report_type`, `industry`, `tags` | |
| Template source | `source_template_id` | |
| Master-template status | Membership of `template_library_entries` | Being in the table *is* being a master |
| User-created-template status | Membership of `report_templates` | Unchanged |
| Draft / published / archived / deprecated | `status` | Plus `in_review` |
| Template version | `version` (+ `family_id`) | |
| Parent / source template ID | `template_library_instantiations` | Kept off `report_templates` so **no existing table is altered** |
| Thumbnail / preview images | `thumbnail_path`, `preview_image_paths` | Paths, never signed URLs (R6) |
| Page count | `page_count` | |
| Supported modules / data bindings | `supported_modules`, `required_bindings` | |
| Branding compatibility | `brand_safe` | |
| Orientation / page size | `orientation`, `page_size` | |
| Premium tier / access level | `access_tier` | |
| Created by / dates / usage | `created_by_user_id`, `created_at`, `updated_at`, `published_at`, `usage_count`, `last_used_at` | |
| **Organisation ownership / tenant availability** | `visibility`, `agency_id` | **Reserved, not functional.** Decision D1. |
| Global availability | `visibility = 'global'` | |
| Permissions | RLS + module permissions, §12 | No per-entry ACL in v1 |
| Template configuration / schema | `schema`, `config`, `custom_css` | Identical shape to `report_templates` |
| Compatibility version | `compatibility_version` | |

### Impact on existing structures

**None.** No `ALTER TABLE`, no rename, no column drop, no data migration, no RLS
change on any existing table. Every existing row, policy, index and constraint is
untouched. Lineage lives in the new join table precisely so that
`report_templates` never has to change.

---

## 12. Security, permissions and governance

| Action | Required | Enforced where |
| --- | --- | --- |
| Browse published entries | `templates:view` | Client guard + RLS `status='published'` |
| Preview an entry | `templates:view` | as above |
| Create a working copy | `templates:edit` | `manage-templates.assertTemplatePermission` — already exists, unchanged |
| Promote a Builder template to a library draft | **superadmin** | New `manage-template-library` edge function |
| Edit a library draft | **superadmin** | as above |
| Publish | **superadmin** + validation gate (§8) | as above |
| Deprecate / archive | **superadmin** | as above |
| Hard delete | **nobody via the UI** | No delete operation is exposed |

RLS on `template_library_entries`:

```sql
-- Read: published entries only, for authenticated users.
CREATE POLICY "library_read_published" ON public.template_library_entries
  FOR SELECT TO authenticated USING (status = 'published');
-- Write: service_role only. All mutations go through the edge function,
-- which checks superadmin first.
CREATE POLICY "library_service_role_all" ON public.template_library_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Superadmins see drafts through the service-role function, not through a widened
RLS policy — the same control-plane pattern `manage-templates` already uses for
agency-scoped templates.

**Audit.** `template_audit_log.template_id` is `NOT NULL` with an FK to
`report_templates`, so library-side events cannot go there (**R11**).

- Instantiation → `template_audit_log`, `action: 'library_instantiated'`,
  `metadata: { entry_id, entry_version }`. The FK is satisfied because the
  working copy exists. **Zero migration.**
- Library-side publish/deprecate/archive → `template_library_events`
  (`entry_id`, `event_type`, `actor_id`, `metadata`, `created_at`), added in PR 5
  when publishing controls arrive, not before.

**Malformed configuration.** Defence in depth: Zod `parseTemplate` at the
boundary; `validateAndMigrateTemplateSchemaVersion` rejecting future versions with
422; the `PRODUCTION_SAFE_BLOCK_TYPES` allow-list; `lintTemplate` errors blocking
publish; and — critically — the copy flowing through `manage-templates`, so a
malformed library schema is rejected on the way into `report_templates` by the
same guard that protects the Builder today.

**Rollback.** Publishing never overwrites: a new version is a new row (§8).
Rolling back is re-publishing the prior version, which is still on disk. No
destructive operation exists to undo.
