# Internal Messaging and Platform Announcements — Phase 0 Architecture Gate

**Status:** implementation held at the Phase 0 security gate  
**Assessment date:** 2026-08-01  
**Repository:** `lavan96/aurixa-systems` (checkout directory: `npc-property-dashbord`)  
**Task branch:** `work`  

## Executive decision

This repository contains the authenticated Aurixa Command Centre and several
authenticated partner portals. It is not merely the public pricing storefront.
The requested feature therefore belongs in this product, but it must not be
implemented on top of the existing portal-correspondence tables or exposed in
the UI yet.

The blocking security fact is that the Command Centre currently represents the
customer organisation largely as a clone-level Mission Control tenant, while
local authenticated users are `custom_users`. There is no reviewed, canonical
local `workspace_memberships` contract that simultaneously proves:

1. the user's active workspace;
2. active/suspended/removed membership state;
3. the authorised Mission Control seat attached to that membership; and
4. the workspace-scoped role used for messaging and announcements.

Inferring that boundary from a browser-selected workspace, from a global role,
or from “all users in this clone” would make tenant isolation client-side or
implicit. That fails the task's mandatory acceptance gate. Phase 0 therefore
records the authoritative contracts required before schema, RLS, Realtime, or
UI work begins. No public or partially secured messaging surface is added.

## Repository assessment

### Application and routing

- The application is Vite, React, TypeScript, shadcn/ui, Tailwind, React Query,
  and Supabase.
- `src/App.tsx` mounts `AuthProvider`, protected Command Centre routes, and
  separate protected Client, Finance, Solicitor, and Builder portal route trees.
- The private Command Centre already includes `/messages` behind
  `ModuleGuard moduleKey="conversations"`.
- That route is a **portal communications oversight inbox**. It is not secure
  same-workspace user-to-user direct messaging and must not be repurposed
  without a compatibility plan.
- The repository also contains public token/share routes. A new private message
  route must remain below the Command Centre protected layout and must never be
  mounted alongside those public routes.

### Authentication and identities

- Command Centre uses the existing `useAuth`/`AuthProvider` session and the
  JWT-bearing authenticated Supabase client. New code must use that identity;
  it must not add another login or accept an actor ID from the browser.
- Roles are stored in `public.user_roles`; superadmin behaviour is already
  established and must be preserved.
- Client, Finance, Solicitor, and Builder portals have distinct session and
  protected-layout implementations. Command Centre internal messages must not
  leak into those portals, notification counts, or previews.

### Tenant, workspace, membership, and seats

- Mission Control owns the organisation billing tenant, plan, and seat cap.
- `admin-user-management` reserves a seat before invite persistence, commits it
  after creating `custom_users`, and releases it after local deletion.
- Local invite rows retain `mc_seat_id`; Mission Control is authoritative for
  seat entitlement and exposes entitlement/list operations through the existing
  server-side adapter.
- The documentation calls a tenant an organisation and its billing account a
  shared workspace account, but this is not yet a sufficient row-level
  membership proof for message recipients.
- Builder organisations and their memberships are portal-specific. They must
  not be treated as the general Command Centre workspace model.
- AML `tenant_id` is a compliance boundary and must not be reused as a general
  chat workspace identifier.

### Existing communications and notifications

- Current Client/Finance message tables and edge functions model governed
  Command Centre-to-portal correspondence using `visibility_scope`, assignments,
  client ownership, and `message_governance_log`.
- Existing messaging governance explicitly makes Command Centre the control
  plane and prevents finance-private/client-private visibility leaks.
- `NotificationsContext` reads the existing `notifications` table with the
  authenticated client and listens through Supabase Realtime. It supports
  user-targeted and broadcast rows, but its current unscoped broadcast shape is
  not an acceptable workspace/platform-announcement authorisation model.
- The existing notification system should be extended through a server-owned
  projection or typed event, not replaced. Message bodies must not be copied
  into logs or broadly readable notification rows.

### Realtime, audit, storage, billing, and rollout

- Supabase Realtime is enabled and existing components clean up channels on
  unmount. New subscriptions must be conversation- or recipient-scoped and RLS
  authorised; unrestricted global message channels are forbidden.
- Existing governance/audit tables and functions should receive privileged
  announcement events. Audit metadata should include IDs, targeting criteria,
  actor, action, and result, but not message bodies.
- Supabase Storage exists, but secure messaging attachments are out of the
  first delivery slice. They remain disabled until a private bucket, tenant path
  policy, validation/scanning, signed URL, and abandoned-upload lifecycle are
  independently verified.
- Mission Control owns tier/seat data. Messaging has no per-tier message limit;
  Launch, Growth, Scale, and Enterprise eligibility derives from active
  membership plus an authorised seat. Enterprise directory and history APIs
  must paginate.
