# ADR 018: The Builder / Developer Portal is a separate external portal

## Status

Proposed. Blocks Phase 1 of the Builder / Developer Portal programme
(`docs/builder-portal/`). Recorded at baseline
`a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`.

## Context

Aurixa needs builder and developer organisations to see and act on their own
property inventory, sales and construction progress. Two shapes are available.

The first is an internal dashboard module: a `dashboard_modules` row, a route
under `DashboardLayout`, a `ModuleGuard`, and builder users provisioned as
Supabase `auth` identities with a restricted permission set.

The second is a fourth external portal alongside Client, Finance and Solicitor:
its own route root, its own React auth provider, its own user table, its own
HttpOnly-cookie session, and a separate internal administration page for Aurixa
staff.

The first shape is cheaper and is the wrong one. Builder users are external
commercial counterparties, frequently in direct commercial tension with each
other on the same project. Provisioning them as internal identities would place
them inside the trust boundary that `ProtectedRoute`, `DashboardLayout`,
`useModulePermissions` and every `USING (true)` RLS policy assume. Several
existing tables — including `builder_invoices` and `build_progress_payments`,
which carry Aurixa commission amounts — are readable by any `authenticated`
role precisely because that role has always meant "Aurixa staff". Adding an
external user to that role silently reclassifies every such table.

The Solicitor Portal already answers this question. `/solicitor/*` is a route
sibling of `/`, outside `ProtectedRoute` and `DashboardLayout`, wrapped in
`SolicitorPortalAuthProvider`, authenticated by a `__Host-solicitor_session_token`
HttpOnly cookie resolved server-side against a SHA-256 hash, with a separate
`/admin/solicitor-portal` page gated on the `solicitor_portal_admin` module key.
That structure is proven in production.

## Decision

The Builder / Developer Portal is a **separate external portal**, structured
exactly like the Solicitor Portal.

1. **Route root `/builder/*`**, a sibling of `/` in `src/App.tsx`, outside
   `ProtectedRoute` and `DashboardLayout`.
2. **`BuilderPortalAuthProvider`** wraps only `/builder/*`. It never touches the
   Supabase auth session.
3. **Three-tier nesting**: provider → `BuilderPortalProtectedRoute` →
   `BuilderPortalLayout`. Public auth pages sit outside the protected route;
   governance pages (change-password, terms, onboarding) sit inside the protected
   route but outside the layout.
4. **Own identity store**, `builder_portal_users`. Builder users have no Supabase
   `auth.users` row and no `authenticated` database role.
5. **Own session**: `__Host-builder_session_token`, HttpOnly, Secure,
   SameSite=Strict; only a SHA-256 `token_hash` is persisted; absolute plus
   sliding idle expiry; explicit revocation; `ip_hash` and `user_agent_hash`
   binding. Built on `_shared/sessionHash.ts`.
6. **Own Edge Function family** `builder-portal-*`, each resolving a builder
   session through one shared `resolveBuilderSession()`.
7. **Separate internal administration** at `/admin/builder-portal`, inside
   `DashboardLayout`, behind `ModuleGuard moduleKey="builder_portal_admin"`, with
   server enforcement by `verifyAuth()` +
   `requireModulePermission('builder_portal_admin')` + `enforceCsrf()`.

## Invariants

- The external Builder Portal is never a `dashboard_modules` row and is never
  linked from `DashboardSidebar`, `MobileSidebar` or `GlobalCommandPalette`.
- A builder user never signs in through `/auth`; a staff user never signs in
  through `/builder/login`.
- `builder-portal-*` functions accept only a builder session cookie.
  `builder-portal-admin` accepts only a Command Centre session. No function
  accepts either.
- The service role never reaches the browser on either surface.
- `builder_portal_admin` is registered in `dashboard_modules` in the same
  migration that first uses it.

## Corrections applied to the Solicitor pattern

Copying the structure does not mean copying the defects. Three are corrected at
the outset:

1. **Cookie-only from the first commit.** No plaintext session-token column, no
   `x-*-session-token` header carrier and no body-token field is ever created, so
   no legacy path exists to migrate away from later.
2. **`builder_portal_admin` is registered in `dashboard_modules`.**
   `solicitor_portal_admin` is used by `ModuleGuard`, three navigation surfaces
   and three Edge Functions but is inserted by no migration.
3. **`portal_role` is `text` with a `CHECK`**, not a Postgres enum. The Builder
   role set is larger and less settled than the legal one; widening must not
   require an enum alter.

## Alternatives rejected

| Alternative | Why rejected |
| --- | --- |
| Internal dashboard module with restricted permissions | Places external commercial counterparties inside the `authenticated` trust boundary, silently reclassifying every `USING (true)` table including commission data |
| Separate deployed application | The repository is one Vite SPA; three portals already coexist by route root. A separate deployment adds build, release and shared-code duplication for no security gain the route split does not already provide |
| Extending the Client Portal with a builder role | Builder and client are commercially opposed parties on the same transaction; a shared session and shared projections would make every boundary a runtime condition |
| Reusing `solicitor_firms` with an organisation-type column | Couples the legal domain to the builder domain; `practising_states` and the legal role enum are meaningless for builders; blast radius across every existing solicitor foreign key |

## Consequences

- Four external portals must be kept structurally consistent. Divergence between
  them is a maintenance cost the programme accepts deliberately.
- Builder-specific session, invitation, terms and onboarding code is written
  rather than shared. The security-relevant primitives (hashing, expiry, CSRF,
  CORS, password policy) still come from `_shared/`, so this is portal-scoped
  identity, not duplicated infrastructure.
- Several shared services are legal-coupled and must be generalised before
  Builder can use them. That work is ADR 020.

## Migration and rollback

Phase 0 implements none of this. Later phases are additive: new routes, new
tables, new Edge Functions, and additive widening of shared constraints. Nothing
existing is removed. Rollback for any phase is to stop routing to the new surface
and leave the additive schema in place.
