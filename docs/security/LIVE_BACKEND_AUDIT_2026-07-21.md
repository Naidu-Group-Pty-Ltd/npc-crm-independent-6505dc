# Live Backend Security Audit Evidence — 21 July 2026

Read-only audit of the production Supabase project (`dduzbchuswwbefdunfct`,
Postgres 17.4) run as part of the Backend Security Remediation Program
(Appendix B queries + Supabase security advisors). No live changes were made
during this audit; all remediation in this branch is repository-side and must
be applied through the deployment order at the bottom of this document.

## 1. Headline live findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | Critical | `password_reset_tokens` had a `{public}` `ALL` policy with `qual=true` — any PostgREST caller with the (published) anon key could read plaintext reset OTPs | Fix in this branch: policy dropped (phase 7 migration) + OTPs hashed at rest (phase 6 code) |
| 2 | Critical | `notifications` world-readable/updatable/deletable (`qual=true`, `{public}`) | Fix in this branch (phase 7 migration + frontend client change) |
| 3 | High | Storage buckets `client-files`, `email-attachments`, `investment-reports`, `qa_exports` are **public buckets** — objects are fetchable unauthenticated by URL | **Open — requires coordinated change** (see §4) |
| 4 | High | `_shared/auth.ts` trusted decoded JWT claims (forged `role=service_role` / `sub`) in `verify_jwt=false` functions | Fix in this branch (phase 1) — requires function redeploy |
| 5 | High | 70 tables carry `rls_policy_always_true` policies, including `user_roles`, `user_permissions`, `permission_invite_tokens`, `whitelabel_settings`, `activity_logs` | Open — next RLS tranche (see §3) |
| 6 | Error | 3 `SECURITY DEFINER` views exposed via API: `client_portfolio_properties`, `purchase_file_activity_feed`, `v_purchase_file_deal_drift` | Open |
| 7 | Warn | 116 `SECURITY DEFINER` functions executable by `anon`/`authenticated`; 8 functions with mutable `search_path` | Open |
| 8 | Warn | Postgres version has outstanding security patches; Auth leaked-password protection disabled | Open — platform settings |

## 2. Supabase security advisor summary (357 lints)

| Level | Lint | Count |
|-------|------|-------|
| ERROR | security_definer_view | 3 |
| WARN | anon_security_definer_function_executable | 116 |
| WARN | authenticated_security_definer_function_executable | 116 |
| WARN | rls_policy_always_true | 87 (70 distinct tables) |
| WARN | function_search_path_mutable | 8 |
| WARN | public_bucket_allows_listing | 2 (`branding-assets`, `lead-magnets`) |
| WARN | extension_in_public | 2 (`vector`, `pg_net`) |
| WARN | materialized_view_in_api | 1 (`pdf_import_cost_daily`) |
| WARN | vulnerable_postgres_version | 1 |
| WARN | auth_leaked_password_protection | 1 |
| INFO | rls_enabled_no_policy | 20 (deny-all by default — safe, but service-role-only access should be made explicit) |

Remediation reference: https://supabase.com/docs/guides/database/database-linter

## 3. `rls_policy_always_true` tables (next RLS tranche, priority order)

**Priority A (auth/permission surface):** `user_roles`, `user_permissions`,
`permission_invite_tokens`, `password_reset_tokens`*, `notifications`*,
`whitelabel_settings`, `dashboard_modules`.

**Priority B (client data):** `client_deals`, `client_income_sources`,
`client_address_history`, `client_portal_messages`,
`client_portal_notifications`, `finance_agent_contacts`, `game_plans` (+
`game_plan_*`), `generated_reports`, `report_versions`, `activity_logs`,
`api_usage_log`.

**Priority C (reference/cache data — may legitimately stay broad for reads
but not writes):** `*_cache` tables, `suburb_directory`, `schools_directory`,
`land_tax_*`, `deal_stages`, `design_tokens`, `charts`,
`checklist_template_*`, `template_*`, `marketing_*`.

\* fixed by this branch's phase 7 migration once applied.

## 4. Public storage buckets holding sensitive data (open, coordinated fix)

`client-files`, `email-attachments`, `investment-reports` and `qa_exports`
are `public = true`: any object URL is fetchable without authentication.
Flipping them private is the right end state (STOR-004) but will break every
stored `pdf_url`/public link currently persisted in `investment_reports` and
email flows, so it must ship together with:

1. signed-URL generation replacing `getPublicUrl` in the report pipeline
   (`PixelPerfectPDFGenerator` step 8) and portal-share flows;
