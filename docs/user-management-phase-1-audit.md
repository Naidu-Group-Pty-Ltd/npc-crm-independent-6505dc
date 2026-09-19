# User Management Phase 1 Audit, Component Map, and UI-Only Scope Lock

Phase 1 establishes the implementation boundary for the User Management premium UI work. It records the current route, component structure, workflows, security-sensitive logic, and visible UI risks before any presentation changes are made.

## Theme foundation inspection

`docs/dashboard-theme-foundation.md` is the design source of truth for the upcoming User Management UI work.

Key requirements absorbed for later phases:

- Use global CSS variables and Tailwind token classes instead of isolated one-off palettes.
- Prefer existing tokens and classes such as `bg-card`, `text-foreground`, `text-primary`, `border-border`, `bg-background`, `text-muted-foreground`, `hsl(var(--token-name))`, `--dashboard-surface`, `--surface-1`, `--primary`, `--muted`, and `--border`.
- Prefer `DashboardThemeFrame` variants (`page`, `hero`, `section`, `sectionAccent`, `card`, `premiumCard`, `chartCard`, `toolbar`) where they fit the page shell or subcomponents.
- Preserve shadcn primitives and compose premium styling around their current APIs.
- Support dark mode, light mode, mobile, desktop, hover, focus, forms, cards, tables, and sidebar layout.
- Include a `Global Theme Foundation / Cascading UI Subcomponent` check before adding local styling in later UI phases.

## Route and access map

- Route: `/admin/users`.
- Route declaration: `src/App.tsx` wraps `UserManagement` in `ModuleGuard moduleKey="user_management"`.
- Page component: `src/pages/admin/UserManagement.tsx`.
- Sidebar entries: `src/components/layout/DashboardSidebar.tsx` and `src/components/layout/MobileSidebar.tsx` both define `User Management` at `/admin/users` with `moduleKey: 'user_management'`.
- Page-level access check: `UserManagement` calls `usePermissions()` and returns a destructive `Alert` when `!isSuperadmin`.
- Permission loading state: while `permLoading` is true, the page renders a centered `Loading...` message.

## User Management component inventory

### Page shell and header

Current `UserManagement` renders:

- A `p-6 space-y-6` top-level container.
- Header with `Users` icon.
- Title text: `User Management`.
- Subtitle text: `Manage users, roles, and permissions`.
- `Create Sub-Admin` outline button.
- `Invite User` primary button.

### Data fetching and state

The page maintains state for:

- Users, modules, loading.
- Invite dialog fields, invite type, invite permissions, and invite sending state.
- Create sub-admin dialog fields, permissions, and creating state.
- Edit permissions dialog state and previous permission snapshots for audit diffing.
- Personal mailbox dialog state.
- Reset password dialog state.
- Bulk selected user IDs.
- Clone permissions dialog state.

Current secure function calls are all through `invokeSecureFunction('admin-user-management', ...)` and must not be changed during UI-only work:

- `list_users`
- `list_modules`
- `get_user_permissions`
- `send_invite`
- `update_permissions`
- `force_logout`
- `update_user`
- `promote_to_superadmin`
- `demote_from_superadmin`
- `delete_user`
- `create_subadmin`
- `reset_user_password`
- `purge_user`

### All Users panel and table

The `All Users` panel is a shadcn `Card` with:

- `CardTitle`: `All Users`.
- `CardDescription`: `Manage user accounts and their access levels`.
- Loading state text: `Loading users...`.
- Table columns, in order:
  1. Selection checkbox
  2. User
  3. Role
  4. Mailbox
  5. Status
  6. Last Login
  7. Created
  8. Actions

Rows are rendered by `src/components/admin/UserTableRow.tsx` with the existing order from `users.map(...)`. No sorting, filtering, row-ordering, or column mapping changes are allowed.

### User row presentation

`UserTableRow` currently renders:

- Row checkbox selection.
- Username.
- Current-user `You` badge when `isSelf` is true.
- Email or `No email` fallback.
- Role badges derived from `user_roles`:
  - `Superadmin` with `Crown` icon when role includes `superadmin`.
  - `Admin` with `Shield` icon when role includes `admin` and not superadmin.
  - `User` fallback badge.
- Personal mailbox value or italic `Not set`.
- Mailbox edit icon button.
- Active switch and `Active` / `Inactive` text.
- Last login relative time with exact locale string in the `title` attribute, or `Never`.
- Created date via `toLocaleDateString()`.
- Action controls governed by existing `hasSuperadmin` and `isSelf` guards.

