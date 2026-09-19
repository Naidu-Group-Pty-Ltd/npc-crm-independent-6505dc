# Phase 1 — Global Chrome (sidebar, breadcrumb, command palette, tokens)

**Date:** 2026-07-27
**Status:** Complete. Additive only — zero regressions to existing surfaces.

## Deliverables

### 1. Token additions (`src/styles/tokens.css`)
- Motion scale: `--motion-fast/base/slow`, `--motion-ease-out`, `--motion-ease-emphasized`.
- Radius scale: `--radius-sm/md/lg/xl/2xl`.
- Elevation scale: `--elevation-1..4` (theme-aware, dark uses black-tinted shadows).
- `--aurora-gradient` (composited radial-gradient consuming aurora-1/2/3).
- `--glass-tint`, `--glass-hairline` (theme-aware surface + border for GlassCard).

### 2. Shared primitives (`src/components/aurixa/`)
- `GlassCard.tsx` — formalised glass surface with elevation preset, interactive hover-lift, optional aurora backdrop, motion-reduce fallback.
- `SectionEmptyState.tsx` — actionable empty state (icon + heading + description + primary/secondary CTA). Satisfies the AGENTS.md "empty states must be actionable" rule.
- `BreadcrumbRail.tsx` — route-derived breadcrumb trail with label overrides, UUID collapse, aria-current.
- `index.ts` — barrel export unifying new primitives with the existing `AurixaMark`, `AurixaSectionHeader`, `StatusPill`. Single import path `@/components/aurixa`.

### 3. Sidebar in-place filter
- `DashboardSidebar.tsx` gained a slim search field ("Filter navigation…") above the nav groups. Filters titles across every visible group in real time. Auto-clears when the sidebar collapses to icon mode. Includes a ⌘K hint chip.
- Empty-match state renders a bordered helper card instead of a blank pane.

### 4. GlobalCommandPalette (`src/components/layout/GlobalCommandPalette.tsx`)
- ⌘K / Ctrl-K toggle plus `/` shortcut when no input has focus.
- Permission-gated entries (mirrors sidebar: `hasModuleAccess`, `isSuperadmin`, `useAmlAccess`).
- Groupings: Main · Reports · Clients & CRM · Operations · Help · Compliance · Admin.
- "Recent" section backed by `localStorage` (`aurixa.commandPalette.recent`, cap 6).
- Keyword aliases (e.g. "ai", "ask" → Report Q&A; "home", "dashboard" → Overview).
- Mounted globally from `DashboardLayout` for both mobile and desktop shells.

### 5. Layout wiring
- `DashboardLayout.tsx` mounts `<GlobalCommandPalette />` inside both breakpoints so the palette is available on every desktop and mobile Command Centre route.

## Verification

- `npx tsgo --noEmit` — clean (0 errors).
- `npm run audit:style` — no new regressions from Phase 1 (counts identical to Phase 0 baseline: paletteClasses 4, hexLiterals 844, inlineColorStyles 340, fontHardcoded 97, cssHexOutsideTokens 25).
- No existing consumer edited except the additive sidebar filter and the `DashboardLayout` palette mount.
- All new components consume semantic tokens only (`hsl(var(--…))`, `bg-[color:var(--…)]`, `bg-[image:var(--…)]`, motion-reduce guards).

## Not in Phase 1 (deferred by design)

- Topbar redesign, notification bell facelift, and workspace switcher chip — scheduled for a Phase 1.5 iteration after we validate the palette / sidebar filter in production.
- Command palette inline actions ("create client", "run report") — Phase 3 will register these once `DataTableToolbar` is in place.
- Rogue hex migration in `finance-portal.css` / `report-qa.css` / `components.css` — will roll into Phase 5 (modals) and Phase 7 (report surfaces) alongside the surfaces that own them.

## Follow-ups for Phase 2

- `MetricTile`, `KpiRow`, `AuroraHero` will consume the elevation and aurora tokens landed here.
- `SectionEmptyState` becomes the default for Phase 3 tables.
- `BreadcrumbRail` will be placed in `DashboardHeader` in the same Phase 1.5 pass.
