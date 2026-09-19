# WP-27 — item 7 across the pre-session endpoints

WP-24 closed item 7 for the nine functions classified `public`. The coverage doc
was explicit about what that left:

> Adoption across the 31 `public-auth` and 70 `portal-authenticated` functions
> is still per-function work.

This work package does the first of those two. `check-public-validation.mjs` now
covers **37 functions instead of 9**.

## What the measurement found

Not "some of them". All of them.

    27 of the 31 public-auth functions read a request body.
    27 of those 27 read it with a bare `await req.json()`.

No size limit, and either a TypeScript type *assertion* — which checks nothing
at runtime — or no shape handling at all. That is three times the number of
functions the gate was originally written for, in a class that is reachable
exactly as anonymously.

The four that do not appear: `template-share` reads no body, and
`custom-auth-login`, `custom-auth-logout` and `custom-auth-verify` have no
source on disk (see the last section).

## Why this class is not lower-risk than `public`

These are login, forgot-password, reset-password, accept-invite and verify,
across four portals and the staff console. `public-auth` sounds like a milder
class than `public`. It is the opposite of milder in one specific way: these are
the endpoints an attacker reaches *first*, by design, and the only thing in
front of them is the rate limiter — which is itself keyed off values taken from
the body.

The unbounded read is the part that could not be mitigated downstream. A
handler can `String()` a field it does not trust; it cannot un-read eight
megabytes it already parsed, on an endpoint that asked for no credential to send
them.

## Two treatments, because there were two shapes

**Seventeen** destructure a fixed, small field set directly off the read:

    const { email, password, turnstile_token } = await req.json()

Those get `parseJsonBody` with a schema from `_shared/authBodySchemas.ts` — five
shapes covering login (×4), staff login, forgot-password (×4), reset-password
(×4) and accept-invite (×4). Bounded and shape-checked in one call, which is the
whole design of `validate.ts`: a function that reaches for the size limit and
then forgets the schema is the state this is trying to leave.

**Ten** read the body into a variable and already coerce everything they touch
(`String(body?.op ?? '')`, `typeof body?.action === 'string'`), inside their own
`try`/`catch` or `.catch(() => ({}))`. Those get `readBoundedJson`, which is
`req.json()` with a ceiling and the same failure behaviour. They do not need a
schema; they need the half they were missing.

### The schemas are deliberately permissive

Not `.strict()`, unlike `publicServiceSchemas.ts`, and every field is
`.optional()`.

A locality lookup that receives an unknown key is a caller sending something the
endpoint does not implement, and rejecting it is useful. A **login form** that
receives an unknown key is a client one deploy ahead of the server, and
rejecting it locks people out of the product. Strictness has a different blast
radius in the two places, so it is not the same setting.

Optionality is the same argument. `client-portal-login` answers
`{ error: 'Email and password are required' }` and four different clients read
that string; moving the presence check into a schema would turn it into
`invalid_body` and break them for no security gain. A *missing* password was
never the risk. A password arriving as `{"$ne": null}` was, and that is what
these reject.

## Two bugs found on the way

**`parseJsonBody` dropped the caller's CORS headers on the size-limit path.**
It built the schema-failure 400 with `{...headers}` and returned
`enforceJsonBodyLimit`'s 413 unchanged — and that one comes from
`securityJsonError`, which emits no CORS headers at all. On the data services
nobody would have noticed. On a login form it means the browser is shown a 413
it is not allowed to read, reports `Failed to fetch`, and the user is told
nothing rather than that their request was too large. Now re-clothed at the
`parseJsonBody` boundary rather than in `securityJsonError`, which is shared
with callers that deliberately answer without CORS headers.

**`readBoundedJson` was typed `Record<string, unknown>`.** The better type, and
the wrong one: it made a change about size limits into a typing change as well,
and produced **168 new type errors** across five handlers that had been reading
`body.op` and `body.portal_type` off an `any` for years. Defaulted to `any` to
match `req.json()` exactly, so the substitution is behaviour- *and* type-neutral.
Tightening those five is worth doing on its own, where it can be reviewed as
what it is.

