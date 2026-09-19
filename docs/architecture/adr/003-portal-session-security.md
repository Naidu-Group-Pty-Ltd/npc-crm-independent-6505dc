# ADR-003: Solicitor Portal session security

- **Status:** Implemented in Phase 2
- **Decision:** Use a multi-row `solicitor_portal_sessions` store containing only
  token hashes, user ID, absolute/idle expiry, last use, revocation metadata, and
  hashed device/network observations. Raw tokens exist only during issuance and
  in a Secure, HttpOnly, portal-specific SameSite cookie.
- **Prohibited:** Raw token database columns, local/session storage, request JSON,
  logs, and browser-readable headers.
- **Controls:** Rotation, concurrent-device visibility, per-session/global
  revocation, idle/absolute expiry, CSRF protection, and rate limiting.
- **Compatibility:** Short dual-validation window behind a flag; revoke and remove
  plaintext compatibility only after active-session migration telemetry clears.

## Implementation evidence

The Phase 2 migration adds a hash-only multi-session table. Issuers HMAC tokens with `SESSION_TOKEN_PEPPER`, return them only as portal-specific HttpOnly cookies, and expose only session metadata. The resolver enforces absolute and sliding idle expiry. Legacy header tokens are accepted only during the migration window by the verify path, exchanged for a hashed cookie session, and cleared from the user row.
