# Automation Tab Phase 1 Audit — Scope, Theme Foundation, Component and Logic Mapping

## Theme foundation inspected

- Source of truth found at `docs/dashboard-theme-foundation.md`.
- The foundation directs dashboard UI work to prefer global CSS variables, Tailwind token classes, and `DashboardThemeFrame` variants before adding local styling.
- Primary reusable variants available for future phases are `page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, and `toolbar`.
- Theme-compatible token families identified for the Automation Tab:
  - Base and text: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`.
  - Brand/gold: `--primary`, `--primary-foreground`, `--primary-hover`, `--dashboard-primary-soft`, `--dashboard-primary-strong`.
  - Surfaces: `--dashboard-surface`, `--dashboard-surface-elevated`, `--dashboard-surface-muted`, `--surface-1`, `--surface-2`, `--surface-3`, `--surface-elevated`, `--surface-muted`.
  - Borders and focus: `--border`, `--input`, `--ring`, `--dashboard-border-soft`, `--dashboard-border-strong`, `--border-soft`, `--border-strong`.
  - State colours: `--success`, `--success-light`, `--warning`, `--warning-light`, `--destructive`, `--destructive-light`, `--info`, `--info-light`.
  - Muted/neutral: `--muted`, `--muted-foreground`, `--secondary`, `--secondary-foreground`.
  - Layout shell: `--topbar-background`, `--sidebar-surface`, `--mobile-nav-background`, sidebar token group.
- Light mode token defaults provide white/off-white cards, warm muted surfaces, gold primary accents, readable dark foreground text, and soft borders.
- Dark mode token defaults provide black/charcoal backgrounds, dark elevated surfaces, gold primary accents, muted grey text, and stronger dark borders.
- Existing scrollbar precedent uses tokenized `scrollbar-color`, `scrollbar-width`, and Radix ScrollArea thumb styling in previously enhanced dashboard pages.

## Automation route and Administration shell mapping

- Automation renders from `src/pages/Automation.tsx`.
- The route is `path="automation"` under the protected dashboard layout and is wrapped in `ModuleGuard moduleKey="automation"`.
- Administration sidebar grouping includes `Automation` under the Administration section, and the sidebar item maps `Automation` to `/automation` with the `Zap` icon and `moduleKey: 'automation'`.
- No route, sidebar, module key, or Administration grouping changes are needed for Phase 1.

## Automation page component inventory

- Header:
  - Title: `Auto-Generation Switchbot`.
  - Subtitle: `Configure automated investment report generation for incoming listings`.
  - `View Log` button opens the generation log modal by setting `logModalOpen`.
- Airtable Sync card:
  - Title: `Airtable Sync`.
  - Description: `Sync new listings from Airtable and auto-generate reports based on your switch criteria.`
  - Existing controls: `Clear Queue`, `Dry Run`, `Sync Now`.
  - Existing stats badges: processed count, generated report count, and optional last sync date.
- Clear Queue workflow:
  - Uses `AlertDialog` confirmation before calling `clearQueue`.
  - Calls `manage-automation-settings` with `operation: 'clearStuckReports'` through `invokeSecureFunction`.
  - Emits success/error toasts, refreshes sync stats, and logs a `report_deleted` activity record.
- Dry Run / Sync Now workflow:
  - Both call `runSync`; Dry Run passes `true`, Sync Now passes `false`.
  - Both call `auto-report-sync` through `invokeSecureFunction` with `{ maxRecords: 50, dryRun }`.
  - Dry Run only reports how many listings would be processed via toast.
  - Live sync reports generated count via toast and refreshes sync stats.
  - Both preserve existing disabled state tied to `syncing || !masterEnabled`.
- Master Switch card:
  - Title: `Master Switch`.
  - OFF status text: `All auto-generation is currently disabled`.
  - ON status text dynamically reports enabled switch count.
  - Toggle calls `toggleMaster`, which invokes `manage-automation-settings` with `operation: 'updateMasterSettings'`.
  - Toggle success logs `automation_master_toggle_changed`.
  - Warning message appears only when master is off while one or more switches are enabled.
