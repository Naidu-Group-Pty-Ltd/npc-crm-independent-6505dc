# Game Plans Phase 1 Audit, Component Mapping, and Scope Lock

## Purpose

This note captures the Phase 1 audit for the Game Plans premium UI enhancement. It is intentionally a documentation-only checkpoint before presentation work begins. No runtime UI, data fetching, route, authentication, permission, Supabase, API, schema, tab, game plan, assigned task, create, update, archive, delete, retry, reset, or click-handler logic is changed in this phase.

## Theme foundation audit

The dashboard theme source of truth was found at `docs/dashboard-theme-foundation.md`.

Relevant theme rules and tokens identified:

- Use global CSS variables and Tailwind token classes rather than page-local one-off colours.
- Prefer existing tokens and classes including `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--dashboard-surface`, `--surface-1`, `--topbar-background`, `--sidebar-surface`, `hsl(var(--token-name))`, `bg-card`, `text-foreground`, `text-primary`, `border-border`, `bg-background`, and `text-muted-foreground`.
- Consider `DashboardThemeFrame` variants (`page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, `toolbar`) before adding page-local styling.
- Preserve shadcn primitive APIs and compose them inside dashboard-frame or token-aligned surfaces.
- Preserve whitelabel theme compatibility by avoiding hardcoded colours where theme tokens already exist.
- Test light mode, dark mode, mobile, desktop, focus states, hover states, forms, charts, and sidebar layout when adopting the shared foundation.

Fallback note: no fallback is required because the theme foundation file exists and was inspected.

## Current Game Plans route and access boundary

- Route: `game-plan` renders `GamePlan` behind `ModuleGuard moduleKey="game_plans"`.
- Sidebar labels and navigation point to `/game-plan` with the `game_plans` module key.
- Page-level permissions inside `GamePlan` use `useModulePermissions('game_plans')` for `canEdit` and `canDelete`.
- Phase 2+ UI changes must not modify the route, `ModuleGuard`, module key, sidebar grouping, sidebar labels, or permission logic.

## Page component map

### `src/pages/GamePlan.tsx`

Responsibilities:

- Loads game plans via `useGamePlans()`.
- Loads assigned tasks via `useAssignedTasks()` to calculate the outstanding badge count.
- Creates plan mutations via `useGamePlanMutations().plans`.
- Tracks local UI state: selected plan id, create dialog visibility, and active tab.
- Uses `useModulePermissions('game_plans')` to gate create and delete affordances.
- Renders `GamePlanDetail` when a selected plan exists.
- Renders the list workspace and assigned tasks workspace through the `Game Plans` and `Assigned Tasks` tabs.
- Opens `CreatePlanDialog` when `canEdit` is true and the current tab is `plans`.

Safe UI-only touch points:

- Page shell spacing, responsive containment, header surface, icon styling, title/subtitle layout, tabs styling, workspace wrappers, and primary action styling.

Do not change:

- `useGamePlans()`, `useAssignedTasks()`, `useGamePlanMutations()`, selected-plan lookup, outstanding task count logic, tab values, tab labels, tab order, `setActiveTab`, `setSelectedPlanId`, create dialog state, permissions, create/delete handlers, or `GamePlanDetail` routing-by-state behavior.

## Child component map

### `src/components/gameplan/GamePlanList.tsx`

Responsibilities:

- Renders loading skeleton cards when `isLoading` is true.
- Renders the empty state when there are no plans.
- Renders a responsive game plan card grid.
- Preserves each plan's `icon`, `name`, `description`, `status`, `color`, `start_date`, `end_date`, and `created_at`.
- Selects a plan through `onSelect(plan.id)` on card click.
- Optionally renders delete action when `onDelete` is provided.

Safe UI-only touch points:

- Grid spacing, card surface treatment, card hover/focus presentation, icon wrapper, metadata presentation, status badge presentation, empty state styling, and loading skeleton styling.

Do not change:

- Props, status values, fallback status handling, date formatting semantics, `onSelect`, `onDelete`, `stopPropagation`, card data, or delete availability behavior.

### `src/components/gameplan/CreatePlanDialog.tsx`

Responsibilities:

- Captures new plan `name`, `description`, `icon`, `color`, `status`, `startDate`, and `endDate`.
- Defaults to icon `🎯`, colour `#6366f1`, and status `planning`.
- Validates that `name.trim()` is present before create.
- Calls `onCreate` with existing field names and date serialization.
- Resets local form state after successful creation.

Safe UI-only touch points:

- Dialog surface, form hierarchy, labels, helper layout if non-functional, field spacing, icon/colour selector presentation, focus styling, and button presentation.

Do not change:

- Fields, labels, defaults, validation condition, status options, data payload keys, date serialization, loading state semantics, reset behavior, or `onCreate` contract.

### `src/components/gameplan/GamePlanDetail.tsx`

Responsibilities:

- Loads phases, milestones, KPIs, notes, and actions for the selected plan.
- Supports plan editing, status update, phase reordering, and phase cloning.
- Computes milestone/action progress and search-filtered phase visibility.
- Renders editable plan header, summary stats, overall progress, timeline, search, empty/no-results states, phase cards, and `AddPhaseDialog`.

Safe UI-only touch points:

- Detail shell, back button styling, editable header presentation, summary cards, progress/timeline containment, search presentation, empty/no-results presentation, and section spacing.

Do not change:

- Data hooks, query keys, progress calculations, search filtering rules, `savePlanEdit`, `cancelPlanEdit`, status-change values, phase reorder logic, clone data-copy logic, toast messages, mutation calls, or `AddPhaseDialog` payload.

### `src/components/gameplan/AddPhaseDialog.tsx`

Responsibilities:

- Captures phase `name`, `description`, `icon`, `color`, `startDate`, and `endDate`.
- Requires non-empty `name.trim()` before create.
- Calls `onCreate` with `plan_id`, `display_order`, and existing phase fields.
- Resets local phase form state after create.

Safe UI-only touch points:

- Dialog surface, form spacing, field hierarchy, icon and colour selector styling, date picker trigger styling, and button presentation.

Do not change:

- Props, validation, defaults, payload keys, `planId`, `nextOrder`, date serialization, or reset semantics.

### `src/components/gameplan/PhaseCard.tsx`

Responsibilities:

- Renders and edits phases, milestones, KPIs, action items, notes, ownership selectors, status controls, clone/reorder actions, delete actions, and rich text note editing.
- Uses `useTeamUsers()` for owner/assignee selection.
- Uses mutation groups passed from `GamePlanDetail`.

Safe UI-only touch points:

- Card surfaces, section headers, row spacing, badges, hover/focus states, forms, menus/popovers, note cards, action rows, and viewport containment.

Do not change:

- Mutation payloads, owner/assignee values, team-user lookup, status maps, CRUD handlers, clone/reorder props, delete handlers, collapsible state logic, or markdown editor behavior.

### `src/components/gameplan/AssignedTasksTab.tsx`

Responsibilities:

- Loads tasks through `useAssignedTasks()`.
- Tracks search, status filter, source filter, and toggling ids.
- Filters tasks by search, status, and source.
- Counts total, pending, overdue, and completed tasks.
- Toggles game plan action completion through `useGamePlanMutations().actions.update`.
- Toggles reminder completion through `invokeSecureFunction('manage-templates')` against `client_reminders`.
- Shows loading, empty/no-results, summary stats, filters, and task rows.

Safe UI-only touch points:

- Execution-board container, summary stat cards, filter toolbar presentation, task card/row surfaces, source/priority/status badge styling, due-date presentation, loading and empty state styling, hover/focus states, and responsive stacking.

Do not change:

- Task query hook, filter state values, filtering rules, counts, toggle behavior, secure function call, mutation payloads, `refetch`, toast messages, status/source/priority mappings, or empty state trigger conditions.

### `src/components/gameplan/TimelineBar.tsx`

Responsibilities:

- Renders phase timeline segments with status-based token classes.
- Receives `phases` and `planColor`; currently only `phases` is used by the component implementation.

Safe UI-only touch points:

- Segment sizing, label wrapping/containment, spacing, and token-aligned visual polish.

Do not change:

- Phase ordering, status lookup semantics, props contract, or data source.

### `src/components/gameplan/RichTextEditor.tsx`

Responsibilities:

- Provides markdown shortcut insertion and preview for note content.
- Restores textarea focus and cursor after formatting insertions.

Safe UI-only touch points:

- Toolbar styling, preview surface styling, textarea presentation, and focus states.

Do not change:

- Formatting tokens, insertion logic, preview parsing logic, focus restoration, or `onChange` behavior.

## Data source and workflow map

### Game plan data

Source hook: `src/hooks/useGamePlans.ts`.

Queries:

- `useGamePlans()` lists `game_plans` ordered by `created_at` descending.
- `useGamePlanPhases(planId)` lists `game_plan_phases` filtered by `plan_id` and ordered by `display_order` ascending.
- `useGamePlanMilestones(phaseIds)` lists `game_plan_milestones`, then filters client-side by phase ids.
- `useGamePlanKPIs(phaseIds)` lists `game_plan_kpis`, then filters client-side by phase ids.
- `useGamePlanNotes(phaseIds)` lists `game_plan_notes`, then filters client-side by phase ids.
- `useGamePlanActions(phaseIds)` lists `game_plan_actions`, then filters client-side by phase ids.

Mutations:

- `useGamePlanMutations()` wraps `insert`, `update`, and `delete` operations through `invokeSecureFunction('manage-templates')`.
- Mutation groups cover `game_plans`, `game_plan_phases`, `game_plan_milestones`, `game_plan_kpis`, `game_plan_notes`, and `game_plan_actions`.
- Query invalidation keys must remain unchanged unless a later functional task explicitly requires it.

Do not touch during UI phases:

- Tables, operation names, query keys, mutation helper, `invokeSecureFunction`, Supabase schema/types, data contracts, status unions, or toast error behavior.

### Assigned task data

Source hook: `src/hooks/useAssignedTasks.ts`.

Behavior:

- Uses `useAuth()` to get the current user id.
- Fetches `game_plan_actions`, `client_reminders`, `game_plans`, and `game_plan_phases` through `invokeSecureFunction('manage-templates')`.
- Builds maps for plan and phase context.
- Includes only game plan actions assigned to the current user.
- Includes reminders whose `assigned_to` array includes the current user.
- Derives status values as `completed`, `overdue`, `in_progress`, or `pending`.
- Sorts overdue first, then due date, then pending/in-progress, then completed.
- Refetches every 60 seconds.

Do not touch during UI phases:

- Authentication dependency, secure function calls, fetched tables, assignment filters, status derivation, sort order, refetch interval, or returned task contract.

## Operational states identified

- Page/list loading: `useGamePlans().isLoading` passed to `GamePlanList`.
- Game plan list empty: `!plans.length` in `GamePlanList`.
- Assigned tasks loading: `useAssignedTasks().isLoading` in `AssignedTasksTab`.
- Assigned tasks empty/no-results: `filtered.length === 0`, with copy based on whether any tasks exist.
- Task toggle loading: `togglingIds` set per task id.
- Detail no phases: `phases.length === 0`.
- Detail search no-results: `visiblePhases.length === 0` after query filtering.
- Create and add-phase submit loading: local `loading` state in each dialog.
- Mutation errors: handled by `useGamePlanMutations()` toast `onError`; task toggle errors show `toast.error('Failed to update task')`; phase clone errors show `toast.error('Failed to clone phase')`.

Preservation rule: future phases may polish these states visually but must not suppress them, alter trigger conditions, add mock data, or remove retry/reset/action pathways where present.

## Safe implementation checklist for Phase 2+

- [ ] Keep all changes scoped to `src/pages/GamePlan.tsx` and `src/components/gameplan/*` unless using an existing shared visual wrapper such as `DashboardThemeFrame` is necessary and already platform-standard.
- [ ] Use `docs/dashboard-theme-foundation.md` tokens and existing dashboard variables/classes before adding local styling.
- [ ] Preserve route `/game-plan`, module key `game_plans`, and `ModuleGuard` configuration.
- [ ] Preserve tab labels, values, order, active-state logic, click handlers, and content mapping.
- [ ] Preserve all game plan and assigned task data contracts and existing status values.
- [ ] Preserve all API/Supabase calls through `invokeSecureFunction('manage-templates')`.
- [ ] Preserve all create, edit, save, update, delete, clone, reorder, assign, toggle, retry/reset, and click-handler behavior.
- [ ] Do not create mock game plans or assigned tasks.
- [ ] Do not hide loading, empty, or error states.
- [ ] Do not touch unrelated dashboard modules, sidebars, backend functions, migrations, Supabase types, or route definitions.
- [ ] Verify light mode, dark mode, desktop, tablet, smaller widths, focus states, hover states, forms, modals/popovers, cards, tabs, and assigned task rows after visual changes.

## Files safe to touch for UI-only Game Plans work

Primary safe files:

- `src/pages/GamePlan.tsx`
- `src/components/gameplan/GamePlanList.tsx`
- `src/components/gameplan/CreatePlanDialog.tsx`
- `src/components/gameplan/GamePlanDetail.tsx`
- `src/components/gameplan/AddPhaseDialog.tsx`
- `src/components/gameplan/PhaseCard.tsx`
- `src/components/gameplan/AssignedTasksTab.tsx`
- `src/components/gameplan/TimelineBar.tsx`
- `src/components/gameplan/RichTextEditor.tsx`

Documentation/checkpoint files:

- `docs/implementation-notes/game-plans-phase-1-audit.md`

Files that may be read but should not be modified for this UI-only track:

- `src/hooks/useGamePlans.ts`
- `src/hooks/useAssignedTasks.ts`
- `src/hooks/useModulePermissions.ts`
- `src/hooks/useAuth.ts`
- `src/lib/secureInvoke.ts`
- `src/App.tsx`
- `src/components/layout/DashboardSidebar.tsx`
- `src/components/layout/MobileSidebar.tsx`
- `src/integrations/supabase/types.ts`
- `supabase/functions/**`
- `supabase/migrations/**`
- unrelated `src/pages/**` modules

## Phase 1 conclusion

The Game Plans implementation is mapped and the scope is locked to UI-only enhancement work on the Game Plans page and its gameplan child components. The theme foundation exists and should drive all subsequent visual changes. No functional code was changed in Phase 1.
