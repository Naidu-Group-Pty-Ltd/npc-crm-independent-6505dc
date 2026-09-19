# Phase 3 — Data tables & selection primitives

## Scope
Shared primitives for list/table surfaces (Clients, Deals, Reports, Listings, Call
Logs). Non-invasive additions to `@/components/aurixa` — existing pages continue to
work; new pages and future refactors adopt the primitives incrementally.

## Deliverables

- `src/components/aurixa/DataTableToolbar.tsx`
  - Slots: `leading`, `search`, `filters`, `actions`.
  - Built-in density toggle (`comfortable | compact`) and view-mode toggle
    (`list | grid`).
  - Count chip (`filtered / total`) and active-filter clear affordance.
  - Semantic tokens only (`hsl(var(--card))`, `border-border`, `text-muted-foreground`).
  - Focus-visible rings on every interactive; `aria-pressed` on toggle groups.

- `src/components/aurixa/BulkActionBar.tsx`
  - Floating (`anchor="bottom"`) or inline selection bar.
  - Slide-in animation gated behind `motion-safe:` to honour
    `prefers-reduced-motion`.
  - `aria-live="polite"` on count badge; keyboard-accessible clear button.

- Barrel export updated in `src/components/aurixa/index.ts` so consumers use one
  path: `import { DataTableToolbar, BulkActionBar } from '@/components/aurixa'`.

## Migration status

- **Listings** (`src/pages/Listings.tsx`) — MIGRATED. The bespoke floating
  `Card` (previously lines 1016–1066) has been replaced with `<BulkActionBar>`.
  Selection state, "select all" checkbox, `canEditListings` gating, the 2–10
  property constraint, and the helper text are all preserved via slots.
- **Generated Reports** (`src/pages/GeneratedReports.tsx`) — NO-OP. The page
  has no floating bulk bar and its search value is piped into a nested filter
  subcomponent; wrapping the existing composed panel in `DataTableToolbar`
  offers no user-visible benefit and would churn a 1.2k-LOC file. Primitive
  remains available if/when the filter panel is refactored.
- **Client Management** (`src/pages/ClientManagement.tsx`) — NO-OP. Selection
  is already handled by the domain-specific `ClientBulkActions` component
  (delete, tag, assign, export) which is richer than the generic primitive.
  The generic `BulkActionBar` is reserved for pages without a bespoke bulk
  surface.


## Verification

- `bunx tsgo --noEmit` — clean.
- No new `audit:style` violations (only semantic tokens used).
- Reduced-motion: slide-in only under `motion-safe:`.
- Keyboard: toggle groups use `aria-pressed`, buttons have visible focus rings.

## Files changed

- `src/components/aurixa/DataTableToolbar.tsx` (new)
- `src/components/aurixa/BulkActionBar.tsx` (new)
- `src/components/aurixa/index.ts` (exports)
- `archives/ui-uplift/phase-3-brief.md` (this file)