- Filter Switches workspace:
  - Heading: `Filter Switches`.
  - Header `Create Switch` button appears only when `canEdit` permits it.
  - Loading state text: `Loading switches...`.
  - Empty state preserves icon, `No switches configured`, helper text, and optional empty-state `Create Switch` button.
  - Switch cards render one card per fetched switch with enable toggle, name, criteria count, Active/Paused badge, optional description, edit button, and delete button.
- Switch management:
  - Create/Edit modal is `src/components/automation/SwitchConfigModal.tsx`.
  - Modal fields include switch name, description, priority, property types, price range, bedrooms, bathrooms, states, categories, confidence score, price requirement, and source hosts.
  - Create inserts directly into `auto_report_switches` through Supabase and defaults `is_enabled` to `false`.
  - Edit updates `name`, `description`, `priority`, and `criteria` directly through Supabase.
  - Create logs `automation_switch_created`.
  - Conflict notice is UI-only and computed from existing enabled switches.
- Delete workflow:
  - Uses browser `confirm` before invoking `manage-automation-settings` with `operation: 'deleteSwitch'`.
  - On success removes the switch locally, shows a toast, and logs `automation_switch_deleted`.
- View Log workflow:
  - Log modal is `src/components/automation/GenerationLogModal.tsx`.
  - Fetches up to 100 records from Supabase table `auto_report_generation_log`, ordered by `created_at` descending.
  - Renders loading, empty, and table states.
  - Status badge mapping currently covers `completed`, `failed`, `pending`, `processing`, and a default status fallback.

## Existing data flows and logic calls

- Permissions:
  - `useModulePermissions('automation')` provides `canEdit` and `canDelete` for Create/Edit/toggle/delete UI availability.
  - Route-level access is guarded by `ModuleGuard moduleKey="automation"`.
- Secure function calls:
  - `manage-automation-settings` operations: `getSyncStats`, `clearStuckReports`, `getMasterSettings`, `getSwitches`, `updateMasterSettings`, `updateSwitch`, `deleteSwitch`.
  - `auto-report-sync` operation: called with `maxRecords: 50` and the `dryRun` flag.
- Direct Supabase calls:
  - `SwitchConfigModal` writes to `auto_report_switches` for create/edit.
  - `GenerationLogModal` reads from `auto_report_generation_log`.
- Activity/audit calls:
  - `logActivityDirect` records master toggle changes, switch create/enable/disable/delete events, and clear queue activity.
- State management:
  - Page state includes master enabled/loading, switch list/loading, config modal open, log modal open, editing switch, syncing, clearing, and sync stats.
  - No separate persistent client-side store was identified for Automation.

## UI-level risks to address in later phases

- Visual hierarchy is functional but comparatively flat: the page header, Airtable Sync card, Master Switch, and Filter Switches workspace do not yet use the shared premium dashboard frame patterns.
- Current Airtable Sync styling relies on direct blue utility classes; later phases should keep blue/purple only as an integration accent and move as much surface/border/foreground styling as possible to dashboard tokens.
- Clear Queue is safely confirmed, but its visual treatment can be made cautionary/destructive without becoming the dominant action.
- Dry Run and Sync Now share the same `syncing` state and card region, so visual differentiation should be improved without changing the existing function call semantics.
- Master Switch state is accurate, but the OFF/ON presentation and warning hierarchy can be made clearer and safer.
- Switch cards do not expose criteria details beyond criteria count and description, so any later criteria readability improvements must avoid changing criteria data, ordering, or logic.
- Log modal has basic horizontal scrolling and truncation; long addresses, errors, IDs, or switch names may need more robust containment in later UI phases.
- Modal containment exists (`max-h` plus `ScrollArea`), but future form grouping should preserve field names, validation, save logic, and Supabase write contracts.
- Light mode is mostly token-supported through shadcn primitives, but several direct green/blue/amber utility classes should be reviewed for contrast and theme consistency in later phases.

## Phase 1 preservation confirmation

- Phase 1 made documentation-only changes in this audit note.
- No Automation Tab logic, integration logic, data-fetching logic, Supabase/API calls, permissions, authentication, route definitions, business rules, labels, titles, status values, empty-state conditions, loading conditions, or error conditions were changed.
- No unrelated dashboard modules were modified.