- The current `conversations` module gate is the appropriate rollback control
  only after its existing portal semantics are separated from the new internal
  messaging rollout. Platform announcements require a separate superadmin-only
  release flag.

### Aurixa Agent and application shell

- `AgentChatWidget` is an existing authenticated application overlay with its
  own conversation state, collaborative Realtime channel, notifications, and
  opening event. Those are AI-agent conversations, not human DMs.
- A Messages control belongs in the same authenticated right-side control area,
  but a shared panel coordinator must be introduced before the drawer. Opening
  Messages must close/suspend Agent safely; Escape, focus trap, and focus return
  must be owned by the coordinator. Agent data and behaviour must remain intact.

## Why existing message systems cannot be reused as the new data model

| Existing capability | Intended boundary | Decision |
| --- | --- | --- |
| Client Portal messages | Command Centre ↔ one client | Preserve; do not expose to staff DMs. |
| Finance Portal threads | assigned finance user/client routes | Preserve; assignment is not workspace membership. |
| Agent conversations/messages | user ↔ Aurixa Agent and explicit collaboration | Preserve; AI transcripts are not human DMs. |
| Unified solicitor conversations | transaction-case participants | Preserve; case access is narrower and differently governed. |
| `notifications` | general Command Centre event feed | Extend via safe projections only after recipient scoping is proven. |
| `message_governance_log` | portal routing/visibility audit | Reuse audit conventions; do not put chat bodies in it. |

## Required authoritative contract (Phase 1 gate)

Before creating messaging tables, the owning schema must expose a server-side
function equivalent to:

```text
resolve_active_workspace_membership(authenticated_user_id, workspace_id?)
→ workspace_id, membership_id, membership_status, seat_status,
  effective_workspace_roles, subscription_tier
```

The implementation may use a new local membership projection or a verified
existing canonical table, but it must meet all of these invariants:

- identity comes only from the verified Command Centre session/JWT;
- workspace is derived server-side, never trusted from request JSON;
- membership status distinguishes invited, active, suspended, removed, and
  inactive users;
- an active membership is linked to a valid/authorised Mission Control seat;
- roles are workspace-scoped and resolved server-side, with explicit
  superadmin handling;
- workspace/seat changes invalidate cached authorisation promptly;
- failures return indistinguishable not-found/forbidden responses across
  tenant boundaries;
- the contract has database tests for suspended, removed, cross-workspace,
  seat-revoked, and ordinary-user cases.

If the intended model remains one Mission Control tenant per deployed clone,
that choice must be explicit and immutable in the contract. A synthetic
`default` workspace or client-provided tenant identifier is prohibited.

## Approved target architecture after the gate

### Data model

Use dedicated tables rather than modifying portal correspondence:

- `workspace_conversations`: workspace, type, symmetric direct key, creator,
  last-message cursor/timestamps, retention class;
- `workspace_conversation_members`: active participation, read cursor, mute,
  archive, leave status, notification preference;
- `workspace_messages`: workspace and conversation, server-derived sender,
  plain-text body, reply reference, client idempotency UUID, edit/delete times;
- `platform_announcements`: one central workspace/platform announcement with
  status, severity, mandatory flag, schedule/window, revocation and targets;
- normalized announcement target rows for workspaces, tiers, and roles rather
  than one message per recipient;
- `announcement_receipts`: per-user delivery/read/dismissal state;
- an existing or extended audit stream for publish, revoke, target changes, and
  privileged moderation without body capture;
- notification preferences keyed to the existing user/workspace identity.

Attachments are deliberately absent until their separate security gate passes.

### Database invariants

- Create a canonical symmetric direct key from sorted participant UUIDs plus
  workspace ID and enforce a partial unique index for active direct threads.
- Create conversations and both participants in one `SECURITY DEFINER` RPC;
  validate both memberships and seats inside the same transaction.
- Submit messages through an RPC that derives workspace and sender, validates
  active participation/reply ownership, enforces length and rapid-send limits,
  and uses `(conversation_id, sender_user_id, client_generated_id)` uniqueness.
- Edit and soft-delete only through ownership-checked RPCs. Deleted bodies must
  not be returned to ordinary clients.
- Maintain read cursors server-side; calculate unread counts using indexed
  message order/cursors, not client counters.
- Use keyset pagination (`created_at`, `id`) for conversations, directory search,
  history, and announcements.
- Publish workspace announcements only after a workspace-admin check for the
  resolved workspace. Publish platform announcements only after explicit
  superadmin/platform-admin authorisation. “All users” requires a confirmation
  token bound to actor, draft, target digest, and short expiry.
- Scheduled publication requires reliable server scheduling. Without it,
  persist drafts but disable the schedule action rather than scheduling in the
  browser.

### RLS and grants

- Enable RLS on every new public table and add explicit table/function grants.
- Prefer narrow `SECURITY DEFINER` RPCs with a fixed `search_path`; do not grant
  direct mutation access to authenticated clients.