It also throws rather than returning a result object. Every call site it
replaces is inside a `try` that treats a parse failure as "no body", and several
then fall back to a header or cookie for the session token. Returning
`{ok:false}` would have made all of them fall through to the success path with
an empty body — quietly turning a rejected oversized request into an accepted
empty one, which is worse than what it replaced.

## The gate

`UNAUTHENTICATED` in `check-public-validation.mjs` gains `public-auth`. One line;
the gate was already class-driven.

It has its **own** negative-test control rather than relying on the existing one.
The `abs-employment-service` control passes whether or not `public-auth` is in
that set, so on its own it could never have told anyone the extension worked —
widening a set is exactly the kind of change that looks done and does nothing.
`check-security-gate-negatives.mjs` now removes the bounded read from
`client-portal-login` and requires the gate to fail. 30 controls, 30 failures.

## Still open

**70 `portal-authenticated` functions.** Behind a session, a CSRF guard and in
most cases a size bound already. A different risk from an endpoint anyone can
post to, and the next tranche rather than this one.

## ⚠️ Three deployed auth endpoints with no source in this repository

`custom-auth-login`, `custom-auth-logout` and `custom-auth-verify` are listed in
`SECURITY_REGISTRY.json` **and** in `supabase/config.toml`, and have no directory
under `supabase/functions/`. Their `-v2` successors exist and are what the app
calls.

The obvious reading is a stale config entry. It is not that. Read live from the
project on 11 August 2026:

| Function | Status | Last updated |
|---|---|---|
| `custom-auth-login` | **ACTIVE** | 2026-07-31T02:04:31Z |
| `custom-auth-logout` | **ACTIVE** | 2026-07-31T02:04:31Z |
| `custom-auth-verify` | **ACTIVE** | **2026-08-11T05:44:53Z** |

> **Correction (WP-28).** The third row above is wrong. `custom-auth-verify`
> was last deployed 2026-07-31T02:04Z like the other two; the 05:44Z deploy that
> morning was `custom-auth-verify-v2`, misread from the function list. All three
> v1 functions are **frozen at version 16** while their v2 counterparts are at
> 37-40.
>
> That is the worse reading, not the better one. Nobody shipping them is
> precisely the problem: the deploy workflow finds functions by listing
> directories, so these could never be redeployed, and they sat at a 31 July
> bundle that predates the source-keyed rate limiting added to v2. See
> [`WP28_CUSTOM_AUTH_V1.md`](./WP28_CUSTOM_AUTH_V1.md), which also closes it.

All three are deployed and serving.

What that means for every static control in this repository, including the one
this work package just extended:

- No gate here can read them. `check-public-validation.mjs` skips a registry
  entry with no file on disk — deliberately, so a deleted function does not fail
  CI — so these three are invisible to it and to `check-edge-functions.mjs`,
  `scan-auth-patterns.mjs`, `check-error-disclosure.mjs` and the rest.
- `custom-auth-login` is a **staff console login**. Whatever it does with a
  password, nobody reviewing this repository can see it.
- The `-v2` functions were hardened through WP-11/WP-12. There is no evidence
  here that the v1 endpoints were, and a v1 login that still answers is a
  bypass of every improvement made to v2.

Not fixed here — **fixed in WP-28**, which found the answer: they were created
on the project on 30 July, superseded by `-v2` the next day, and predate this
repository's git history, which begins 2026-08-07. Both entrypoints are now
shims onto one shared handler.

**The action is to find out, and it is worth doing before the next tranche of
this programme rather than after.** If they are orphans, remove them from the
project, `config.toml` and the registry. If they are not, get the source into
this repository so the gates can see it — a login endpoint that CI cannot read
is the largest single gap the twenty-item review has turned up, and it is not
one of the twenty items.

## Still open

**70 `portal-authenticated` functions.** Behind a session, a CSRF guard and in
most cases a size bound already. A different risk from an endpoint anyone can
post to, and the next tranche rather than this one.
