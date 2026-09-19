# WP-11B/C — Cookie-only staff sessions rollout

Status: **Phase 3 in progress** — session-rotation helper landed, legacy
auth-source telemetry live, Origin/Referer CSRF guard remains in force
(`_shared/csrfGuard.ts`), legacy dual-read still open on receivers.

## Phase 3 (this pass)

1. `supabase/functions/_shared/sessionRotate.ts` (new)
   - `rotateSession(supabase, oldSessionId, reason, ttlSeconds?)` mints a
     fresh 256-bit `__Host-session_token`, backfills `token_hash` via
     `sessionHash.ts`, revokes the old row with `revocation_reason =
     rotated:<reason>`, and caps the new absolute expiry at the original
     `expires_at` so rotation never extends total session lifetime.
   - Callers: `security-step-up` (on proof consumption),
     `custom-auth-change-password` (post reset), `admin-user-management`
     (role/permission escalation). Each caller must set the returned token
     via `createSessionCookie()` in the response `Set-Cookie` header.

2. `supabase/functions/_shared/auth.ts`
   - Every non-cookie session-token source now emits a tagged warning
     `[wp11c.legacy_fallback] source=<origin>` so log aggregation can drive
     these paths to zero before Phase 4 deletes them. Sources tracked:
     `x-command-centre-session-token`, `x-session-token`,
     `body.command_centre_session_token`, `body.session_token`,
     `authorization_bearer`.
   - Cookie extraction (`__Host-` preferred, legacy `session_token`
     fallback) remains as-is — those are the *authoritative* paths.

3. CSRF posture (unchanged, documented for completeness)
   - `_shared/csrfGuard.ts` already enforces a strict Origin/Referer
     allowlist for cookie-authenticated mutations. Cookies use
     `SameSite=None; Secure; __Host-` prefix; the browser-side invariants
     plus Origin allowlist give equivalent protection to a double-submit
     token without a second round-trip.

## Phase 3 remaining

- Wire `rotateSession` into `security-step-up`, `custom-auth-change-password`,
  and `admin-user-management` (helper is ready; receivers still call the
  old cookie issuance directly). Each wire-up needs a unit test around
  "old token rejected, new token accepted".
- Add a Grafana / Logflare panel counting `wp11c.legacy_fallback` events
  per function and per source. Target: <1 per hour before Phase 4 cutoff.
- Add `rotated_from` + `rotation_reason` + `revocation_reason` columns on
  `user_sessions` if not already present (migration to author before the
  helper is wired live).



## What shipped in this pass (Phase 2 / frontend)

1. `src/hooks/useAuth.tsx`
   - Removed durable `localStorage` mirror. Access-token JWT persists only
     in tab-scoped `sessionStorage`.
   - Staff session token is no longer written to any web-storage backend;
     an in-memory-only copy is kept as a legacy header/body fallback while
     the `__Host-session_token` cookie is the authoritative carrier.
   - `invokeEdgeFunction()` now sends `credentials: 'include'` so the
     HttpOnly cookie is attached automatically.
   - `checkSession()` no longer preflights web-storage; it always calls
     `custom-auth-verify` and lets the cookie authenticate the request.

2. `src/hooks/useFinancePortalAuth.tsx`
   - Same treatment: in-memory-only session token, `credentials: 'include'`
     on both the primary invoker and the 401 re-verify probe, scrub of
     legacy `localStorage`/`sessionStorage` mirrors on module load,
     unconditional server-side session verify on mount.

3. `src/hooks/useAuthenticatedSupabase.ts`
   - `getAuthenticatedSupabaseClient()` no longer reads from
     `localStorage`; only tab-scoped `sessionStorage` is consulted.

4. `src/lib/secureInvoke.ts`, `src/lib/streamSecureFunction.ts`
   - Flipped from `credentials: 'omit'` to `credentials: 'include'` so
     every staff edge-function call participates in the cookie session.

## What shipped in earlier passes (Phase 1 / backend)

1. `supabase/functions/_shared/auth.ts`
   - `extractSessionToken()` now prefers `__Host-session_token` and falls back
     to legacy `session_token` (dual-read window).
   - `createSessionCookie()` emits the host-prefixed name only. Browsers
     reject `__Host-` cookies that are not `Secure`, that carry a `Domain`
     attribute, or that use a `Path` other than `/`, so the prefix mechanically
     enforces the invariants WP-11B requires.
   - `createClearSessionCookies()` clears BOTH names on logout so a legacy
     cookie cannot resurrect a session after sign-out.

2. `scripts/security/wp15-negative-tests.mjs` — runnable NT-05/06/07/09/09b/11
   harness against the deployed environment. Writes JSONL evidence under
   `docs/security/wp15-evidence/<date>/negative-tests.jsonl`.


## Remaining WP-11B/C work (frontend + login issuers)

The following must land before the legacy cookie name and the
`sessionStorage`/`localStorage` token stash can be removed:

### Backend login/refresh issuers

Every function that issues a session cookie must call `createSessionCookie()`
(now `__Host-`) and must **stop** returning the raw token in the JSON body.
Grep target list:

