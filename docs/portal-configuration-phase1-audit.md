# Portal Configuration Phase 1 Audit, Component Mapping and Scope Lock

## Phase 1 status

Phase 1 is complete. The theme foundation and current Portal Configuration implementation were inspected before any UI edits were attempted. This document locks the enhancement scope to the Portal Configuration UI and records the current workflows, data ownership, integration points, and risks that must be preserved through later phases.

## Theme foundation source of truth

Inspected `docs/dashboard-theme-foundation.md` first. The Portal Configuration uplift must use the existing dashboard token system rather than disconnected one-off styling.

Key implementation constraints absorbed for later phases:

- Start redesigned dashboard surfaces from shared dashboard theme concepts such as page, hero, section, sectionAccent, card, premiumCard, chartCard, and toolbar where the implementation supports them.
- Preserve shadcn primitives and compose around their APIs instead of replacing component behaviour.
- Prefer theme-compatible tokens and variables such as `bg-card`, `text-foreground`, `text-primary`, `border-border`, `bg-background`, `text-muted-foreground`, `hsl(var(--token-name))`, `--dashboard-surface`, `--surface-1`, `--topbar-background`, and related dashboard variables.
- Avoid hardcoded colours where tokens already exist.
- Validate light mode, dark mode, mobile, desktop, hover states, focus states, forms, and dashboard layout as part of later phases.
- Include the `Global Theme Foundation / Cascading UI Subcomponent` step in the implementation plan before adding page-local styling.

## Route, shell and access mapping

- Primary route: `/portal-config`.
- Route owner: `src/App.tsx` mounts `PortalConfig` inside `ModuleGuard moduleKey="portal_config"`.
- Sidebar entries: `src/components/layout/DashboardSidebar.tsx` and `src/components/layout/MobileSidebar.tsx` both expose `Portal Config` with `moduleKey: 'portal_config'`.
- Page component owner: `src/pages/PortalConfig.tsx`.
- Token low-balance banner owner: `src/components/billing/TokenBalanceBanner.tsx`, mounted outside this page by the dashboard shell. The banner text and Top up action must not be changed by Portal Configuration UI work.

## Current Portal Configuration implementation map

### Data loading and persistence

- `useQuery` reads the first row from Supabase table `portal_configuration` through `@/integrations/supabase/client`.
- The query key is `['portal-configuration']`.
- `DEFAULT_CONFIG` supplies fallback UI values when no row exists after loading.
- GHL calendar options are loaded by `useGHLCalendar()` and `fetchCalendarData()`.
- `updateConfig` merges partial updates into local state and sets `hasChanges` to `true`.
- `saveMutation` upserts the current config via `invokeSecureFunction('manage-client-data', { operation: 'upsert', table: 'portal_configuration', data })`.
- Save success clears `hasChanges`, displays `Portal configuration saved`, and invalidates `['portal-configuration']`.
- Save failure displays the existing error toast message.
- Phase 1 and later UI phases must not change query keys, Supabase reads, secure function payloads, save mutation lifecycle, GHL fetching, auth guards, or permission logic.

### Page shell and save actions

- Loading state renders a centered `Loader2` spinner.
- Header contains the `Settings` icon, `Portal Configuration` title, subtitle `Manage your client portal settings, modules, and booking configuration`, and primary `Save Changes` button.
- `Save Changes` calls `saveMutation.mutate()` and is disabled when there are no unsaved changes or when save is pending.
- The save button swaps the `Save` icon for a spinning `Loader2` while pending.
- A floating save bar appears when `hasChanges` is true, displays `You have unsaved changes`, and offers a smaller `Save` button with the same pending protection.
- Later phases may improve visual hierarchy and containment only; they must preserve all state conditions and handlers.

### Internal tabs

- `Tabs` uses `defaultValue="modules"` and existing shadcn tab-switching logic.
- Tab order and labels are:
  1. `Modules` with `Eye` icon.
  2. `Welcome` with `Type` icon.
  3. `Booking` with `CalendarDays` icon.
  4. `Access` with `Shield` icon.
- Later phases must not rename, reorder, remove, or rewire tab values.

### Modules tab

- Section title: `Portal Modules`.
- Description: `Enable or disable specific sections of the client portal`.
- Module rows are rendered from `MODULE_ITEMS`.
- Current module rows are `Dashboard`, `My Profile`, `Deal Progress`, `Properties`, `Property Insights`, `Finances`, `Documents`, `Reports`, `Messages`, `Notifications`, and `Book Appointment`.
- Each row preserves an icon, description, checked state from config, and `Switch` `onCheckedChange` through `updateConfig`.
- Inventory note: the requested prompt pack lists ten visible module rows through `Messages and Notifications`; the implementation also contains `Book Appointment` as a module toggle tied to `module_booking`. Later phases must preserve existing implementation data and avoid deleting or inventing modules.

### Welcome tab

- Section title: `Welcome Message`.
- Description: `Customise the welcome text shown on the portal dashboard`.
- Fields and mappings:
  - `Welcome Title` input maps to `welcome_title`.
  - `Welcome Message` textarea maps to `welcome_message`.
  - `Banner Image URL (optional)` input maps to `welcome_banner_url`, storing `null` when empty.
  - `Portal Footer Text` input maps to `portal_footer_text`.
- Default values include `Welcome to your Client Portal`, the client portal access copy, and `Secured Portal • End-to-end encrypted`.
- Later UI work must not alter labels, values, placeholders, null handling, or save mapping.

