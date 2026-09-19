# Marketing Analytics Phase 1 Audit

## Scope lock

Phase 1 is an audit and implementation-mapping checkpoint for the Marketing Analytics page only. Subsequent UI work must stay limited to `src/pages/MarketingAnalytics.tsx` and Marketing child components under `src/components/marketing/` unless a shared, token-based UI primitive is already used by the dashboard and the change is presentation-only.

Unrelated dashboard modules, sidebar grouping, routes, backend functions, Supabase migrations, authentication, permissions, report scheduling, AI prompts, date calculations, chart calculations, and marketing integration logic are out of scope.

## Theme foundation inspected

`docs/dashboard-theme-foundation.md` was located and inspected. The source of truth directs redesign work to use global CSS variables, Tailwind token classes, and `DashboardThemeFrame` variants rather than page-local hard-coded colours. Key available theme anchors are:

- Background/text tokens: `--background`, `--foreground`, `bg-background`, `text-foreground`.
- Surface tokens: `--card`, `--dashboard-surface`, `--surface-1`, `--topbar-background`, `--sidebar-surface`, `bg-card`.
- Accent and control tokens: `--primary`, `text-primary`, existing shadcn button/card/tab primitives.
- Border/muted tokens: `--border`, `border-border`, `--muted`, `text-muted-foreground`.
- Preferred wrapper variants: `DashboardThemeFrame` `page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, and `toolbar`.

Phase 2+ should use those tokens/classes first, preserving whitelabel and dark/light mode compatibility. A fallback developer note is not required because the theme file exists.

## Current route and top-level implementation

- Primary page: `src/pages/MarketingAnalytics.tsx`.
- Main permission hook: `useModulePermissions('marketing_analytics')`; `canEditMarketing` is currently read at page level and must not be reinterpreted during UI phases.
- Primary platform tabs: `meta`, `manychat`, `lead-magnets`; visible labels remain Meta Ads, ManyChat, Lead Magnets.
- Primary date presets: Today, Yesterday, Last 7 Days, Last 14 Days, Last 30 Days, This Month, Last Month, Last 90 Days plus Custom Range via `DateRangePicker`.
- Primary Meta KPI cards: Total Spend, Impressions, Clicks, CTR, Leads, Cost / Lead.
- Cross-channel summary cards: Active Channels, Ad Spend, Total Leads, Cost / Lead.

## Marketing page component map

Top-level Meta Ads composition in `MarketingAnalytics.tsx`:

1. Header/title block with icon, title, subtitle.
2. Cross-channel summary cards.
3. Primary platform tabs.
4. Meta Refresh action.
5. `DateRangePicker`.
6. Summary badges for row count, critical alerts, warnings, average health.
7. Top KPI cards rendered through local `KPICard`.
8. `AIDigestPanel`.
9. `AnomalyAlertsPanel` and `CampaignHealthPanel`.
10. `BudgetAdvisorPanel`.
11. `SpendPacingPanel`.
12. `LeadAttributionPanel`.
13. `CreativeGalleryPanel`.
14. `FullFunnelPanel`.
15. `TrueROIPanel`.
16. `AudienceIntelligencePanel` and `LeadQualityPanel`.
17. `ForecastPanel`.
18. `WeeklyBriefPanel`.
19. `PeriodOverPeriodPanel`.
20. Performance Explorer controls: Account, Campaigns, Ad Sets, Ads, Compare.
21. `DrillDownExplorer`.
22. Conditional `ComparisonPanel`.
23. `BenchmarksPanel`.
24. `MarketCorrelationPanel`.
25. `ReportDistributionPanel`.
26. ManyChat content through `ManyChatPanel`.
27. Lead Magnets content through `LeadMagnetsPanel`.

Marketing child components discovered in scope:

- `AIDigestPanel.tsx`
- `AnomalyAlertsPanel.tsx`
- `AudienceIntelligencePanel.tsx`
- `BenchmarksPanel.tsx`
- `BudgetAdvisorPanel.tsx`
- `CampaignHealthPanel.tsx`
- `ComparisonPanel.tsx`
- `CreativeGalleryPanel.tsx`
- `DateRangePicker.tsx`
- `DrillDownExplorer.tsx`
- `EnhancedResearchRenderer.tsx`
- `ForecastPanel.tsx`
- `FullFunnelPanel.tsx`
- `LeadAttributionPanel.tsx`
- `LeadMagnetsPanel.tsx`
- `LeadQualityPanel.tsx`
- `ManyChatPanel.tsx`
- `MarketCorrelationPanel.tsx`
- `MarketIntelligenceExportButton.tsx`
- `MarketIntelligenceHistoryModal.tsx`
- `MarketIntelligencePDFGenerator.ts`
- `PeriodOverPeriodPanel.tsx`
- `ReportDistributionPanel.tsx`
- `SpendPacingPanel.tsx`
- `TrueROIPanel.tsx`
- `WeeklyBriefPanel.tsx`

## Data, integration, and workflow dependency map

Do not alter the following dependencies or payload semantics during UI phases:

- `fetch-meta-ads`: Meta Ads insights/campaign retrieval with `level`, date preset or custom range, limit, selected campaign, and selected ad set.
- `analyze-meta-ads`: AI digest, anomalies, health scores, and summary values.
- `analyze-meta-ads-phase2`: budget advisor and lead quality analysis.
- `analyze-meta-ads-phase3`: forecast, weekly brief generation, and past brief listing.
- `analyze-meta-ads-phase4`: benchmarks and market correlation.
- `analyze-meta-ads-phase5`: True ROI / CPA data.
- `manychat-proxy`: ManyChat overview, flows, fields, tags, subscriber lookup, and refresh workflow.
- Marketing report/export/history functions and Supabase reads used by report distribution, market intelligence export, and history modals.
- CRM/GHL attribution and funnel data accessed inside attribution, full-funnel, lead-quality, and ROI panels.

## State and interaction map to preserve

- `activeChannel`, `datePreset`, `customRange`, `level`, selected campaign/adset IDs, breadcrumbs, comparison mode, selected comparison IDs, digest regeneration state, weekly brief generation state, current brief, and current brief error.
- Refresh, Regenerate, Generate Brief, History, Compare, drill-down, breadcrumb navigation, report schedule actions, enrichment/refresh/refetch actions, ManyChat refresh/sync/subscriber actions, Lead Magnet actions, dialogs, modals, and downloads.
- Loading, empty, and error states must remain triggered by the same data/query conditions and messages must not be suppressed.

## UI files/components safe to touch in later phases

Presentation-only changes may be made to:

- `src/pages/MarketingAnalytics.tsx`
- `src/components/marketing/*.tsx` where the change is styling, layout, containment, accessibility, or state presentation only.
- Marketing-only CSS/class extraction if introduced without changing data or behavior.

## Logic/integration files to avoid

Avoid changes to:

- `supabase/functions/**`
- `supabase/migrations/**`
- `src/integrations/**`
- `src/lib/secureInvoke.ts`
- authentication, permissions, route definitions, sidebar modules, global data schemas, and unrelated dashboard pages.
- Marketing calculations, query keys, payload fields, function names, AI prompt inputs, report schedule persistence, and date preset/custom range logic.

## Phase 2 implementation checklist

- Use `docs/dashboard-theme-foundation.md` tokens and existing dashboard primitives before adding local classes.
- Keep all Marketing page labels, tab order, date labels, KPI labels, values, icons, click handlers, and query calls intact.
- Confine changes to page shell, token/warning/header area if present, platform switcher, date toolbar, summary cards, and KPI card presentation.
- Add containment classes such as `min-w-0`, safe wrapping, controlled overflow, and truncation only at presentation boundaries.
- Do not add mock data or hide zero, empty, loading, or error states.