### Row actions and destructive safeguards

Existing row action conditions must remain intact:

- Edit permissions: available only when target is not superadmin and not self.
- Clone permissions: available only when target is not superadmin and not self.
- Reset password: available only when target is not self.
- Promote to superadmin: available only when target is not superadmin and not self.
- Demote from superadmin: available only when target is superadmin and not self, and protected by an `AlertDialog`.
- Force logout: available only when target is not self and handler exists.
- Delete: available only when target is not self, and protected by an `AlertDialog`.

Destructive actions already use confirmation dialogs for demote/delete and destructive styling for delete. Later UI phases may improve styling and accessible labels, but may not remove safeguards or broaden availability.

### Modal and workflow map

The current page includes these workflows:

- Create Sub-Admin dialog:
  - Fields: username, password, email, personal mailbox, module permissions.
  - Validation: username/password required; password minimum 6 characters; valid email required.
  - Action: `create_subadmin`.
- Invite User dialog:
  - Fields: email, optional username, invite method, module permissions.
  - Validation: email required.
  - Action: `send_invite`.
- Edit Permissions dialog:
  - Permissions grid.
  - Action: `update_permissions`.
  - Audit diff uses `buildPermissionDiffs`.
- Configure Personal Mailbox dialog:
  - Field: personal mailbox email.
  - Validation: if provided, must be a valid email address.
  - Action: `update_user` with `personal_mailbox`.
- Reset Password dialog:
  - Fields: new password and confirm password.
  - Validation: minimum 8 characters and matching confirmation.
  - Action: `reset_user_password`.
- Clone Permissions dialog:
  - Target user select.
  - Guard: excludes source user and superadmins from target options.
  - Actions: `get_user_permissions`, then `update_permissions`.
- Soft Deleted Users panel:
  - Fetches deleted users via `list_users` with `include_deleted: true`.
  - Restore uses `update_user` with `restore: true`.
  - Purge uses `purge_user` and is protected by an `AlertDialog`.
- Bulk User Actions panel:
  - Appears only when selected count is greater than zero.
  - Activate/deactivate/delete actions are confirmed through an `AlertDialog`.
  - The current user ID is filtered out before bulk mutation.

## Security and behaviour scope lock

The following must remain untouched during premium UI implementation:

- Authentication and authorization flow.
- `ModuleGuard` usage and `/admin/users` route registration.
- `usePermissions` and `isSuperadmin` access gate.
- All `invokeSecureFunction` function names, action names, payload shapes, and response handling logic.
- Supabase/database schemas and generated types.
- Role hierarchy and availability checks for superadmin/admin/user actions.
- Current-user protections for self active toggle, reset, role changes, force logout, delete, and bulk operations.
- Invitation, sub-admin creation, mailbox assignment, active/inactive toggling, password reset, clone permissions, permission diffing, audit logging, notifications, restore, purge, and delete logic.
- Existing toast success/error trigger conditions.
- Existing form labels, validation requirements, button labels, table columns, visible row data, and row ordering.
- Unrelated dashboard modules, sidebar grouping, routing, and non-user-management pages.

## UI risks identified for later phases

The following are UI-only risks to address without changing behaviour:

- Table has no explicit responsive containment; long emails and mailbox addresses can stretch the ledger.
- User identity cells do not consistently truncate or expose full values through titles.
- Mailbox and action cells can become cramped on tablet or smaller widths.
- Icon-only action buttons are visually ambiguous; not all have `aria-label` attributes even when tooltips are present.
- Hit targets vary between mailbox edit (`h-6 w-6`) and other row actions.
- The `All Users` table currently lacks a polished empty state when `users.length === 0`.
- Loading state is plain text rather than a table-aware skeleton or premium card state.
- Light mode relies mostly on defaults and needs intentional borders, contrast, and restrained gold accents.
- Current row hover/selected states are minimal.
- Dialogs use max heights but need a later viewport pass for smaller screens and nested permission tables.
- Bulk actions may wrap tightly on narrow widths and should be visually contained without changing action logic.
- Destructive and high-privilege actions can be clearer while preserving confirmations and disabled/hidden states.

## Phase 1 conclusion

The current implementation has been mapped and locked for UI-only changes. Later phases should modify only presentation, layout, responsive containment, accessibility labels, and theme-token-based styling in the User Management surface and its direct user-management subcomponents. Behaviour, data flow, route registration, permission enforcement, secure function calls, payloads, validation rules, and destructive safeguards are out of scope.
