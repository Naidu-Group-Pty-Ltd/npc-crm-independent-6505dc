# WP-15 — Deployment, Verification & Launch Gate

Source: the restricted security program's approved launch-gate work package.

This document is the **operator runbook** for the final go/no-go review. Every
box must be ticked, and every artefact produced under
`docs/security/wp15-evidence/<yyyy-mm-dd>/` before sign-off.

---

## 1. Required deployment sequence (§22.1)

| # | Step | Owner | Evidence |
|---|------|-------|----------|
| 1 | Merge source changes with **passing CI** on `main` (verify + security + supply-chain jobs green). | Security lead | CI run URL |
| 2 | Configure/rotate every secret from §2 **before** deploying fail-closed functions. | SRE | `docs/security/wp15-evidence/<date>/secrets-verified.md` |
| 3 | Deploy shared-auth-dependent Edge Functions **as a fleet**; verify version hash equals HEAD. | SRE | `supabase functions list` snapshot |
| 4 | Deploy frontend/session changes (`AuthProvider`, `StepUpDialog`, portal builds). | Frontend | Vercel/Cloudflare deploy hash |
| 5 | Apply **additive** schema migrations (columns, tables, RPCs). | DBA | `supabase migration list` diff |
| 6 | Apply **RLS / grant / bucket-private** migrations only after compatible code is live. | DBA | Migration IDs |
| 7 | Rotate credentials that may have traversed legacy paths (internal HMAC previous key, Outlook clientState, cron JWTs still embedded, service-role if ever leaked). | SRE | Rotation timestamps |
| 8 | Run the **runtime negative-test matrix** (WP15_NEGATIVE_TEST_MATRIX.md). | Security QA | Attach JSON test log |
| 9 | Monitor logs / cost / error rate for **≥ 24 h** post-cutover. | SRE + Security | Grafana / Supabase dashboards |
| 10 | Independent penetration test against the deployed environment. | External vendor | Report PDF |
| 11 | Sign-off only when Critical + High findings are closed (or formally accepted). | Security lead | Sign-off memo |

---

## 2. Secret / config checklist (§22.2)

Verify **presence, min length, version, rotation timestamp** only — never
print values.

- [ ] Supabase project JWT signing keys — signing algorithm, rotation date
- [ ] `RESET_TOKEN_PEPPER` — set, ≥ 32 chars, unique per environment
- [ ] `SESSION_TOKEN_PEPPER` — set, ≥ 32 chars (WP-11A)
- [ ] `MFA_TOTP_ENCRYPTION_KEY` — base64url-encoded 32-byte AES-256-GCM key; set before enabling enrolled staff TOTP (WP-11C)
- [ ] Turnstile secret + `PUBLIC_ABUSE_TURNSTILE_REQUIRED=true` (WP-10)
- [ ] Internal HMAC — `INTERNAL_HMAC_KEY_ID`, `INTERNAL_HMAC_KEY_CURRENT`, `INTERNAL_HMAC_KEY_PREVIOUS` (WP-12)
- [ ] `INTERNAL_STRICT_SIGNED=true` (WP-12 legacy fallback disabled)
- [ ] `INTERNAL_EDGE_SECRET` — rotated post-WP-12 fleet deploy
- [ ] `AUTO_REPORT_WEBHOOK_SECRET` — set, rotated ≤ 90 days
- [ ] `VAPI_WEBHOOK_SECRET` — set
- [ ] `GHL_WEBHOOK_SECRET` — set (if webhooks enabled)
- [ ] `OUTLOOK_WEBHOOK_CLIENT_STATE` — ≥ 16 chars (WP-13)
- [ ] `DOCUSIGN_HMAC_KEY` — set if agreements module active
- [ ] Cron secrets — one per scheduled endpoint, distinct from webhook secrets
- [ ] Paid-provider keys + **account-level spend caps** configured (Lovable AI Gateway credit ceiling; Google Maps quota)
- [ ] Recipient / DLP policy — `EMAIL_ALLOWLIST_DOMAINS`, external-send breaks configured
- [ ] Sensitive Storage buckets set `public=false` (query 4 in `live-verification.sql`)
- [ ] Postgres patch version current (check §5 output)
- [ ] Supabase Auth leaked-password protection **ON**
- [ ] Security alert routing: `SYSTEM_ALERTS_WEBHOOK_URL` / on-call PagerDuty

---

## 3. Live database verification (§22.3)

Run every query in [`live-verification.sql`](./live-verification.sql). Save
the outputs to `wp15-evidence/<date>/live-verification-<n>.csv`. Flag:

- Any table in `public|storage|aml` with `rls_enabled=false`.
- Any policy whose `qual` or `with_check` reduces to `true` for non-service roles.
- Any SECURITY DEFINER function granted to `anon|authenticated|public`
  that is not on the approved allowlist.
- Any sensitive bucket with `public=true`.
- Any anon/authenticated grant on tables that carry PII, session material,
  secrets, or ledgers.
- Any `cron.job.command` embedding a plaintext JWT (`bearer eyj…`).

---

## 4. Runtime negative-test matrix (§22.4)

See [`WP15_NEGATIVE_TEST_MATRIX.md`](./WP15_NEGATIVE_TEST_MATRIX.md).

The runner emits one JSON line per test. All rows must have
`result="expected_denial"`. Any `unexpected_allow` is a launch blocker.

---

## 5. Launch criteria (§22.5)

All of the following must be true at sign-off:

- [ ] Overall program score ≥ **90 / 100**
- [ ] Zero open **Critical** findings
- [ ] Zero open **High** findings
- [ ] Zero `needs-review` functions in `supabase/functions-registry/SECURITY_REGISTRY.json`
- [ ] No service-role key in inter-function traffic (grep +
      `check-internal-legacy-fallback.mjs` clean)
- [ ] Sensitive Storage buckets private
- [ ] Object-level Storage authorization verified against WP-06 bindings
- [ ] Every privileged function has an explicit authz test
- [ ] `git rev-parse HEAD` == deployed function version tag ==
      deployed frontend commit == last applied migration ref
- [ ] Postgres + Auth platform settings hardened
- [ ] Independent pentest report attached; findings closed or formally accepted
- [ ] Incident response + key rotation tabletop completed and dated

Sign-off: `Security lead ______________ Date ______________`
