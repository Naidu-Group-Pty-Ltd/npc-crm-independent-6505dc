# The 20-item checklist → control → gate → live test

One row per item. **Control** is what stops it, **Gate** is what stops the
control rotting, **Live test** is what proves the control is in production and
not only in git.

The third column is the one that matters, and the one that is still unproven.
Every other row in this table is source, and source is not deployment: a
function that was never redeployed passes every static gate in this repository.
See [`runbooks/live-negative-tests.md`](./runbooks/live-negative-tests.md).

**14 of the 20 items now have a live row** (WP-26 added six, covering items 5,
10, 16 and 20 — four items that had a gate and no way to ask the deployed
system anything at all). The six without one are the items whose control is a
property of the repository rather than of a running request: no `.env` in git,
no service-role key in the bundle, no string-concatenated SQL, no raw HTML, no
plaintext password column, no unpatched dependency. For those, a static gate is
not a weaker form of evidence — it is the right form.

| # | Item | Control | Gate | Live test |
|---|------|---------|------|-----------|
| 1 | `.env` in GitHub | `.gitignore` (SECR-001); no env file tracked | gitleaks in `ci.yml` + `codex-security-scan.yml`, full history (`fetch-depth: 0`) | — |
| 2 | API keys in front end | Only the publishable anon key ships; no service-role key in `src/` | `check-client-bundle-secrets.mjs` | — |
| 3 | No RLS | ~575 of ~634 tables have RLS; service-role-only is the default posture | `check-migration-security.mjs` (`table_rls`) — **WP-17** | — |
| 4 | Front-end permissions | `_shared/authz.ts` deny-by-default; the browser never decides | `check-admin-authorization-server-side.mjs`, `check-client-portfolio-authz.mjs`, `check-solicitor-intelligence-authz.mjs` | NT-11, NT-38 |
| 5 | No rate limiting | `_shared/authRateLimit.ts` (IP before identifier, unforgeable address header), `publicAbuseControls.ts` | `check-auth-rate-limit-coverage.mjs`, both portal checks | **NT-29** *(opt-in: bills ~30 Places calls)* |
| 6 | SQL string concatenation | No `exec_sql` RPC exists; 401 `.rpc()` calls are named and typed; `EXECUTE format(` is migration-time DDL | `check-baseline-invariants.mjs` — **WP-24** | — |
| 7 | No input validation | `_shared/validate.ts` (zod + size bound in one call); adopted on all 5 unauthenticated data services **and all 27 pre-session auth endpoints** — **WP-20/24/27** | `check-public-validation.mjs` over `public` **and `public-auth`** — 37 functions — **WP-24/27** | — |
| 8 | User content as raw HTML | `dangerouslySetInnerHTML` in 2 files: one DOMPurify'd with a post-pass, one shadcn's typed CSS vars | `check-baseline-invariants.mjs` — **WP-24** | — |
| 9 | Plain-text passwords | `_shared/password.ts`; no plaintext column anywhere | `check-baseline-invariants.mjs` — **WP-24** | — |
| 10 | Auth in local storage | HttpOnly `__Host-session_token` only; `persistSession: false`; `AUTH_VERSION` scrubs legacy mirrors | `check-portal-session-client-storage.mjs`, `check-totp-enrollment-client-storage.mjs` | **NT-30** |
| 11 | Admin panel with no auth | `requireSuperadmin` above 17 named privileged actions | `check-admin-authorization-server-side.mjs` | NT-11 |
| 12 | CORS set to `*` | `createCorsHeaders` allowlist / `withRequestOrigin`; preview origins gated — **WP-19/24** | `check-cors-contract.mjs` (transport tracing **and** registry exposure class) | **NT-37**, **NT-41** |
| 13 | No email verification | `*-verify` flows on all four portals | `check-baseline-invariants.mjs` — **WP-24** | — |
| 14 | Predictable IDs, no ownership check | ~726 UUID PKs; ownership checked before the read | `check-client-portfolio-authz.mjs` | **NT-38** |
| 15 | Saving the whole request body | `pickAllowed` + declared columns (`_shared/amlWritableColumns.ts`, `_shared/assetWritableColumns.ts`, `_shared/clientDataWritableColumns.ts`) — **WP-20/24/25** | `check-mass-assignment.mjs` — **0 sites, baseline 0** | **NT-39** |
| 16 | Webhooks with no signature | HMAC or `clientState` on **every** webhook; each hardened away from "if configured" | `scan-auth-patterns.mjs`, `check-internal-call-signing.mjs` | **NT-27**; **NT-26** *(needs the webhook secret)* |
| 17 | Stack traces in production | `_shared/errorResponse.ts` — opaque body, correlation id, detail to the log — **WP-18** | `check-error-disclosure.mjs` (zero tolerance at 5xx) | **NT-40** |
| 18 | Outdated dependencies | Vendor-patched `xlsx` 0.20.3; Dependabot opens the PRs — **WP-21** | `dependency-audit.mjs` + `check-dependency-gate-level.mjs`, SBOM, osv-scanner | — |
| 19 | No password strength / breach check | 12 chars + 2-of-4 classes + HIBP k-anonymity — **WP-22** | `check-password-leak-coverage.mjs` | — |
| 20 | File uploads with no validation | `_shared/storageAuthz.ts` fail-closed, empty legacy allowlist; uploads backend-mediated | `check-storage-upload-hardening.mjs` | **NT-20**, **NT-21** |

