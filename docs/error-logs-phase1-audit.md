# Error Logs Phase 1 Audit and UI Scope Lock

Phase 1 establishes the design-token baseline and records the existing Error Logs implementation before any premium UI enhancement work. This note is intentionally documentation-only and keeps Phase 1 scoped to the Administration **Error Logs** tab.

## Theme foundation mapping

Source inspected: `docs/dashboard-theme-foundation.md`.

- Use the shared dashboard token system instead of a page-local theme: `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--dashboard-surface`, `--surface-1`, `--topbar-background`, `--sidebar-surface` and related dashboard variables.
- Prefer token-aware classes such as `bg-card`, `text-foreground`, `text-primary`, `border-border`, `bg-background`, `text-muted-foreground` and `hsl(var(--token-name))` where local CSS is unavoidable.
- Prefer `DashboardThemeFrame` variants (`page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, `toolbar`) before adding page-local styling.
- Preserve existing shadcn primitives and compose premium treatments around their APIs rather than replacing `Card`, `Button`, `Input`, `Tabs`, `Select`, `Badge` or `Collapsible` behaviour.
- Future UI phases must verify light mode, dark mode, mobile, desktop, focus states, hover states, forms, dashboard layout and sidebar compatibility.
- Status treatment should remain severity-aware: red/destructive only for genuine critical/error states, amber/gold for warnings and attention states, green/teal for improving or healthy states, and neutral token colours for metadata.

## Current Error Logs implementation audit

Source inspected: `src/pages/ErrorLogs.tsx`, `src/App.tsx`, `src/components/layout/DashboardSidebar.tsx`, `src/components/layout/MobileSidebar.tsx`, `src/components/billing/TokenBalanceBanner.tsx` and `src/hooks/useSecureCallLogs.ts`.

### Route, navigation and permissions

- Page component: `src/pages/ErrorLogs.tsx` exports `ErrorLogs`.
- App route: `/error-logs` is rendered through `ModuleGuard moduleKey="error_logs"`, so route access and permissions are controlled outside the page component.
- Desktop Administration sidebar item: `Error Logs` points to `/error-logs` with `moduleKey: 'error_logs'`.
- Mobile sidebar item: `Error Logs` points to `/error-logs` with `moduleKey: 'error_logs'`.
- Phase 1 does not modify routes, module keys, sidebar grouping, authentication, permissions or guards.

### Token warning and Top up action

- The token balance low banner is global dashboard chrome in `TokenBalanceBanner`, not local Error Logs page state.
- Current low-balance text includes `Token balance low`, the remaining token message, `Top up to avoid interrupted report generation.` and the `Top up` button.
- The Top up action remains owned by the existing token banner implementation; Phase 1 does not change token balance calculations, low-balance conditions, navigation, mission-control URLs or button handlers.

### Header, summary and filter UI

- Header text is `Error Logs` and `Unified error monitoring across all integrations`.
- Refresh uses the existing `fetchErrors` handler, `isLoading` disabled state and spinning `RefreshCw` icon.
- KPI cards render only when `stats` exists and preserve labels: `Total Errors`, `Critical`, `Errors`, `Warnings`, `Trend`.
- KPI values and captions are calculated from `unifiedErrors` without external mutation: total count, severity counts, source counts, `last24h`, `last7d` and trend (`up`, `down`, `stable`).
- Filters preserve `Filters`, `Search errors...`, `All Sources`, `All Severities`, `Last 24h`, `Last 7 days` and `Last 30 days` labels/options.
- Source/category tabs preserve `All` first, then non-empty sources from `SOURCE_CONFIG`, including `Investment Reports` when present.

### Error data flow and records

- `fetchErrors` gathers unified records from the secure `get-system-logs` edge function, `bulk_generation_items` Supabase table, secure Vapi error-call hook, stuck reports and failed reports.
- Error source labels and icons are defined in `SOURCE_CONFIG`; severity labels, badge variants and icons are defined in `SEVERITY_CONFIG`.
- Existing helper logic remains authoritative: `determineSeverity`, `extractErrorCode` and `cleanErrorMessage`.
- Current filtering is local UI state only: `searchQuery`, `selectedSource`, `selectedSeverity` and `dateRange`.
- Error rows preserve severity badge, source icon, error code, relative timestamp, error message, entity label, Retry action where `canRetry` is true, View link where an entity link exists and collapsible details.
- Existing visible labels to preserve exactly in later UI work include: `Error Logs`, `Unified error monitoring across all integrations`, `Total Errors`, `Critical`, `Errors`, `Warnings`, `Trend`, `Filters`, `Search errors...`, `All Sources`, `All Severities`, `Last 7 days`, `All`, `Investment Reports`, `Warning`, `REPORT_STUCK_PROCESSING`, `Report stuck in processing for 4 days`, `Retry` and `View`.

### Detail, retry, loading, empty and error states

- Detail view is an inline `Collapsible` section, not a separate modal/drawer, and currently displays `Details`, `Source`, `Time`, truncated `Entity ID`, optional `Metadata` and optional `Raw Error`.
- Retry is limited to investment-report entities with an `entityId`; it updates `investment_reports`, invokes `generate-investment-report`, toasts success/failure and refreshes after a short delay.
- Loading state displays a centered spinning `RefreshCw`.
- Empty/no-results state displays `No errors found` and `All systems operating normally` under the current trigger condition of zero filtered rows.
- Fetch failures are surfaced through the existing destructive toast `Failed to load error logs`; retry failures are surfaced through the existing destructive toast `Retry failed`.

## Files/components touched in Phase 1

- `docs/error-logs-phase1-audit.md` — added this developer checklist, audit summary and strict UI-only scope lock.

## Modules intentionally not touched

Overview, Listings, Commercial / Industrial, Calendar, Sources, Reports, Generated Reports, Cash Flow Analysis, Report Q&A, Portfolio Reports, Report Requests, Charts, Clients, Client Tracker, CRM Conversations, Portal Messages, Email Copilot, Call Logs, Deal Pipeline, Reminders, Checklists, Agreements, Game Plan, Marketing, User Guide, Token Usage, Automation, Templates, Branding, Integrations, Cloudflare, API Usage, Model Hub, Monitoring, Quality Assurance, Data Import, Depreciation Comps, Activity Logs, Settings, User Management, Finance Portal, Portal Config, Token Audit Log, PDF Import Engine, PDF Import Diagnostics, BC Segment Engine, Reclassify Property and all unrelated dashboard modules.

## Scope lock for later phases

- Error Logs changes must remain UI/UX-only unless a visible containment, responsiveness or accessibility defect is being fixed.
- Do not change API calls, Supabase calls, database schemas, error ingestion, severity classification, trend calculation, KPI calculation, retry logic, view/detail logic, search/filter behaviour, route logic, authentication logic or permission logic.
- Do not add mock errors, fake reports, fake warnings, fake retry results, fake healthy states or artificial trend values.
- Do not hide zero values, warnings, empty states, API errors, failed operations or stuck-processing records.
- Do not imply an issue is resolved unless existing data confirms it.
- Keep all long labels, codes, addresses, report names, metadata and action controls contained with token-aware responsive styling in later UI phases.
