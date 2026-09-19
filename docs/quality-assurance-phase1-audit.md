# Quality Assurance Dashboard Phase 1 Audit

Date: 2026-06-30
Scope: `src/pages/QualityAssurance.tsx` and direct route/theme context only.

## Global Theme Foundation / Cascading UI Subcomponent

`docs/dashboard-theme-foundation.md` was inspected before UI changes. Relevant theme anchors for future Quality Assurance UI phases:

- Shared frame primitives: prefer `DashboardThemeFrame` variants `page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, and `toolbar` before adding page-local styling.
- Base tokens: `--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--muted`, `--muted-foreground`, `--border`, `--dashboard-surface`, `--dashboard-surface-elevated`, `--dashboard-surface-muted`, `--dashboard-border-soft`, `--dashboard-border-strong`, `--dashboard-primary-soft`, `--dashboard-primary-strong`, `--surface-1`, `--surface-2`, `--surface-3`, `--surface-elevated`, and `--surface-muted`.
- Preferred Tailwind token classes: `bg-card`, `text-foreground`, `text-primary`, `border-border`, `bg-background`, and `text-muted-foreground`.
- Premium interaction guidance: preserve shadcn primitives, use existing focus rings, hover states, radius, card shadow depth, dashboard scrollbar conventions, and token-based light/dark compatibility.
- Gold/brand usage: reserve `primary`/gold accents for active filters, selected states, primary emphasis, and subtle edge treatments.

## Current Quality Assurance Implementation Audit

### Route, authentication, and permission flow

- `src/App.tsx` imports `QualityAssurance` and mounts it at `/quality-assurance`.
- The route is wrapped in `ModuleGuard moduleKey="quality_assurance"`, so access control is route-level and must not be changed in UI phases.
- `src/pages/QualityAssurance.tsx` also calls `useModulePermissions('quality_assurance')`; the returned `canEditQA` value is currently not used by the page UI.
- Sidebar selection/navigation entries are outside this phase scope and intentionally untouched.

### Token warning banner

- The global token warning implementation lives in `src/components/billing/TokenBalanceBanner.tsx`.
- The banner renders only when `useTokenBalance()` returns `lowBalance` and `balance`.
- Top-up behaviour is handled by `openMissionControl(MISSION_CONTROL_TOPUP_URL)` and must remain unchanged.
- No Quality Assurance-specific banner branch exists yet; future styling must preserve the same render condition and top-up action.

### Page header and refresh

- The page title is exactly `Quality Assurance Dashboard`.
- The subtitle is exactly `Monitor report quality, validation issues, and data accuracy`.
- `Refresh` calls `handleRefresh`, sets `refreshing` to true, and reuses `loadQAData()`.
- The refresh icon spins while `refreshing` is true. Future UI work must preserve this state and action.

### Data loading, API calls, and state

- `loadQAData()` invokes `invokeSecureFunction('get-investment-reports', { listMode: true, listOptions: { select: 'id, property_address, created_at, calculation_version, validation_flags, data_sources, status', limit: 100 } })`.
- Reports are stored in local `reports` state without renaming or reshaping.
- Metrics are derived client-side from the fetched reports: total reports, reports with validation flags, critical issue count, high priority issue count, reports in the last 24 hours, average quality score, and a simple recent-vs-previous trend.
- Error handling currently logs to `console.error` and shows `toast.error('Failed to load quality assurance data')`.
- Loading state currently renders a centered spinner.
- No Supabase client call appears directly in `src/pages/QualityAssurance.tsx`; data access is mediated by `invokeSecureFunction`.

### Recent Reports workspace and filters

- The central card title is exactly `Recent Reports`.
- The helper text is exactly `Click on a report to view detailed validation results`.
- Filter tabs are shadcn `Tabs` with `defaultValue="all"`.
- Filters are ordered and labelled exactly: `All Reports`, `With Issues`, `Clean`.
- `All Reports` maps over `reports`.
- `With Issues` filters reports where `validation_flags` is an array with length greater than zero.
- `Clean` filters reports where `validation_flags` is not an array or has length zero.
- Future UI phases must not change these filter predicates or ordering.

### Report rows, detail flow, and validation result components

- Report rows use `report.id` as the React key and set `selectedReport` on click.
- Report title/address uses `report.property_address`.
- Generated timestamps use `new Date(report.created_at).toLocaleString()`.
- The all-reports row also displays `v{report.calculation_version || '1.0.0'}`.
- Data quality is delegated to `DataQualityIndicator` using `report.data_sources` cast to `DataSources`.
- Issue/clean badges are based only on the existing validation flag array length.
- Selecting a report renders `ValidationFlagsDisplay` with the selected report flags and the existing calculated quality score.
- Future UI phases must preserve report IDs, click behaviour, ordering, validation flag content, data sources, timestamps, and status data.

### Quality score and classification logic

- `calculateReportQualityScore(flags)` starts at 100 and deducts 15 for `critical`, 10 for `high`, 5 for `medium`, and 2 for all other severities, clamped at zero.
- `getQualityScoreColor(score)` maps scores to green, blue, yellow, or red text classes.
- These calculations are existing behaviour and are out of scope for UI-only enhancement unless a future request explicitly changes data logic.

## Strict UI-Only Scope Lock

Future phases may refine presentation, layout, containment, accessibility attributes, visual hierarchy, spacing, cards, badges, filters, loading/empty/error surfaces, and light/dark styling for the Quality Assurance tab only.

Future phases must not change:

- Report fetching endpoint, payload, selected columns, limit, or secure invocation helper.
- Report IDs, names/addresses, statuses, created timestamps, calculation versions, validation flags, data sources, or detail data.
- Quality score calculation, issue counting, clean/with-issues classification, severity classification, trend calculation, or last-24-hour calculation.
- Route path, `ModuleGuard`, authentication, permissions, sidebar grouping, unrelated pages, Supabase schema, database queries, or edge functions.
- Token balance low render condition, remaining-token text values, top-up destination, or `openMissionControl` behaviour.

## Phase 1 Touched Files Checklist

Touched in Phase 1:

- `docs/quality-assurance-phase1-audit.md` — documents the theme-token mapping, component/data-flow audit, and strict scope lock before UI implementation.

Intentionally untouched in Phase 1:

- `src/pages/QualityAssurance.tsx`
- `src/App.tsx`
- `src/components/billing/TokenBalanceBanner.tsx`
- `src/components/reports/ValidationFlagsDisplay.tsx`
- `src/components/reports/DataQualityIndicator.tsx`
- API, Supabase, authentication, permissions, route, sidebar, report-generation, and unrelated module files.
