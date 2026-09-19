# Internal administration versus external portal boundary

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`

Two distinct surfaces are being proposed. They share a domain but share no
session, no route tree, no navigation, no permission system and no privilege
level. Conflating them is the single largest architectural risk in this
programme.

## The two surfaces

```text
Aurixa Command Centre  (internal, Aurixa staff)
├── Client Portal administration
├── Finance Portal administration
├── Solicitor Portal administration
└── Builder / Developer Portal administration     <-- /admin/builder-portal

Separate external portals  (customers and partners)
├── Client Portal            /client-portal/*
├── Finance Portal           /finance/*
├── Solicitor Portal         /solicitor/*
└── Builder / Developer Portal   /builder/*       <-- external, own login
```

## Boundary contract

| Dimension | Internal administration | External Builder Portal |
| --- | --- | --- |
| Route root | `/admin/builder-portal` under `DashboardLayout` | `/builder/*`, sibling of `/`, outside `DashboardLayout` |
| Who signs in | Aurixa staff | Builder and developer organisation users |
| Login page | The existing `/auth` staff login | `/builder/login` only |
| Identity store | Supabase `auth.users` + `user_roles` / `user_permissions` | `builder_portal_users` (proposed), no Supabase auth identity |
| Session | Supabase auth session | `__Host-builder_session_token` HttpOnly cookie, SHA-256 hashed server side |
| React provider | The internal auth context | `BuilderPortalAuthProvider`, scoped to `/builder/*` only |
| Route guard | `ProtectedRoute` + `ModuleGuard moduleKey="builder_portal_admin"` | `BuilderPortalProtectedRoute` |
| Server authorization | `verifyAuth()` + `requireModulePermission('builder_portal_admin')` + `enforceCsrf()` | `resolveBuilderSession()` + deny-by-default resource grants |
| Privilege | Service role, mediated by the admin Edge Function | Anon key only; never the service role |
| Navigation entry | `DashboardSidebar`, `MobileSidebar`, `GlobalCommandPalette`, each gated on `builder_portal_admin` | Portal-local `BuilderPortalLayout` nav only |
| Discoverability | Visible to permitted staff | Never referenced from any internal navigation surface |

## Hard rules

1. **The external Builder Portal must never appear as an internal dashboard
   module.** No `dashboard_modules` row, no sidebar entry, no command-palette
   entry and no `ModuleGuard` may point at any `/builder/*` route. Only
   `/admin/builder-portal` is an internal module.
2. **A builder user must never authenticate through `/auth`.** The Builder
   session provider must not be mounted anywhere inside the internal route tree,
   and the internal auth context must not be reachable from `/builder/*`.
3. **A staff user must never authenticate through `/builder/login`.** Builder
   session resolution consults `builder_portal_users` only and never falls back
   to a Supabase auth session.
4. **Two separate Edge Function families.** `builder-portal-*` functions resolve
   a builder session. `builder-portal-admin` resolves a Command Centre session
   and checks `builder_portal_admin`. No function accepts either.
5. **The service role never crosses into the browser**, on either surface.

## Proposed internal module key

`builder_portal_admin`, following the `finance_portal_admin` and
`solicitor_portal_admin` naming already in use.

The key is **proposed, not finalised**. It is not created in Phase 0. When it is
created, it must — unlike `solicitor_portal_admin`, which is missing from
`dashboard_modules` (finding NOCOPY-03) — be registered in the same migration
that first uses it:

```sql
INSERT INTO public.dashboard_modules
  (module_key, module_name, description, category, icon, route, sort_order, is_active)
VALUES
  ('builder_portal_admin', 'Builder / Developer Portal',
   'Administer builder and developer organisations, portal users and access',
   'admin', 'HardHat', '/admin/builder-portal', <sort_order>, true)
ON CONFLICT (module_key) DO NOTHING;
```

The same migration must also register `solicitor_portal_admin` if that gap has
not been closed by then; that repair belongs to whichever phase touches
`dashboard_modules` first and is called out here so it is not forgotten.

## Proposed external route structure

```text
/builder/login              public
/builder/accept-invite      public, token in URL
/builder/forgot-password    public
/builder/change-password    protected, pre-governance
/builder/terms              protected, pre-governance
/builder/onboarding         protected, pre-governance
/builder                    protected + layout   Dashboard
/builder/projects           protected + layout
/builder/transactions       protected + layout
/builder/pipeline           protected + layout
/builder/messages           protected + layout
/builder/tasks              protected + layout
/builder/settings           protected + layout
```

This mirrors the Solicitor three-tier nesting exactly: provider wraps everything;
public auth pages sit outside the protected route; governance pages sit inside
the protected route but outside the layout so an ungoverned user never sees
portal chrome; workspace pages sit inside both.

## Proposed administration capabilities

Delivered incrementally across later phases, all behind `builder_portal_admin`:

organisations (builder and developer) · portal users · invitations · account
status · roles · permissions · development access · project access · unit access ·
transaction assignments · transaction-case links · integration health · portal
readiness · audit records · AI policies · feature flags · cutover status.

## Phase 0 status

Nothing in this document is implemented. No route, no module key, no
`dashboard_modules` row, no component and no Edge Function is created in
Phase 0. `tests/builder-portal/phase0-existing-architecture.test.mjs` asserts
that no `/builder` route and no `builder_portal_admin` reference exists at this
baseline, so the boundary above starts from a verified clean slate.
