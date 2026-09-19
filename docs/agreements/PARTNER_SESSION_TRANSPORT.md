# Why the Finance Partner Portal was empty

> Read this before touching `_shared/financeSessionToken.ts`,
> `_shared/finance-portal-session.ts`, or any `finance-portal-*` function's
> token extraction. `scripts/security/check-finance-session-transport.mjs`
> enforces the rule mechanically.

## The report

> The Finance Partner is still not receiving the agreement within the Finance
> Partner Portal after it has been confirmed and issued from the Command
> Centre.

Three previous rounds looked at delivery, at synchronisation and at the
register's filtering. All three found real defects and fixed them, and none of
them was **this** one, because every measurement taken was of the *issuer's*
side and of the *database*, both of which were correct throughout.

## The measurement that found it

The Command Centre showed *"Opened by the partner — Delivery is confirmed"* and
logged *"Agreement viewed by Arweeeeen"*, followed by three `Sent to…` events —
somebody re-sending because the partner still could not see it. That pattern
says the agreement is reachable by **direct link** but absent from the
**list**, and those are different code paths.

The Edge Function log settled it. Every call a partner made to
`finance-portal-agreements`:

| | |
| --- | --- |
| Status | **401** |
| Request body | **20 bytes** — `{"operation":"list"}`, i.e. **no token fields** |
| Response body | **54 bytes** |
| Cookie on the request | `__Host-finance_session_token=19d9bcea-60…` |

And that cookie is a live session: the row for `arvinraj2829@gmail.com` carries
exactly that token, `session_expires_at` in the future, `is_active` true,
`revoked_at` null.

Reproduced against production with curl:

| Request | Status | `content-length` |
| --- | --- | --- |
| No credential at all | 401 | **54** |
| Bogus token in the **header** | 401 | 47 (`Invalid session`) |
| Bogus token in a **cookie only** | 401 | **54** |

**A cookie-only request is byte-identical to sending no credential at all.**
The server was discarding the cookie.

## The cause

WP-11B/C moved the Finance Portal's session into an HttpOnly
`__Host-finance_session_token` cookie and deliberately stopped mirroring it
into browser storage. From `useFinancePortalAuth.tsx`:

```ts
// WP-11B/C — finance portal session token lives only in the HttpOnly
// `__Host-finance_session_token` cookie once the login response sets it.
// We keep an in-memory copy for legacy header/body fallbacks during rollout;
// no localStorage/sessionStorage mirror is persisted.
let inMemoryFinanceSessionToken: string | null = null;
```

**That in-memory copy does not survive a page load.** `invokeFinanceFunction`
attaches the `x-finance-session-token` header and the body token *only if* the
in-memory copy exists, so after any reload — or in the fresh tab the partner
gets from clicking the emailed link — the session rides on the cookie alone.

The cookie-aware reader (`_shared/financeSessionToken.ts`) already existed and
was wired into `finance-portal-verify` and `finance-portal-logout`. **It was
never wired into the data functions.** `extractFinanceToken` in
`_shared/finance-portal-session.ts` was four `??`s over two headers and two
body fields, and could not see a cookie.

That asymmetry is exactly why this survived three rounds of investigation:

- the session **check** read the cookie → the portal looked signed in;
- every **data** call did not → every data surface was empty;
- `first_viewed_at` was set by the one call that ran while the token was still
  in memory, one minute after login — which is why the Command Centre honestly
  reported delivery confirmed.

## The fix

**One reader.** `extractFinanceToken` delegates to `extractFinanceSessionToken`.
Header first, then body, then cookie — so every path that worked before still
works, and the cookie is picked up when they are absent. The Command Centre's
`__Host-session_token` is still refused as a finance credential.

**The sweep.** **34** `finance-portal-*` functions are now cookie-aware, up
from 2, and the baseline is empty. The first pass converted 26 mechanically —
each local `extractToken` keeps its name and signature and delegates its body,
so no call site moved — and `finance-portal-commissions` read
`body.finance_session_token` only and needed its own change.

The remaining **8 resolved the session inline** rather than through a named
helper, which is why a pattern-matching sweep could not see them
(`batch6/7/8/9-10`, `client-tasks`, `lender-packet`, `messages`,
`settlement-runway`). Each was converted individually after reading its actor
model, because two are not single-actor:

