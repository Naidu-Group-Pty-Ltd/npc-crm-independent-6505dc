# `verify_jwt`: what the gateway actually checks

Read this before changing a `verify_jwt` line in `supabase/config.toml`, the
deploy workflow's changed-function list, or any function's own auth check.

## The one-line rule

**An omitted `[functions.X]` block is not "no opinion" — the CLI reads it as
`verify_jwt = true`, which asserts the gateway is checking a Supabase JWT in
front of that function.** On 15 August 2026 that assertion was wrong for 91 of
425 functions, and `check-verify-jwt-declared.mjs` now fails CI on a function
with no explicit declaration.

## A preflight is not a `verify_jwt` probe

This is the misreading that produced almost every wrong conclusion in this area,
twice, in the same week.

A CORS preflight carries no `Authorization` header by specification. The obvious
inference — that a JWT-guarded function must therefore refuse its preflight — is
**false**. The gateway exempts `OPTIONS` and enforces the JWT on the real
request; if it did not, no guarded function could be called from a browser at
all.

Measured, by contrast, on one function:

| request to `sqm-rent-service` (deployed `verify_jwt = true`) | answer |
| --- | --- |
| `OPTIONS` preflight | `200`, exact origin, credentials — **the function's own headers** |
| unauthenticated `POST` | `{"code":"UNAUTHORIZED_NO_AUTH_HEADER"}` — **the gateway** |

All 86 functions deployed with `verify_jwt = true` answer their preflight.

Two consequences worth keeping:

- **`UNAUTHORIZED_NO_AUTH_HEADER` is the gateway's string, not ours.** It
  appears nowhere in this repo, which is how you tell the two apart: if your
  unauthenticated request reaches the *function's* error message, there is no
  gateway guard in front of it.
- **A 503 on a preflight is more likely a boot failure than a refusal.**
  `legal-matters-admin` answered 503 because it could not load its module, and
  that was misattributed to the gateway. See `check-edge-functions.mjs`.

To read the deployed value, ask the Management API (`list_edge_functions`) —
never a probe.

## How the drift happened

`config.toml` is in the deploy workflow's `on.push.paths`, so editing it
**triggers** the workflow. But the changed-function list was built entirely from
`supabase/functions/**` paths, so a config-only push produced an **empty** list
and deployed nothing. A declaration then sat unapplied until that function's
source happened to change for some unrelated reason.

So the file could say anything and production would not hear about it:
`agreement-centre-render` read `true` and was deployed `false`.

`scripts/deploy/verify-jwt-changed.mjs` closes it — the workflow now diffs the
**declarations** (not the file text, which would redeploy on a comment edit and
miss a deletion) and redeploys every function whose value changed.

## What it cost

`finance-portal-snoozes` has a `run_due` cron branch that returns before the
partner-session check. Its comment read *"callable without partner session
(cron + service)"* — the author took the gateway JWT to be standing in front of
it. Nothing was. An unauthenticated `{"operation":"run_due"}` from anywhere on
the internet reached the branch and ran it under the service client.

It now verifies the HMAC that `public.cron_invoke_signed_function` signs every
scheduled invocation with. **Read the caller name off the live schedule** — every
job sends `pg_cron`. `resume-bulk-generation` and `resume-investment-reports`
each allow-list a bespoke caller name that no job sends, and therefore reject
every invocation they receive.

The risk runs the other way too, and `config.toml`'s own `[functions.mcp]` block
records it: that function had no entry either, and the first deploy to apply the
default *"would otherwise have silently flipped a working endpoint to true and
broken every MCP client"*. An undeclared function is a working endpoint waiting
for a deploy to break it.

## Choosing the value

- **`false`** — the function authenticates its own callers (the app's HttpOnly
  `__Host-session_token` cookie via `verifyAuth`, a portal session token, or a
  signed-internal HMAC), or it is called from a browser at all. A browser
  holding this app's cookie has no Supabase JWT to present, so the gateway check
  could only ever reject it. This is the majority: 339 of 425.
- **`true`** — the Supabase JWT genuinely is the credential, and no browser calls
  it directly. `sqm-rent-service` is the model: server-to-server only, invoked by
  `generate-investment-report` with an explicit bearer token.

`false` is not "unauthenticated" — it moves the check from the gateway into the
function, which is the only place that can see this product's own sessions. It
is only dangerous when a function then checks nothing, which is exactly what
happened above.