- Conversation/message reads require an active conversation membership and an
  active workspace membership/seat in the same workspace.
- Announcement reads require active targeting at query time; receipt mutation
  is restricted to `auth.uid()` and cannot dismiss mandatory notices.
- Realtime publication includes only tables whose SELECT policies enforce those
  same participant/recipient rules.
- No direct PostgREST access is added to the `aml` schema and no reserved
  Supabase schema is altered.

### UI and service boundaries

- Add typed messaging services over the approved RPCs; never pass authoritative
  actor/workspace/role/tier fields from React.
- Preserve `/messages` compatibility. Introduce an internal inbox route or an
  explicit tab only after product ownership decides how the existing Portal
  Messages route is named; no legacy route may be silently orphaned.
- Add the right-hand Messages button behind rollout flags with `Messages`
  tooltip/label, visible focus, active state, and a `99+` badge cap.
- Coordinate Agent and Messages drawers through one provider/state machine.
- Use semantic design tokens and existing shadcn primitives. Provide loading,
  actionable empty, offline, retry, and error states; validate keyboard/focus,
  reduced motion, desktop, and mobile behaviour in a browser.
- Browser notifications remain opt-in and are requested only after an explicit
  settings action. Locked/unauthenticated experiences receive no content.

## Delivery phases

Only one phase should be executed per task, consistent with repository rules.

1. **Phase 1 — identity boundary:** implement and test canonical workspace,
   membership, seat, and effective-role resolution; no messaging UI.
2. **Phase 2 — secure DM database:** tables, constraints, indexes, RPCs, grants,
   RLS, rate limits, retention foundation, and database authorisation tests.
3. **Phase 3 — announcements:** targeting, receipts, publish confirmation,
   audit, scheduling capability detection, RLS, and database tests.
4. **Phase 4 — typed services and Realtime:** cursor APIs, optimistic/idempotent
   send reconciliation, scoped subscriptions, reconnection, unread projection,
   preferences, and integration tests.
5. **Phase 5 — authenticated UI:** shared drawer coordinator, right-side control,
   drawer, full route, notifications/toasts, responsive/a11y tests, and browser
   screenshots.
6. **Phase 6 — staged rollout:** Development → internal users → pilot workspace
   → Launch → Growth → Scale → Enterprise → platform announcements, with live
   RLS adversarial tests, monitoring, and rollback drills.

## Validation matrix for later phases

At minimum, automated tests must prove:

- symmetric direct-key and duplicate prevention;
- same-workspace active/seat-authorised directory results only;
- cross-workspace, non-participant, spoofed sender, suspended, removed, and
  revoked-seat denial without object-existence disclosure;
- reply, edit, delete, archive, mute, read cursor, unread, cursor pagination,
  idempotency, rapid-send and message-length rules;
- workspace-admin own-workspace announcement permission and cross-workspace
  denial;
- platform-admin targeting for Launch, Growth, Scale, Enterprise, selected
  workspaces/roles, schedule/window/expiry/revocation, mandatory dismissal, and
  receipt isolation;
- scoped Realtime delivery, subscription cleanup, reconnect recovery, and toast
  deduplication;
- button positioning beside Agent, `99+`, panel coordination, Escape/focus
  restoration, keyboard navigation, mobile layout, offline/retry/error/empty
  states, and long-message wrapping.

## Deployment and rollback contract

1. Deploy Phase 1 identity/membership migration and edge changes first.
2. Run live same-tenant and cross-tenant negative tests before Phase 2.
3. Apply later migrations in phase order; add new Realtime tables only after RLS
   tests pass against the deployed project.
4. Required existing secrets remain `MISSION_CONTROL_URL`,
   `MISSION_CONTROL_CLONE_API_KEY`, and `MISSION_CONTROL_WEBHOOK_SECRET`; do not
   add service-role or provider secrets to database rows or browser variables.
5. Default all new rollout flags off. Enable only in the staged order above.
6. Roll back UI immediately by disabling flags. Keep additive tables/history in
   place while functions/subscriptions are withdrawn; never drop message/audit
   data as an emergency rollback.
7. Before production enablement, verify invites, deletions, seat reconciliation,
   workspace switching, logout, Agent drawer behaviour, existing Portal
   Messages, Client/Finance visibility, billing, and all protected routes.

## Phase 0 exit criteria

- Authenticated Command Centre presence is confirmed.
- Existing portal communications are explicitly preserved and distinguished
  from internal staff DMs.
- The missing authoritative workspace-membership-seat contract is documented as
  a security blocker rather than bypassed.
- The target schema, RLS/RPC boundaries, Realtime restrictions, UI coordination,
  tests, deployment order, and rollback path are implementation-ready.
- No private messaging feature is exposed before tenant isolation can be proven.