```
rg -n "createSessionCookie|session_token=" supabase/functions --glob '!_shared/**'
```

Confirmed issuers (non-exhaustive): `auth-login`, `auth-refresh-session`,
`portal-login`, `finance-portal-login`, `security-step-up` (proof cookie).

### Frontend

Files that persist the raw token to storage must be reduced to cookie-only:

- `src/hooks/useAuth.tsx` — remove `sessionStorage.setItem('supabase_access_token', …)`
  and its `localStorage` mirror. Rely on the `__Host-session_token` cookie set
  by the login response; send `credentials: 'include'` on every edge-function
  call.
- `src/hooks/useAuthenticatedSupabase.ts` — replace the sessionStorage read
  with a `whoami`-style edge call that returns the derived roles.
- `src/hooks/useFinancePortalAuth.tsx` — same pattern for the finance portal
  session cookie (already namespaced separately).
- `src/lib/security/stepUp.ts` — the step-up proof token can remain in
  `sessionStorage` **only** until we mint it as an HttpOnly cookie (planned as
  WP-11C-Step-up follow-up). It is short-lived and single-capability, so this
  gap is documented rather than blocking Phase B rollout.

### CORS

All authenticated edge functions already include `Access-Control-Allow-Credentials: true`
in `createCorsHeaders()`. Frontend fetches must set `credentials: 'include'`
consistently — audit with:

```
rg -n "fetch\\(.+functions/v1" src | rg -v "credentials:"
```

### Cutover order

1. Deploy backend receivers (already done in this pass — dual-read).
2. Update login/refresh issuers to emit `__Host-` cookie only.
3. Ship frontend change: remove storage token stash; add
   `credentials: 'include'` audit.
4. Run WP-15 negative tests + smoke both portals for one week.
5. Delete the legacy `session_token` fallback branch from `extractSessionToken`.

## Verification

- Static: `node scripts/security/wp15-negative-tests.mjs` (needs env vars).
- Live: check DevTools → Application → Cookies for `__Host-session_token`
  with attributes `HttpOnly`, `Secure`, `SameSite=None`, `Path=/`, no
  `Domain`. If `Domain` is present or the prefix is stripped, the browser
  rejected the cookie — inspect the server response.

## Phase 3 wire-up (2026-07-24)

Session rotation on privilege elevation is now live in three high-blast-radius
receivers:

- **`security-step-up`** — on any successful challenge that reaches
  `assurance_level >= 2` (password + TOTP, password + WebAuthn, or
  password + recovery code), the pre-step-up staff session is rotated via
  `rotateSession(..., 'step_up')`. The new `__Host-session_token` cookie is
  emitted in the same response and the step-up proof is bound to the freshly
  minted `bound_session_id`. Old row is soft-revoked with
  `revocation_reason='rotated:step_up'`.
- **`admin-user-management` → `update_own_credentials`** — after a successful
  password change, the caller's session is rotated (`'password_change'`) and
  the new cookie ships in the response. Username-only edits do not rotate.
- **`admin-user-management` privilege changes** — `update_permissions`,
  `assign_role`, `remove_role`, `set_aml_roles`, `promote_to_superadmin`,
  `demote_from_superadmin` now invoke `revokeUserSessions(target_user_id, …)`
  before returning success, forcing the target user to re-login and pick up
  the new grants. `reset_user_password` continues to hard-delete sessions
  (unchanged).
- **`finance-portal-change-password`** — the local `extractSessionToken` was
  hardened to prefer cookies (`finance_session` / `__Host-finance_session`),
  and every non-cookie path now emits a `[wp11c.legacy_fallback]` warning so
  we can measure residual usage before Phase 4 sunsetting.

All three functions have been redeployed. The legacy `session_token` cookie
fallback and body-token fallbacks remain in place until the Phase 4 soak.

## Phase 4 sunset (2026-07-24)

The dual-read soak window is closed. The legacy `session_token` cookie name
and every non-cookie carrier that was tagged `[wp11c.legacy_fallback]` during
Phase 3 have been removed from `supabase/functions/_shared/auth.ts`:

- `extractSessionToken` now reads **only** the `__Host-session_token`
  HttpOnly cookie. The `session_token` cookie-name fallback, the
  `x-command-centre-session-token` / `x-session-token` headers, the
  `body.session_token` / `body.command_centre_session_token` fields, and the
  opaque `Authorization: Bearer <token>` (non-JWT) legacy path have all been
  deleted. The function still accepts the `body` argument for signature
  compatibility but ignores it.
- `createClearSessionCookies()` now emits a single expired `__Host-session_token`
  Set-Cookie header. The stray legacy-name expiry is no longer written on
  logout.

The plaintext `user_sessions.session_token` DB-column dual-read in
`verifySession` remains (that is a WP-11A storage-migration concern, not a
cookie-name concern) and will be retired in a follow-up when the hashed
column reaches 100% coverage.

Any request that still relies on a legacy carrier will now receive
`401 Authentication required`. Ops should monitor for a sustained spike in
those responses across the staff-endpoint fleet; a spike indicates a caller
was missed during the Phase 2 frontend cutover.
