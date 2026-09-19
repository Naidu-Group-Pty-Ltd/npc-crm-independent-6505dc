# Phase 2 — Role-adaptive dashboards (AuroraHero + MetricTile + KpiRow)

**Date:** 2026-07-27
**Status:** Complete. Additive primitives; Overview page migrated as the reference implementation.

## Deliverables

### Shared primitives (`src/components/aurixa/`)
- **`AuroraHero.tsx`** — Wraps `GlassCard` with `aurora` enabled. Slots for eyebrow (with icon chip), title, description, and actions. Semantic tokens only; no palette classes.
- **`MetricTile.tsx`** — KPI tile with icon, value, description, optional `delta` (direction + caption), and tone accents (`default | success | warning | danger | info`). Tone drives both the border ring and the icon-chip fill, all via `hsl(var(--…))`. Interactive hover-lift inherited from `GlassCard`.
- **`KpiRow.tsx`** — Responsive grid wrapper. Defaults to a fluid `auto-fit, minmax(min(100%, 15rem), 1fr)`; supports `columns={1..6}` for prescriptive layouts and `density='cozy'|'comfy'` for gap control.
- Barrel `index.ts` re-exports the new primitives + types.

### Reference migration
- `src/pages/Overview.tsx`
  - Replaced the bespoke `DashboardThemeFrame variant="hero"` block with `<AuroraHero />`, keeping the same actions (Export Snapshot, Flatten PDF, Filters) inside the `actions` slot.
  - Swapped the four executive `KPICard`s for `<KpiRow columns={4}>` + `<MetricTile />` with role-appropriate tones:
    - New This Week → `info`
    - With Inspections → default
    - Needs Review → `warning`
    - Average Price → `success`
  - Content-statistics row still uses the existing `KPICard` (deliberately deferred — cascade landing in Phase 3 when the same tone system rolls to `Reports`, `Clients`, and `Deal Pipeline`).

## Verification

- `npx tsgo --noEmit` — clean.
- `npm run audit:style` — identical counts to the Phase 1 baseline (`paletteClasses 4 · hexLiterals 844 · inlineColorStyles 340 · fontHardcoded 97 · cssHexOutsideTokens 25`). Zero new regressions from Phase 2.
- No hardcoded fonts or hex literals introduced. All colour references go through `--glass-hairline`, `--glass-tint`, `--aurora-gradient`, and the existing semantic status tokens.

## Not in Phase 2 (deferred by design)

- Rolling `MetricTile` into the remaining dashboards (Reports, Clients, Deal Pipeline, Market Updates, Finance Portal Insights) — batched into Phase 3 alongside the table toolbar migration to minimise regression surface.
- `AuroraHero` migration into secondary landing pages (Calendar, Templates, AML Home) — Phase 4.
- Sparklines inside `MetricTile` — waiting on the Phase 3 Recharts theming pass so we don't churn styling twice.

## Follow-ups for Phase 3

- `DataTableToolbar` primitive with search, filter chip, bulk-action bar, and row-density switch.
- Migrate `Listings`, `Reports`, and `Clients` tables in one pass so shared components stabilise before secondary consumers adopt them.
- Ship a `Sparkline` add-on for `MetricTile` powered by Recharts (`hsl(var(--dashboard-primary-strong))`).