## Where this stands

**All twenty items are closed and gated.** Item 3 is gated for *new* migrations
only; the existing corpus is grandfathered, which is deliberate and recorded in
WP-17.

Items 6, 8, 9 and 13 were closed and held by nothing until WP-24 —
true because of how somebody wrote the code once, with no mechanism to notice the
next person writing it differently. Every one of them now has a rule that fails
on the regression, and a negative test proving the rule fails.

Item 7 was the last genuinely open one. `_shared/validate.ts` had no call sites,
and a helper nobody calls is a plan rather than a control. All five
unauthenticated data services now validate: they were reading their bodies with
a bare `await req.json()` and a TypeScript *assertion*, which checks nothing at
runtime and — on endpoints that need no credentials — imposed no size bound at
all. `check-public-validation.mjs` holds it.

WP-27 extended that to the 31 `public-auth` functions — the pre-session
endpoints, login and reset and invite across four portals. The measurement there
was not "some of them": **all 27 that read a body read it with a bare
`await req.json()`**, three times the number in the class the gate was written
for, in a class reachable exactly as anonymously. The gate now covers 37
functions rather than 9.

The 70 `portal-authenticated` functions remain per-function work. Those sit
behind a session, a CSRF guard and in most cases a size bound already, so they
are a different risk from an endpoint anyone on the internet can post to.

## The one measurement that qualifies every row above

**No edge-function change in this programme is deployed.** Measured on
11 August 2026, not inferred: the most recent deploy of any function on the
project is **05:48Z**, before this session's first merge landed at 06:26Z.

The cause is single and fixable. `deploy-supabase-functions.yml` has no
`SUPABASE_ACCESS_TOKEN`, so every run takes its report-and-stop path — which
stays green by design. On the WP-28 merge commit its `Deploy` step is recorded
as **skipped**.

So items 12, 15, 17 and the edge-function half of item 7 read "closed" above
because the control is in `main` and CI keeps it there. In production they are
whatever was last deployed. Set the secret in Settings → Secrets → Actions and
re-run the workflow; deploying every function is idempotent.

## Three things this table cannot show

**Three deployed auth endpoints had no source in this repository — now they
do.** `custom-auth-login`, `custom-auth-logout` and `custom-auth-verify`
appeared in `SECURITY_REGISTRY.json` and `supabase/config.toml` with nothing
under `supabase/functions/`, and all three are **ACTIVE** on the live project.

Every gate in the table above reads source, so no row described them. That
mattered most for **item 5**: the deploy workflow finds functions by listing
directories, so the v1 trio was frozen at its 31 July bundle while
`custom-auth-login-v2` took twenty-four more deploys — including the one that
added source-keyed rate limiting. Credential spraying against the Command Centre
was one URL away from unlimited.

Closed by **WP-28**: both entrypoints are now one-line shims onto a shared
handler, so v1 has the same rate limiting, body bound and shared bundle as v2,
and cannot drift again. Authored, not yet deployed — the fix reaches production
on the next `deploy-supabase-functions` run, which can now see them.
[`WP28_CUSTOM_AUTH_V1.md`](./WP28_CUSTOM_AUTH_V1.md).

## Two things this table cannot show

**Five migrations are authored and unapplied.** WP-17 and WP-22 ship SQL that
has deliberately not been run — the live database still has 2 ERROR-level
SECURITY DEFINER views, ~96 over-broad EXECUTE grants, and an
`email_copilot_emails` policy that accepts an anonymous insert. Those rows read
"closed" above because the control is written; they are not closed in
production.

**Nothing here has been proven live.** `live_negative_test` is `false` on 29 of
30 tracker findings. Seventeen matrix rows are implemented and the workflow is
wired; it has never been run, because it needs deployed-environment credentials.
Until it is, every claim in this document is a claim about a repository.

That is the one number worth watching. WP-26 raised the implemented rows from
eleven to seventeen and the items with any live coverage from ten to fourteen —
but implemented is not run. Both figures describe what *could* be checked in
about four minutes by somebody with the three secrets, and neither says anything
about production until somebody does.

## Reading this next time

Start with the third column, not the first. If a row has a live test and it has
passed recently, believe it. If it has a gate and no live test, the control is
in the source and CI is keeping it there — which is worth a lot, and is not the
same as the control being in front of your users.

And check the dates on the notes. Twice during this programme a document said an
item was open when it had been closed weeks earlier — the staged RLS-W2
migration and the `investment-reports` bucket. Both cost an afternoon, and both
made the notes that *were* still accurate harder to trust.