2. a backfill that rewrites stored public URLs to storage paths;
3. bucket flip `public → private` + cache invalidation.

Until then the secure-storage proxy hardening in this branch limits what the
proxy will do, but direct URL access to already-public objects remains.

## 5. What this branch changes (deploy order)

Per the remediation plan §21.2, deploy in this order:

1. **Migration `20260721000000`** (additive: nonce/security-event tables,
   lockout + attempt columns, `owner_user_id` + backfill).
   ✅ **APPLIED to production 2026-07-21** (as
   `security_phase1_auth_infrastructure`), together with
   `20260721000002_personal_email_owner_backfill` which attributed 111 of
   340 legacy personal-mailbox emails to their owners by exact mailbox
   match (10 ambiguous and 219 unmatched rows remain shared, preserving
   current visibility until the next attribution pass).
2. **Edge functions** (auth.ts fix + hardened functions):
   `secure-storage`, `get-email-data`, `outlook-email-sync`,
   `send-email-reply`, `custom-auth-login`, `client-portal-login`,
   `finance-portal-login`, `admin-password-reset`,
   `client-portal-forgot-password`, `client-portal-reset-password`,
   `finance-portal-forgot-password`, `finance-portal-reset-password`,
   `market-updates-ingest` — plus every function that imports
   `_shared/auth.ts` (shared module is bundled per-function, so a bulk
   redeploy is required for the F-01 fix to take effect everywhere).
3. **Frontend deploy** (NotificationsContext authenticated client).
4. **Migration `20260721000001`** (RLS tightening) — after 2 and 3 are live,
   since the notifications policies assume the JWT-bearing client and the
   email scoping assumes owner stamping is in place.
5. Optional env: set `REQUIRE_TURNSTILE=true` (with `TURNSTILE_SECRET_KEY`
   set) to make CAPTCHA fail closed; set `INTERNAL_EDGE_SECRET` to enable
   the HMAC internal-call envelope; set `RESET_TOKEN_PEPPER` for peppered
   reset-token hashes.

Rollback: migrations are additive except policy swaps; re-creating the prior
policies restores previous behaviour (do **not** re-create the
`password_reset_tokens` public policy — that is the exploitable state the
plan forbids returning to).

## 5b. Deployment progress log — session 2 (2026-07-21, post-Lovable-publish)

The app was published on Lovable. **Verification found the publish deployed the
frontend but NOT the edge functions** — the whole fleet still carries a
`2026-07-20 09:40 UTC` deploy timestamp, before the security merge.

- ✅ **notifications + document_chunks RLS applied live** (`security_phase7_rls_notifications_document_chunks`).
  0 public policies remain; notifications scoped to authenticated broadcast-or-own,
  document_chunks read-only for authenticated + service-role writes. Frontend
  compatible (`NotificationsContext` uses the JWT client; only a `TemplateList`
  chunk-delete is affected, degrading to a harmless no-op).
- 🔴 **Confirmed F-01 exploit live on the un-redeployed fleet, then closed:** a
  forged `service_role` JWT (signed with a wrong secret) was **accepted** by
  `client-portal-invite` (reached invite-creation logic — an account-takeover
  vector). Redeployed via MCP → **v395**; forged token now → 401. The `aml-*`
  functions and the ~10 `verify_jwt=true` functions reject forged tokens
  independently, but an unknown subset of the remaining ~52 `verify_jwt=false`
  functions is still exposed until the fleet is redeployed.
