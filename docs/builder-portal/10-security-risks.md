# Security-risk assessment

**Baseline:** `a2ec188faa806ff97cb272f7f5a8bcf56b984cb1`

Phase 0 introduces no executable code, so it introduces no new attack surface.
Every risk below is a risk to a **later** phase, recorded so the control is
designed before the code is written. Each names the control that mitigates it.

## SEC-01 — Session token exposure · Critical

**Risk.** A Builder session token reachable from JavaScript is stealable by XSS
and replayable. The Solicitor Portal still carries a legacy path
(`x-solicitor-session-token` header, `solicitor_session_token` body field, and a
plaintext `solicitor_portal_users.session_token` column) that Builder must not
inherit.

**Control.** Builder is cookie-only from its first commit:

- `__Host-builder_session_token`, `HttpOnly`, `Secure`, `SameSite=Strict`
- server stores only a SHA-256 `token_hash`; the raw token is never persisted
- no `localStorage`, no `sessionStorage`, no header carrier, no body carrier
- no plaintext token column is ever created, so there is nothing to migrate away
  from later
- absolute plus sliding idle expiry, revocation flags, `ip_hash` and
  `user_agent_hash` binding, all from `_shared/sessionHash.ts`

**Verification.** `scripts/builder-portal/security-check.mjs` (a later phase,
modelled on `scripts/solicitor-portal/security-check.mjs`) asserts the client
module contains `credentials: 'include'` and contains neither `localStorage`,
`sessionStorage`, nor any raw token identifier.

## SEC-02 — Client-supplied identifiers trusted as authorization · Critical

**Risk.** The Builder hierarchy is six levels deep. Any handler that accepts an
`organisation_id`, `development_id`, `project_id`, `stage_id`, `building_id`,
`lot_id`, `unit_id`, `transaction_case_id`, `client_id` or parent-resource ID
from the request and uses it without server-side verification is an IDOR.

**Control.** Deny by default. Every request resolves the caller's reachable set
server-side from `builder_user_access`, then intersects the requested ID against
it. Every child mutation is scoped to its **verified** parent — the full chain
from the mutated row up to the caller's organisation is walked on the server. A
grant whose `organisation_id` does not match the resolved scope's organisation is
inert.

**Verification.** Per-resource authorization contract tests following
`src/security/solicitorPortalMattersAuthz.security.test.ts`, plus a static scan
asserting no `builder-portal-*` handler reads a scope ID from the body without a
subsequent verification call.

## SEC-03 — Client-supplied business values trusted · High

**Risk.** Prices, deposits, completion dates, milestone statuses, document
visibility, MIME types and file sizes accepted from the browser allow a builder
user to alter economics or bypass a visibility control.

**Control.** Prices and deposits are validated against the server-held unit and
contract record. Milestone status changes go through the guarded transition
command, never a direct write. Document visibility is a grant, not a client
field. MIME type and byte size are established by the document processing
pipeline exactly as `complete_document_processing()` does today — the declared
values are recorded as *claims* and never used for authorization.

## SEC-04 — Builder-private data leaking to other portals · High

**Risk.** Construction costs, margins, supplier and contractor prices,
feasibility data, internal sales notes, unreleased inventory and unreleased
pricing reaching the Client, Finance, Solicitor or Command Centre portals.

**Control.** Named audience projections only — no `select('*')`, no shared broad
selection, following the `LEGAL_MATTER_*_SELECT` pattern. Builder-private
columns live on Builder tables and appear in no other portal's projection.
Shared rows carrying Builder-private content use `visibility = 'builder_private'`.
Unreleased inventory is filtered by release state at the query level, not the UI.

**Verification.** A contract test asserting each named Builder projection omits
every column on the Builder-private list, following the shape of
`tests/cross-portal-contracts/current-boundaries.test.mjs`.

## SEC-05 — Restricted data leaking into the Builder Portal · High

**Risk.** Solicitor-private notes, privileged advice, conflict-check results,
borrowing capacity, serviceability, client income and liabilities, AML/CTF
records, MLRO notes, finance-private notes or Command Centre-private notes
becoming reachable from a Builder session.

**Control.** A `BUILDER_FORBIDDEN_KEYS` set, consulted first inside the Builder
`can()` equivalent so no stored policy can grant them, and stripped by the admin
control plane before persistence — the exact mechanism
`SOLICITOR_FORBIDDEN_KEYS` uses today. Builder handlers never query
`legal_matters`, `purchase_files`, `aml*`, `client_income`, `client_expenses`,
`client_assets`, `client_liabilities`, `client_employment`,
`borrowing_capacity_assessments` or any commission table.

**Verification.** A static scan asserting no `builder-portal-*` function
references any table on the forbidden list, extending
`scripts/security/check-aml-edd-mlro-boundary.mjs`.

## SEC-06 — Existing permissive RLS on builder-adjacent tables · High

**Risk.** `builder_invoices` and `build_progress_payments` carry
`USING (true) WITH CHECK (true)` for `authenticated` and hold commission amounts,
lender-submission state and funds-release state. That is acceptable for tables
reached only through the staff dashboard and categorically unsafe if a Builder
portal path ever reaches them.

