# Solicitor Portal Cross-Portal Programme — Phase 2 Report

## Delivered

- Hash-only, multi-device `solicitor_portal_sessions` with absolute and sliding
  idle expiry, per-session and all-session revocation, device labels, and hashed
  IP/user-agent observations.
- Cookie-only browser transport (`credentials: include`), no web storage, raw
  token headers, request JSON tokens, or response-body tokens.
- HMAC issuance using the existing `SESSION_TOKEN_PEPPER` utility. The service
  fails closed when the pepper is absent or too short.
- Strict exact Origin plus `X-Portal-Request: solicitor-portal` for new clients.
  A legacy header carrier is accepted only by authenticated resolution during the
  migration window; verify exchanges it for a cookie session and clears the old
  user-row token.
- Login/invite issue independent sessions. Logout revokes only the current device.
  Verify supports listing devices, revoking one, and revoking other devices.
- Password change/reset revoke all sessions; change rotates to a fresh session.
  User or firm deactivation revokes every applicable hashed session.
- Per-email and per-IP throttles, generic login failures, and identity audit events
  for login, logout, lockout, reset, migration, rotation, and revocation.

## Compatibility and rollout

Apply `20260730180000_solicitor_portal_sessions_phase2.sql`, configure a 32+ byte
`SESSION_TOKEN_PEPPER`, deploy auth functions, then deploy the cookie-only client.
Legacy columns remain but receive only clearing writes. Monitor
`phase-2-reconciliation.sql`; when plaintext remaining reaches zero and the
migration window closes, remove header/body fallback and legacy columns in Phase
15. Rollback the client/functions together; do not issue new plaintext sessions.

## Risks

Cookies require HTTPS, exact allowed origins, and credentialed CORS. Pepper loss
invalidates every session; pepper exposure requires global revocation and rotation.
Live SQL, Deno, browser E2E, and build verification require deployment tooling not
available in this container.

**Stop gate:** Phase 2 only. Terms/onboarding and audience contracts remain Phase 3.