- 🟡 **EmailCopilot frontend fix (PR #1042):** email writes moved to the JWT
  client so the `email_copilot_*` RLS can be applied after republish. NOT yet
  applied.
- ⛔ **STILL REQUIRED (owner):** full edge-function redeploy via Lovable's
  "deploy functions" or `supabase functions deploy`. Lovable *publish* ≠
  function deploy. This is the top open item.
- ⏳ **Pending after republish:** apply `email_copilot_emails` /
  `email_copilot_sent_replies` RLS (remaining part of `20260721000001`).

---

## 5a. Deployment progress log (2026-07-21)

**Applied live:**
- ✅ Additive migration `20260721000000` + `20260721000002` owner backfill (see §5.1).
- ✅ **Critical live DB fix applied ahead of the rest:** dropped the
  `password_reset_tokens` `{public}` `ALL qual=true` policy
  (`security_phase7_drop_password_reset_public_policy`). Verified: 0 public
  policies remain (4 service_role policies intact). Plaintext-OTP exposure to
  anon/authenticated PostgREST callers is closed. This statement is
  idempotent-compatible with the full `20260721000001` migration.
- ✅ **Six hardened edge functions redeployed via MCP** (all smoke-tested;
  each preserved its prior `verify_jwt` setting):
  | function | version | finding | smoke test |
  |----------|---------|---------|------------|
  | `custom-auth-login` | 928 | F-05 lockout + F-01 auth.ts | 400 missing / 400 turnstile ✓ |
  | `secure-storage` | 582 | F-02 Critical bucket policy | anon → 401 ✓ |
  | `get-email-data` | 474 | F-03 Critical email IDOR | anon → 401 ✓ |
  | `client-portal-reset-password` | 390 | F-06 hashed OTP + attempt limit | 400 email required ✓ |
  | `finance-portal-login` | 243 | F-05 lockout | 400 missing ✓ |
  | `finance-portal-reset-password` | 243 | F-06 hashed OTP + attempt limit | deployed ✓ |

  The redeployed `custom-auth-login` smoke test confirmed `TURNSTILE_SECRET_KEY`
  is set in production (CAPTCHA active).

  Note: the deployed reset-password functions dual-read plaintext tokens, so
  they keep working while the *forgot-password* generators still write
  plaintext OTPs. The hashing benefit fully engages once the forgot-password
  functions are also deployed (below).

**Remaining hardened functions — deploy via CLI/Lovable pipeline (exact source, no transcription risk):**
- `outlook-email-sync` (Critical F-03: clear=superadmin, admin-sync gate, owner stamp) — ~680 lines
- `send-email-reply` (High MAIL-005: central-mailbox send gate) — ~590 lines
- `get-email-data` is done, but the *write* side above is not.
- `outlook-calendar` (F-03 targetEmail guard), `admin-user-management` (role canonicalization)
- `admin-password-reset` (F-06 hashed OTP) — pulls brand/passwordValidation deps
- `client-portal-login` (F-05 lockout) — pulls portal email dep
- `client-portal-forgot-password`, `finance-portal-forgot-password` (F-06: hashed token generation, no OTP logging)
- `market-updates-ingest` (F-01 inline verify) — already committed to `main`
- Plus the ~300-function fleet that bundles `_shared/auth.ts` for the F-01 fix.

**Blocked in the current environment (needs the Lovable/CLI pipeline):**
- ⛔ **Full edge-function fleet redeploy.** The F-01 `_shared/auth.ts` fix is
  bundled per-function; ~300 functions carry it. The only deploy mechanism
  here is the MCP `deploy_edge_function` tool, which requires inlining each
  function's full source — not feasible by hand for the whole fleet, and a
  partial deploy cannot close F-01 (an attacker targets any un-updated
  function). This must run from merged `main` via `supabase functions deploy`
  or Lovable. Note: a git merge to `main` does NOT auto-deploy functions
  (confirmed — function versions did not bump after PR #1040 merged).
- ⛔ **Frontend deploy.** The `NotificationsContext` JWT-client change is on
  `main` but the hosted frontend build is deployed by Lovable; there is no
  tool to trigger/verify that static build from this environment.
- ⛔ **Remainder of RLS migration `20260721000001`** (notifications,
  `email_copilot_emails`/`sent_replies` scoping, `document_chunks`). Held
  deliberately: these are coupled to the frontend still using the anon client
  for direct reads/writes (e.g. `NotificationsContext` reads `notifications`;
  `EmailCopilot.tsx` directly updates `email_copilot_emails.status`).
  Tightening to `auth.uid()`-scoped policies before the JWT-client frontend is
  live would break staff notifications and "mark as replied". Apply the full
  `20260721000001` only AFTER the function fleet + frontend are deployed.

## 6. Verification checklist after deploy (acceptance tests)

- Forged JWT (`alg=none`, modified `sub`, `role=service_role`) → 401 on any
  `verify_jwt=false` function using `verifyAuth`.
- Anon-key PostgREST read of `password_reset_tokens` / `notifications` → 0
  rows / permission denied.
- Non-superadmin `outlook-email-sync action=clear` → 403 + `security_events`
  row.
- Cross-user personal `email_id` fetch via `get-email-data` → 404.
- `secure-storage` `publicUrl` on `client-files` → 403; path with `..` → 400;
  6th wrong reset OTP → token invalidated.
- 5 failed staff/client-portal logins → 429 lockout for 15 minutes.
