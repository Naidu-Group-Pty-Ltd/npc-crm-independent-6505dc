# Model Hub Phase 1 Implementation Map

Date: 2026-06-29
Scope: Phase 1 theme audit, implementation mapping, and scope lock for the Model Hub tab only.

## Theme source inspected

- `docs/dashboard-theme-foundation.md` was inspected before UI implementation work.
- The foundation directs redesigned dashboard pages to use global CSS variables, Tailwind token classes, and `DashboardThemeFrame` variants instead of isolated one-off colour systems.
- Relevant shared frame variants for later phases: `page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, and `toolbar`.

## Theme tokens and classes to use in later phases

- Page/background: `bg-background`, `text-foreground`, `--background`, `--foreground`, `--dashboard-surface`, `--surface-1`.
- Card/elevated panels: `bg-card`, `text-card-foreground`, `--card`, `--card-foreground`, `--dashboard-surface-elevated`, `--surface-2`, `--surface-elevated`.
- Muted panels and passive metadata: `bg-muted`, `text-muted-foreground`, `--muted`, `--muted-foreground`, `--dashboard-surface-muted`, `--surface-3`, `--surface-muted`.
- Borders and inputs: `border-border`, `--border`, `--input`, `--dashboard-border-soft`, `--dashboard-border-strong`, `--border-soft`, `--border-strong`.
- Gold/brand accents: `text-primary`, `bg-primary`, `border-primary`, `--primary`, `--primary-foreground`, `--primary-hover`, `--accent`, `--dashboard-primary-soft`, `--dashboard-primary-strong`.
- Status colours: `--success`, `--success-light`, `--warning`, `--warning-light`, `--destructive`, `--destructive-light`, `--info`, `--info-light` with existing Tailwind state classes where components already use emerald/amber/rose/sky variants.
- Focus rings: `focus-visible:ring-ring`, `focus-visible:ring-offset-background`, `--ring`.
- Radius/shadows: use shadcn defaults based on `--radius` and `DashboardThemeFrame` shadows before adding page-local shadows.
- Scrollbars: prefer existing `scrollbar-thin`, `scrollbar-hide`, Radix `ScrollArea`, and dashboard token scroll styling already defined in `src/index.css`.

## Current Model Hub implementation map

Primary file: `src/pages/ModelHub.tsx`.

### Component and data structures

- Route and status unions: `Route = 'gateway' | 'native' | 'openrouter'`, `Status = 'available' | 'preview' | 'deprecated' | 'unavailable'`.
- Data contracts in the UI: `CatalogModel`, `ProviderResult`, `AvailabilityResponse`, and `AgentAssignment`.
- Provider presentation metadata: `PROVIDER_BRAND` maps provider IDs to display names, colour classes, and Docs URLs.
- Capability metadata: `capabilityIcon` maps model capability names to existing lucide icons.
- Status badge helper: `statusBadge(status)` returns current status-specific badge classes.

### Visible components

- `ModelHub`: page shell, title/subtitle, Reload button, Live re-probe button, KPI cards, internal tabs, tab content, and latest probe timestamp.
- `AgentBindings`: loads and renders grouped agent assignments, dynamic routing callout, grouped route/model table, route dropdowns, model selectors, upgrade pills, last-used values, last errors, and test buttons.
- `ProviderHeader`: provider row header, status badge, optional provider error summary, and Docs link.
- `ProviderModels`: provider model list/empty state wrapper.
- `ModelCard`: model display card with display name, model ID, status badge, capability pills, context window, and pricing text.
- `OpenRouterCatalog`: OpenRouter not-configured state, configured catalogue alert, search input, family selector, shown count, model grid, and display cap message.

### Current tabs

- Agent Bindings (`bindings`): `AgentBindings` with catalog from `data?.models`.
- Gateway (`gateway`): Lovable Gateway alert, provider sections from `providersByRoute('gateway')`, provider headers, and gateway model lists.
- Native (`native`): direct provider keys alert, provider sections for OpenAI, Anthropic, Gemini, and Perplexity, provider headers, and native model lists.
- OpenRouter (`openrouter`): `OpenRouterCatalog` using `data?.models`.

### State and hooks

- `ModelHub` state: `data`, `loading`.
- `ModelHub` fetch function: `fetchAll(force = false)` invokes Supabase edge function `check-model-availability` and updates `data`; force mode preserves existing live-probe toast.
- `ModelHub` derived stats: total/live model count, preview count, deprecated count, provider count.
- `ModelHub` provider filter helper: `providersByRoute(route)`.
- `AgentBindings` state: `assignments`, `loading`, `savingKey`, `testingKey`.
- `AgentBindings` load/update/test functions: all invoke Supabase edge function `manage-agent-models` with existing `list`, `update`, and `test` actions.
- `AgentBindings` derived grouped assignments: grouped by `agent_category`.
- `OpenRouterCatalog` state: `search`, `family`; derived `orModels`, model families, and filtered catalogue.

## Data sources and operational logic that must remain untouched

- Supabase client import and all `supabase.functions.invoke` calls.
- Edge function names: `check-model-availability` and `manage-agent-models`.
- Edge function action values: `list`, `update`, and `test`.
- Route values: `gateway`, `native`, `openrouter`.
- Provider IDs and provider names: OpenAI, Anthropic Claude, Google Gemini, Perplexity, Lovable Gateway, OpenRouter.
- Model IDs, display names, status values, pricing, context window, capabilities, probe errors, and timestamps supplied by existing responses.
- Agent keys, labels, categories, descriptions, fallback chains, last-used timestamps, and last errors supplied by existing responses.
- Upgrade recommendation helpers: `getRecommendedUpgrade` and `isModelDeprecated`.
- Existing toast messages and existing click handlers unless a later accessibility-only wrapper is needed without changing behaviour.
- Authentication, permissions, credential storage, credential masking, API routes, database schema, retry/polling/debounce behaviour, and live probe semantics.

## Files/components safe to touch for UI-only phases

- `src/pages/ModelHub.tsx`: safe for visual class names, layout wrappers, accessible labels, token-aligned state presentation, responsive containment, and local presentational helpers only.
- `docs/model-hub-phase-1-implementation-map.md`: safe developer note for phase handoff/checklist updates.
- Potential optional later usage: `src/components/layout/DashboardThemeFrame.tsx` may be imported and composed by `ModelHub`, but its shared implementation should not be changed for this scoped Model Hub effort unless a purely visual dashboard-wide defect is explicitly discovered.
- Potential optional later usage: existing shadcn UI primitives can be composed as-is; do not change primitive APIs or shared primitive internals for this scope.

## Files intentionally out of scope

- Supabase integration files, edge functions, API route files, database migrations, auth/permission modules, provider configuration modules, and credential handling code.
- Shared routing/model recommendation logic unless only imported as-is.
- Unrelated dashboard pages, sidebar/navigation groups, finance portal pages, reports, CRM, client pages, and global theme files.

## Phase 1 acceptance checkpoint

- Theme foundation inspected: complete.
- Current Model Hub component structure mapped: complete.
- Safe UI-only touch list created: complete.
- Backend/data/security logic changes made: none.
- Presentation changes made in Phase 1: none, apart from this developer note.