**Control.** Builder Edge Functions never query either table. The Builder Portal
uses the anon key and has no `authenticated` Supabase identity, so RLS is not the
control that saves us — the control is that no Builder code path touches them.
Progress-claim data reaches Builder as a Builder-owned record, projected outward
to Finance, never by reading the Finance-owned table.

**Verification.** A static assertion in the Builder security check that no file
under `supabase/functions/builder-portal-*/` mentions `builder_invoices` or
`build_progress_payments`.

## SEC-07 — Service-role credential exposure · Critical

**Risk.** A service-role key reaching the browser bundle grants unrestricted
database access.

**Control.** The service role exists only inside Edge Functions. The browser
holds the anon key. The existing repository-wide scan in
`scripts/solicitor-portal/security-check.mjs` already walks all of `src/` for
`VITE_*SERVICE_ROLE`, `import.meta.env.*SERVICE_ROLE` and
`process.env.*SERVICE_ROLE`; the Builder equivalent reuses it verbatim.

## SEC-08 — Missing or non-blocking audit on high-risk mutations · High

**Risk.** `logSolicitorActivity()` swallows a failed audit insert and lets the
mutation commit, recording only a secondary operational event. A reservation,
allocation, price change, contract issue or handover with no trustworthy
evidence is a commercial dispute waiting to happen.

**Control.** High-risk Builder mutations — reservation, hold, allocation,
release, price change, contract issue, contract execution, variation approval,
progress claim, practical completion, handover, settlement readiness — write
their audit record **inside the same transaction** as the state change. If the
audit write fails, the mutation fails. Audit is a precondition, not a side
effect.

## SEC-09 — Concurrency and duplicate allocation · High

**Risk.** Two sales consultants reserving the same unit; a stale write
overwriting a newer status; conflicting holds.

**Control.** `row_version` plus `expected_version` on every mutable aggregate,
following `update_case_task_status()`. A partial unique index enforcing at most
one active reservation per unit. HTTP **409** for stale writes, duplicate active
allocations, conflicting reservations, invalid state transitions and concurrency
failures — matching the programme's stated 409 contract.

## SEC-10 — Privilege escalation through the admin plane · High

**Risk.** A Builder user reaching `builder-portal-admin`, or a staff user without
`builder_portal_admin` reaching it.

**Control.** Two disjoint function families. `builder-portal-admin` resolves a
Command Centre session with `verifyAuth()` + `requireModulePermission('builder_portal_admin')`
+ `enforceCsrf()` and never accepts a builder session cookie.
`builder-portal-*` functions resolve a builder session and never accept a staff
JWT. No function accepts either.

## SEC-11 — Cross-organisation leakage on a shared project · Medium

**Risk.** A developer and a builder are both parties to one project. Without a
party-role dimension, a grant at project level would expose the builder's
construction costs to the developer, or the developer's feasibility data to the
builder.

**Control.** `builder_project_parties.party_role` is a second permission
dimension that intersects with `access_role`. The cross-organisation visibility
table in `05-organisation-and-access-hierarchy.md` is the contract. This must be
settled before any project-level grant is implemented.

## SEC-12 — Invitation and account-activation abuse · Medium

**Risk.** Invitation-token replay, token enumeration, unauthenticated password
reset abuse, account-existence disclosure through differential responses.

**Control.** Reuse `_shared/resetTokens.ts`, `_shared/publicAbuseControls.ts` and
`_shared/passwordValidation.ts`. Single-use, expiring, hashed invitation tokens.
A generic authentication error string (`GENERIC_AUTH_ERROR` in
`_shared/solicitorSessions.ts`) so login and reset responses do not disclose
whether an account exists. Rate limiting on every unauthenticated endpoint.

## SEC-13 — Origin and CSRF · Medium

**Risk.** A cross-origin page driving the Builder Portal with the user's cookie.

**Control.** `SameSite=Strict` on the session cookie; the
`X-Portal-Request: builder-portal` discriminator; an `Origin` allow-list check
that rejects a missing `Origin` — the `validateSolicitorPortalHeaders()` pattern.
`enforceCsrf()` on the admin plane.

## SEC-14 — Document handling · Medium

**Risk.** Malware in uploaded plans, contracts or construction photographs;
public object URLs; mutable replacement destroying chain of custody.

**Control.** The existing immutable document service unchanged: private bucket,
short-lived signed URLs, never `getPublicUrl()`, SHA-256 content hashing,
malware scan queue, immutable versions with `guard_immutable_document_version()`,
audience grants, download audit and legal hold.

## Deny-by-default statement

All Builder / Developer Portal access is deny-by-default. There is no
`DEFAULT_ALLOW_KEYS` equivalent and no OR-merge path. A permission key with no
configuration resolves to `{ view: false, edit: false, delete: false }`. This is
the deliberate correction of the Solicitor Portal defect recorded as NOCOPY-01,
and it is not negotiable in any later phase.