- **`finance-portal-client-tasks`** also carries a CLIENT portal token
  (`x-portal-session-token`). Only the finance one was changed. Its branch is
  chosen by *operation* (`FINANCE_OPS`), not by credential, so the cookie is
  unambiguous there.
- **`finance-portal-messages`** serves partner, client **and** staff, and
  already carried an explicit-credential-first rule — see the CSRF section
  below for why that made it the delicate one.

Seven of the eight had no CSRF guard at all, because none of them had ever
honoured a cookie. Each gained the per-source guard. `messages` already
enforced CSRF unconditionally at the top of its handler, so it needed only the
cookie read.

**A guard, because review cannot catch this.** A local six-line `extractToken`
reading two headers looks perfectly reasonable on its own; it is only wrong in
the context of where the session lives, which is in a different file.
`check-finance-session-transport.mjs` fails when a `finance-portal-*` function
that authenticates a partner cannot see the cookie. Its `BASELINE` records the
8 still unconverted and **can only shrink** — a new offender fails, and a fixed
one must be removed from the baseline rather than left as a false record.

## CSRF: the part that must not be got wrong

The cookie is `SameSite=None; Secure; HttpOnly` — it has to be `None`, because
the portal and the Edge Functions are different origins. **So the browser
attaches it to cross-site requests too.** Honouring a cookie that was
previously ignored therefore creates ambient authority that did not exist
before: without a guard, an attacker's page could drive `accept` or `sign` from
a signed-in partner's browser.

`extractFinanceCredential` reports **where the credential came from**, and
`finance-portal-agreements` applies `enforceCsrf` exactly when the source is
`cookie`:

- a cross-site page **cannot** set `x-finance-session-token`, so header auth has
  no ambient authority to defend and guarding it would only break non-browser
  callers;
- `csrfGuard.ts` states the same rule for itself and bypasses when no cookie is
  present.

### The trap in `finance-portal-messages`

That endpoint resolves three actors, and it already carried a hard-won rule: a
credential **deliberately presented for this portal** outranks an
**ambiently-attached cookie**. It was written because a broker signed into the
Command Centre in the same browser had their finance token discarded — the
staff cookie rode along on `credentials: 'include'` and won.

The finance session cookie is ambient in exactly the same way. Reading it
alongside the explicit tokens would have re-created that bug with the actors
reversed: a staff user, or a client-portal user, silently re-attributed to
`partner` because a finance cookie happened to be attached.

So in that one function the cookie is the **only** credential that is gated,
and it is gated on every other actor having been ruled out first:

```ts
const isStaffCaller = !explicitFinanceToken && !portalToken && (hasStaffCookie || !!commandCentreToken);
const financeCookieToken = (!explicitFinanceToken && !portalToken && !isStaffCaller)
  ? extractFinanceSessionToken(req.headers, body)
  : null;
const financeToken = explicitFinanceToken ?? financeCookieToken;
```

`crossPortalSessionIsolation.test.ts` pins both halves — the original rule and
this ordering.

## Rules

- **There is one reader.** Resolve a finance session through
  `_shared/financeSessionToken.ts`. Never hand-roll header lookups — that is
  the bug, and the guard will fail the build.
- **Header, then body, then cookie.** Preference order is load-bearing: it keeps
  every previously working caller on its existing path.
- **Cookie source implies a CSRF guard on the function.** If you make a function
  cookie-aware, apply `enforceCsrf` for that source.
- **A staff cookie is never a finance credential**, and vice versa —
  `crossPortalSessionIsolation.test.ts` pins this.

## What this did not change

No migration, no lifecycle transition, no status value, no RLS policy, no
notification, no email, no render, no storage path, and no change to what any
function *does* once authenticated. The only behavioural change is that a
request carrying a valid session cookie is now authenticated instead of
rejected.

## See also

- [`CONTINUITY.md`](./CONTINUITY.md) — the register's stage filter, and why an
  issued agreement stopped appearing on the issuer's side
- [`SYNCHRONISATION.md`](./SYNCHRONISATION.md) — the polled cursor keeping both
  portals current
- [`SENDING.md`](./SENDING.md) — the notification feed's own three-week outage,
  a different fault with the same symptom