### Booking tab

- Section title: `Booking Configuration`.
- Description: `Configure the appointment booking system for the client portal`.
- `Enable Booking Module` switch maps to `module_booking`.
- Booking details render only when `config.module_booking` is true.
- `Available Calendars for Clients` contains helper text about adding GHL calendars clients can choose from.
- Existing calendar rows render `booking_calendars` with calendar icon, name, optional description, monospaced ID, editable client-facing label field, and destructive delete icon button.
- Delete removes the selected row from local `booking_calendars` through `updateConfig`.
- Add-calendar selector filters out already-used calendar IDs from `calendars` loaded by `useGHLCalendar`.
- Empty/all-used state displays `All available GHL calendars have been added.` when all available calendars are used.
- Booking rules and notification fields currently present:
  - `Slot Duration (minutes)` select values: 15, 30, 45, 60, 90.
  - `Minimum Lead Time (hours)` number input with min 0 and max 168.
  - `Max Advance Booking (days)` number input with min 1 and max 90.
  - `Email Notifications`, `Send Client Confirmation`, `Team Notification Email`, and `Booking Introduction Text`.
- Inventory note: the prompt pack references visible calendar rows such as `Discoverry Call` and `Strategy Session (Phone)` as data values, not hardcoded UI constants. Later phases must preserve whatever rows come from existing config/GHL data.

### Access tab

- Section title: `Access Level Defaults`.
- Description: `Set the default permissions for new client portal users`.
- `Default Access Level for New Users` select maps to `default_access_level`.
- Select options preserve values and displayed copy:
  - `read_only` / `Read Only` / `View data but cannot edit`.
  - `limited_edit` / `Limited Edit` / `Edit profile and documents only`.
  - `full_edit` / `Full Edit` / `Edit all available sections`.
- Access Level Guide entries preserve the current Read Only, Limited, and Full Edit descriptions.
- Later phases may improve badges and matrix presentation only; access values and meanings must not change.

## Files intentionally in scope for future UI phases

- `src/pages/PortalConfig.tsx` — primary Portal Configuration UI component and the only expected implementation file for the premium uplift unless a small shared styling helper is demonstrably necessary.
- `docs/portal-configuration-phase1-audit.md` — this Phase 1 scope-lock and mapping document.

## Files inspected but intentionally not touched in Phase 1

- `docs/dashboard-theme-foundation.md` — source of truth for dashboard styling tokens and theme compatibility.
- `src/App.tsx` — route and module guard mapping; must remain unchanged.
- `src/components/layout/DashboardSidebar.tsx` — desktop navigation entry; must remain unchanged.
- `src/components/layout/MobileSidebar.tsx` — mobile navigation entry; must remain unchanged.
- `src/components/billing/TokenBalanceBanner.tsx` — token low-balance banner and Top up behaviour; must remain unchanged.
- `src/hooks/useGHLCalendar.ts` — GHL calendar data loading; must remain unchanged.
- `src/hooks/useModulePermissions.ts` — portal permission hook; must remain unchanged.
- `src/lib/secureInvoke.ts` — secure function invocation path; must remain unchanged.
- `src/integrations/supabase/client.ts` and generated Supabase types — database integration; must remain unchanged.
- `supabase/**` — migrations, edge functions, and backend logic; must remain unchanged.

## Explicit scope lock

Later phases are UI-only and limited to premium visual/interaction polish for the Portal Configuration page. The following must not be changed:

- Route definitions, sidebar grouping, module guards, authentication, authorization, or permissions.
- Supabase table names, query keys, generated types, secure function names, payload shapes, or save behaviour.
- GHL calendar fetch logic, calendar mapping, calendar delete logic, dropdown options, booking calculations, slot duration, lead time, max advance booking, notification settings, or module visibility logic.
- Tab labels, tab order, tab values, button labels, field labels, dropdown labels, module names, access level values, guide copy meanings, or default values.
- Validation, loading, disabled, empty, success, error, and unsaved-change state conditions.
- Unrelated dashboard modules, pages, routes, sidebars, backend functions, database schemas, or global theme foundations unless explicitly required by a later prompt.

## UI risks to resolve in later phases

- The current tab bar is flat and relies on default grid treatment, so active tab hierarchy can feel weak in both themes.
- The page header and `Save Changes` button can feel ambiguous because the primary action is visually close to default button styling and may wrap poorly on smaller widths.
- Module rows have minimal depth and may not communicate enabled/inactive hierarchy strongly enough.
- Long descriptions, welcome content, banner URLs, footer text, calendar IDs, and client labels need safer wrapping or truncation.
- Calendar rows are cramped because icon, metadata, editable label input, and delete action compete in one horizontal row.
- Light mode currently depends heavily on default surfaces and needs a more deliberate commercial-grade card/form treatment.
- Disabled, loading, focus, hover, and destructive states are present but subtle and need a more accessible visual pass.
- The floating unsaved-change save bar must remain contained and avoid colliding with dashboard content on smaller screens.

## Phase 1 conclusion

The Portal Configuration route, shell, tabs, workflows, fields, controls, integration points, and UI risks are mapped. The next implementation phase can safely begin from `src/pages/PortalConfig.tsx` using `docs/dashboard-theme-foundation.md` tokens while preserving all existing portal, booking, save, Supabase, GHL, route, auth, and permission logic.
