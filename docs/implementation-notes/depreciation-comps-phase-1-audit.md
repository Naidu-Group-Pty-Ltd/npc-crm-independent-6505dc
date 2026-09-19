# Depreciation Comps Phase 1 Audit and Scope Lock

## Phase 1 status

Phase 1 is complete. This note intentionally documents the theme audit, component/data-flow audit, and UI-only scope lock before any visual implementation work begins on the Depreciation Comparables Database administration surface.

## Global Theme Foundation / Cascading UI Subcomponent

`docs/dashboard-theme-foundation.md` was found and inspected before touching the Depreciation Comps implementation. The foundation identifies global dashboard tokens and shared primitives as the source of truth for future UI work:

- Core semantic tokens: `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--dashboard-surface`, `--surface-1`, `--topbar-background`, `--sidebar-surface`, and related dashboard CSS variables.
- Preferred Tailwind token utilities: `bg-card`, `bg-background`, `text-foreground`, `text-muted-foreground`, `text-primary`, `border-border`, and `hsl(var(--token-name))` instead of unrelated hard-coded colours.
- Shared frame variants to evaluate first: `DashboardThemeFrame` `page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, and `toolbar`.
- Dark/light compatibility requirement: preserve whitelabel theme support and test light mode, dark mode, mobile, desktop, forms, focus states, hover states, and sidebar layout after implementation.

Phase 2+ should compose existing shadcn primitives inside these dashboard tokens/frames before introducing page-local styling. A fallback token note is not required because `docs/dashboard-theme-foundation.md` exists.

## Theme token map for the Depreciation Comps UI

The following token/application map should guide later UI-only phases:

| Surface or interaction | Preferred source of truth |
| --- | --- |
| Page shell | `DashboardThemeFrame` `page`, `bg-background`, `text-foreground`, `min-w-0`, `overflow-x-hidden` |
| Premium header/hero | `DashboardThemeFrame` `hero`, `border-primary/20`, `bg-card`, `bg-background`, `text-foreground` |
| Cards/workspaces | `DashboardThemeFrame` `section`, `card`, or `premiumCard`; existing `Card` API preserved where needed |
| Tabs/toolbar | `DashboardThemeFrame` `toolbar`, `Tabs`, `TabsList`, `TabsTrigger`, `text-primary`, `border-primary/20` |
| Gold/primary emphasis | `--primary`, `text-primary`, `bg-primary`, `border-primary`, `ring-primary` with opacity utilities |
| Tables | Existing `Table` primitives, `border-border`, `bg-card`, `text-foreground`, `text-muted-foreground`, controlled horizontal scrolling |
| Upload/dropzone | `border-border`, `border-primary/30`, `bg-card`, `bg-background`, `text-primary`, dashed borders, focus/hover rings |
| Inputs/selects/forms | Existing shadcn `Input`, `Textarea`, `Select`, `Label`; tokenized borders/focus rings and viewport-safe layout |
| Buttons | Existing `Button` variants; primary gold for add/save/import where appropriate, outline/secondary for operational actions |
| Badges/counts | Existing `Badge`; `secondary`/neutral for passive counts, primary/gold accents for selected emphasis only |
| Status states | Existing toast/alert semantics; destructive only for genuine errors/destructive delete; success as existing toast state |
| Shadows/radius | shadcn radius plus `DashboardThemeFrame` shadows before new local shadows |
| Scrollbars/overflow | Tokenized thin scrollbars where already used; `min-w-0`, `overflow-x-auto`, `overscroll-x-contain`, table min-widths |
| Focus states | Visible tokenized focus rings using existing component focus-visible behavior and `ring-primary` when custom styling is necessary |

## Current component audit

Inspected implementation: `src/components/admin/DepreciationCompsAdmin.tsx`.

### Page shell and visible structure

- The page is currently rendered as a single shadcn `Card` with `CardHeader`, `CardTitle`, `CardDescription`, and `CardContent`.
- The header contains the `Database` icon, exact title `Depreciation Comparables Database`, subtitle `Manage the comparable properties dataset used for depreciation estimates`, and a record badge using `{comps.length} records`.
- Internal tabs are shadcn `Tabs` with `defaultValue="list"`, `TabsList`, and two triggers in the required order: `View Data`, then `Import Data`.
- No token balance warning banner is implemented inside this component; if present in the running Administration page, it is likely owned by a parent layout/shell and should not be moved or functionally changed during this Depreciation Comps-only scope.

### View Data workspace

- `View Data` contains two actions: `Add Comp` opens the add dialog by setting `showAddModal`, and `Refresh` calls `fetchComps` while respecting the `loading` disabled/spinner state.
- The comparison table is wrapped in a fixed-height `ScrollArea` and uses the displayed columns: `Price`, `Year`, `Type`, `Finish`, `City`, `Category`, `DV Total`, `PC Total`, plus an unlabeled delete-action column.
- Loading state renders a centered `Loader2` spinner in the table body.
- Empty state condition is `comps.length === 0` after loading and the exact message is `No comparables found. Add some data to enable the calculator.`
- Row rendering calculates displayed `dvTotal` and `pcTotal` from existing year fields for presentation only; future phases must not change the formula, source fields, or stored values.
- Delete uses the existing `handleDeleteComp` workflow, including browser confirmation, Supabase delete, toast success/failure, and refresh.

### Add comparable workflow

- The Add Comp workflow is a shadcn `Dialog` controlled by `showAddModal`.
- Current fields: `Purchase Price`, `Build Year`, `Purchase Date Category`, `Property Type`, `Finish Standard`, `Nearest City`, `Bulk Year Values (paste from spreadsheet)`, and `Notes (optional)`.
- Existing default values are defined in `newComp`: `post_budget_brand_new`, `house`, `medium`, `sydney_nsw`, `renovated: false`, and `fully_furnished: false`.
- Save action calls `handleAddComp`; it parses optional bulk years, validates purchase price/build year, inserts through Supabase, resets local state, closes the dialog, and refreshes.
- Cancel action only closes the dialog.

### Import Data workspace

- `Import Data` contains `Download Template`, a CSV file input, CSV error alert, preview table, and `Import All N Records` action.
- `Download Template` calls `handleExportTemplate`, which builds the existing CSV headers/example row and downloads `depreciation_comps_template.csv`.
- File input accepts `.csv` and calls `handleFileUpload`.
- The visible upload copy is split between two spans but preserves the required wording: `Click to upload` + ` or drag and drop a CSV file`.
- Important functional gap discovered: the current visible upload zone does not define explicit `onDragOver`/`onDrop` handlers. Native file-input browsing remains implemented; any later drag/drop enhancement must preserve parsing/import behavior and only add UI-safe event wiring if required by existing product expectations.
- CSV preview displays first five data rows plus header, while `csvFullData` preserves all parsed rows for import.

### Data flow, validation, API/Supabase, permissions

- Data load: `fetchComps` selects from Supabase table `depreciation_comps`, orders by `created_at` descending, limits to 100, and stores records in local state.
- CSV parsing: `parseCsvText` handles quoted commas, BOMs, CRLF/LF normalization, and non-empty rows.
- Header normalization: `normalizeCsvHeader` lowercases, trims, strips BOM, and converts names to snake-case-like keys.
- Type normalization: `normalizeEnumValue` maps CSV enum-ish text to expected values for `nearest_city`, `property_type`, `finish_standard`, and `purchase_date_category`.
- Boolean parsing: `parseBoolean` accepts `true`, `1`, `yes`, and `y`.
- Import excludes auto-generated/UUID/timestamp fields: `id`, `source_schedule_id`, `created_at`, `updated_at`, and `created_by`.
- Import required-record validation currently requires purchase price, purchase date category, build year, property type, finish standard, and nearest city.
- Import writes records to Supabase in batches of 500 via `supabase.from('depreciation_comps').insert(...)`.
- Add writes a single record with `supabase.from('depreciation_comps').insert(...)`.
- Delete removes by `id` with `supabase.from('depreciation_comps').delete().eq('id', id)`.
- Permissions/authentication are not locally implemented in this component and appear to be enforced by surrounding app/module access, Supabase client context, RLS, or route-level controls. Do not add, bypass, or relocate permission logic during UI phases.

## Strict UI-only scope lock for Phase 2+

Allowed future changes are limited to visual composition and layout in `src/components/admin/DepreciationCompsAdmin.tsx`, plus this handoff note if needed. Only introduce shared dashboard wrapper imports/classes when used to style this component.

Do not change:

- Supabase table names, queries, inserts, deletes, ordering, limits, or batching.
- CSV header schema, parser behavior, enum normalization, boolean parsing, required-field validation, excluded fields, or import batching.
- Record count logic or the `0 records` state.
- Depreciation year fields, `DV Total`, `PC Total`, formulas, displayed values, or stored values.
- Add, Refresh, Download Template, Import, Delete, toast, confirmation, loading, success, validation, or error trigger conditions.
- Route logic, sidebar/module grouping, authentication, permissions, RLS, storage behavior, or unrelated pages/modules.
- Existing field labels, tab labels/order, table header text/order, empty-state text, upload wording, or template filename unless a later explicit requirement says otherwise.

## UI-level risks and implementation notes

- The current surface is functionally clear but visually sparse; Phase 2 should introduce premium hierarchy without moving or changing data flows.
- The tab hierarchy is weak because the current full-width two-column tabs lack premium active/inactive emphasis and responsive containment treatment.
- The table uses vertical scrolling but not robust horizontal containment; long city/category/type values and future imported text can overflow or compress columns on narrow viewports.
- The upload zone is visually minimal and says drag/drop, but explicit drag-over/drop behavior was not found in this component; Phase 5 should be careful not to claim or implement logic changes unless matching existing behavior safely.
- CSV preview cells, upload errors, and file-related messages need wrapping/truncation safeguards so long values stay inside the viewport.
- The add dialog has a fixed max width and vertical scroll, but field grids are two-column only; Phase 4/8 should add responsive single-column behavior without changing fields or validation.
- Light/dark contrast currently relies on default shadcn styles; future premium styling should use dashboard tokens to avoid hard-coded colours and preserve whitelabel compatibility.
- Delete is already present as an unlabeled icon column even though the prompt focuses on Add/Refresh/import; retain it and style it as destructive only without altering confirmation behavior.

## Files touched in Phase 1

- `docs/implementation-notes/depreciation-comps-phase-1-audit.md` — created this developer audit/scope-lock note.

No application runtime code, data logic, calculations, import behavior, API/Supabase calls, route logic, permissions, or unrelated modules were modified in Phase 1.
