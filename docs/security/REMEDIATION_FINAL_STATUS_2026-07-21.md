# Backend Security Remediation — Final Status (21 July 2026)

Closes out the NPC Property Dashboard Backend Security Remediation Plan v1.0.
All changes below are **live in production** (`dduzbchuswwbefdunfct`) and tracked
as migrations / merged PRs (#1040–#1045).

## Critical & High findings from the plan — status

| ID | Finding | Status |
|----|---------|--------|
| F-01 | JWT claims trusted without verification | ✅ Fixed fleet-wide. `_shared/auth.ts` cryptographically verifies Bearer JWTs; forged `role=service_role`/modified-`sub` tokens rejected. Verified live across 30+ functions (0 leaks), incl. previously-exploitable `client-portal-invite`. |
| F-02 | Generic service-role storage proxy | ✅ `secure-storage` deny-by-default bucket policy: per-bucket ops, permission-gated upload/delete, path-traversal + active-content blocking, signed-URL TTL cap, publicUrl restricted. |
| F-03 | Outlook/email authorization gaps | ✅ `outlook-email-sync` clear=superadmin + admin-sync gate; `get-email-data` owner-scoped IDOR fix; `send-email-reply` central-mailbox permission gate; email owner backfill. |
| F-04 | JS-readable long-lived tokens | ◑ Partial (HttpOnly cookies exist; full Phase 5 cookie-only migration remains). |
| F-05 | Inconsistent brute-force controls | ✅ Staff + client-portal login lockout parity; timing normalization; fail-closed CAPTCHA option. |
| F-06 | Weak reset/invite tokens | ✅ crypto-random OTPs, SHA-256 hashed at rest, attempt limits, no token logging (staff + both portals). |
| F-07 | RLS & grants | ✅ See below — plus **two critical live vulns found & closed** during this work. |
| F-08 | CORS/errors/secrets/CI | ✅ `.env` untracked, function security registry + CI security gate (registry check, static auth-pattern scan, gitleaks). |

## Two CRITICAL live vulnerabilities discovered during remediation

Both were exploitable with the publishable anon key (which ships in the public bundle):

1. **Unauthenticated privilege escalation** — `user_roles`/`user_permissions`/`permission_invite_tokens`/`dashboard_modules` had full anon+authenticated write grants + `{public} qual=true` policies. An anon `INSERT` reached the FK check, i.e. anyone could grant themselves `superadmin`. Closed (`20260721140000`).
2. **Unauthenticated client-PII read** — anon could read `client_income_sources`, `client_address_history`, `activity_logs` and 7 more. Closed (`20260721141000`).

## F-07 RLS/grant hardening summary

- Priority tables (`password_reset_tokens`, `notifications`, `document_chunks`, `email_copilot_*`) — deny-by-default (`20260721000001`, applied incrementally with frontend-compat changes).
- ~90 `always-true` tables locked down by **verified access pattern** (direct `from()`, realtime `postgres_changes`, `invoke()` mediation, or zero-reference): sensitive/zero-ref tables fully locked; write-tampering closed across the rest (`140000`/`141000`/`150000`/`160000`).
- Realtime message/chat tables (`client_portal_messages/notifications`, `report_qa_*`, `agent_messages`): anon SELECT revoked; staff realtime authenticated via `useAuth` `setAuth`; portal falls back to polling (`170000`). No portal role-elevation (avoids exposing staff mailbox/notifications).
- Function `search_path` pinned (8→0); 3 SECURITY DEFINER views → `security_invoker` (advisor ERROR 3→0).

## Final Supabase security advisor snapshot

**0 ERROR-level findings.** Remaining WARN/INFO are defense-in-depth or platform items:

| Advisor | Count | Disposition |
|---------|-------|-------------|
| rls_policy_always_true | 80 | Policy *shape* lint — exploitable write/read paths already closed by grant revokes; drop the now-moot permissive policies for cosmetic cleanup. |
| anon/authenticated_security_definer_function_executable | 116 → **9** | ✅ Closed (DB-004, `20260721180000`). EXECUTE revoked from PUBLIC/anon/authenticated on all privileged SECURITY DEFINER functions except a reviewed keep-list (5 frontend RPCs + 4 RLS-policy helpers); service_role retains EXECUTE. |
| public_bucket_allows_listing | 2 | `branding-assets`, `lead-magnets` — intentionally public. |
| extension_in_public / materialized_view_in_api | 3 | Hygiene; low risk. |
| vulnerable_postgres_version | 1 | **Owner action**: Postgres security upgrade (Supabase dashboard). |
| auth_leaked_password_protection | 1 | **Owner action**: enable in Supabase Auth settings. |

Advisor: https://supabase.com/docs/guides/database/database-linter

## Follow-up backlog items closed after final status

- **DB-004** — SECURITY DEFINER `EXECUTE` tightening: done (`20260721180000`), 116 → 9.
- **SUPPLY-001** — supply-chain gate: CI `supply-chain` job runs a dependency
  vulnerability gate (`scripts/security/dependency-audit.mjs`, blocks unaccepted
  criticals, allowlist-configurable) and publishes a CycloneDX SBOM artifact. The
  gate surfaced and fixed a real critical (`jspdf` <=4.2.0 → ^4.2.1; golden-render
  byte-stability verified unchanged).
- **OPS-001** — operational runbooks: `docs/security/runbooks/` (incident
  response + key/secret rotation, with the project's real secret inventory and
  auth model).

## Remaining work (assurance phase — owner-run)

- **Independent penetration test + launch-gate sign-off** (Phase 13).
- **Platform settings**: Postgres upgrade; enable Auth leaked-password protection.
- **Optional further hardening**: Phase 5 cookie-only sessions + MFA/step-up;
  drop now-moot always-true policies; ownership-predicate SELECT scoping if portal
  users later get a dedicated DB role; remediate remaining high/moderate
  dependency advisories (now visible via the SUPPLY-001 gate).
