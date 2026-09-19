# User Guide Phase 1 Audit — Theme, Scope, and Information Architecture

## Scope confirmation

This Phase 1 implementation note is scoped to the existing User Guide page/tab only. The current User Guide implementation lives in `src/pages/UserGuide.tsx`, with the floating/navigational assistant component imported from `src/components/user-guide/UserGuideAssistant.tsx`. No unrelated dashboard modules, routes, API calls, Supabase calls, permissions, sidebar grouping, or backend logic are changed in this phase.

## Global Theme Foundation / Cascading UI Subcomponent

`docs/dashboard-theme-foundation.md` was located and inspected before User Guide changes. It establishes the dashboard theme foundation as global CSS variables and Tailwind token classes rather than isolated page-local colour systems.

Key theme anchors identified for future User Guide polish:

- Page and base text: `--background`, `--foreground`, `bg-background`, `text-foreground`.
- Card and elevated surfaces: `--card`, `--card-foreground`, `--dashboard-surface`, `--dashboard-surface-elevated`, `--surface-1`, `bg-card`, `text-card-foreground`.
- Muted/passive surfaces and secondary text: `--muted`, `--muted-foreground`, `--dashboard-surface-muted`, `text-muted-foreground`, `bg-muted`.
- Borders and dividers: `--border`, `border-border`, existing shadcn `Card`, `Separator`, and `Accordion` composition.
- Primary/gold accent system: `--primary`, `text-primary`, `bg-primary`, `bg-primary/10`, `border-primary/20`, plus existing amber/gold usage where semantically meaningful for tips and premium accents.
- Semantic colours already present on the guide: green/success for check markers and Active status, yellow/warning for Pending status, blue/informational for Sold/status guide emphasis, red/destructive for Expired status, and gray/neutral for Withdrawn status.
- Buttons, badges, accordion controls, hover states, focus states, border radii, and shadows should continue to come from shadcn primitives, Tailwind token utilities, and `DashboardThemeFrame` variants before adding page-local styling.
- Scrollbar styling should follow existing dashboard patterns such as `scrollbar-thin`, Radix `ScrollArea`, and tokenized scrollbar colour utilities where scrolling is required.
- Future visual implementation should first evaluate `DashboardThemeFrame` variants: `page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, and `toolbar`.

Dark and light mode support is confirmed through tokenized classes and CSS variables. Future visual polish must avoid hard-coded one-off colours when an existing token or dashboard variable covers the same role.

## Current User Guide implementation inventory

### Page shell and assistant

- `UserGuide` is the default exported page component.
- `UserGuideAssistant` is rendered before the main guide content and receives `onNavigateToSection`.
- The page currently uses shadcn `Card`, `Badge`, `Separator`, and `Accordion` primitives.
- `handleNavigateToSection(sectionId)` scrolls to `section-${sectionId}` if present, updates `accordionRef.current`, and clicks a closed accordion trigger when found.
- No loading, empty, error, API, Supabase, or explicit permission logic is present in `src/pages/UserGuide.tsx`.
- No search/filter UI is present in the page component itself; the only search-related guide content is preserved as documentation text and quick tips.
- No route definitions are declared in this file.

### Header

The page title and subtitle are preserved as:

- `User Guide`
- `Complete guide to navigating and using your dashboard`

### Quick Tips

The `quickTips` array contains exactly six items, in this order:

1. `Use ⌘/Ctrl + K to quickly search across the application`
2. `Combine multiple filters for precise property and client searches`
3. `Download reports in PDF format for offline viewing and sharing`
4. `Click on any property card to view detailed information and generate reports`
5. `Use the Overview dashboard for a quick snapshot of portfolio performance`
6. `Ask the Report Q&A AI natural language questions about your properties`

The Quick Tips panel uses a `CheckCircle` title icon, a two-column responsive grid, tokenized muted card rows, primary-coloured quick-tip icons, and small text labels.

### Property Status Guide

The `statusGuide` array contains exactly five status items, in this order:

1. `Active` — `Property is currently listed and available` — `bg-green-500`
2. `Pending` — `Property has an offer pending or under contract` — `bg-yellow-500`
3. `Sold` — `Property has been successfully sold` — `bg-blue-500`
4. `Withdrawn` — `Property has been removed from the market` — `bg-gray-500`
5. `Expired` — `Listing has expired and needs renewal` — `bg-red-500`

The Property Status Guide panel uses a status dot, outline badge, and muted description text for each item.

### Feature Documentation accordion

The `sections` array is the complete documentation tree. Existing accordion behavior is multiple-open via `<Accordion type="multiple">`. No default open values are declared in the page component, so future work must be careful if implementing the requested opened/collapsed visual state; it should not reorder or rewrite section content.

Current top-level documentation categories are preserved in this exact order:

1. Getting Started
2. Client Management
3. Email Copilot
4. Report Q&A (AI Chat)
5. Property Management
6. Cash Flow Analysis
7. Borrowing Capacity
8. Call Logs
9. Automation
10. Reports & Analytics
11. Data Import
12. Template Management
13. Data Sources
14. Integrations
15. Depreciation Comps
16. Settings
17. Branding (White Label)
18. Calendar & Scheduling
19. Monitoring & Logs
20. Administration
21. Deal Pipeline
22. Agency Agreements
23. Checklists
24. Marketing Analytics
25. Reminders Hub
26. Report Requests
27. Client Portal
28. AI Agent
29. Notifications
30. API Usage & Costs
31. Keyboard Shortcuts
32. Troubleshooting

### Opened Getting Started and Client Management content

Getting Started currently contains:

- Dashboard Overview
- Navigation & Sidebar

Client Management currently contains:

- Client Tracker
- Client Details & Financials
- Client Notes & Reminders
- Client Tags & Segmentation
- Portfolio Analysis Reports

These item titles, descriptions, features, steps, tips, and shortcut structures must remain unchanged.

### Collapsed documentation categories

All other categories listed in the complete documentation tree above are present in `sections` and must remain available to the accordion without being removed, hidden, renamed, or reordered.

### Need Help panel

The Need Help panel contains the preserved intro and checklist items:

- `If you need additional assistance or encounter any issues:`
- `Check the Settings page for configuration options`
- `Use the Report Q&A AI to ask questions about features`
- `Review Error Logs for troubleshooting system issues`
- `Contact your system administrator for technical support`

## Preservation note before visual implementation

The full current User Guide documentation tree, Quick Tips, Property Status Guide, Feature Documentation accordion structure, Getting Started content, Client Management content, all remaining documentation categories, Need Help items, and existing local navigation handler have been identified and preserved for Phase 1. Future UI/UX polish should be additive and token-based, with viewport-safe layout improvements such as `min-w-0`, safe wrapping, non-overlapping accordion headers, and contained scrolling where needed, without changing the underlying content or behaviour.
