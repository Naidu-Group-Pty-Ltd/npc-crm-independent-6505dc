# WP-16 — The gates that were never run

Phase 0 of the 20-item app-security programme
(`docs/security/TWENTY_ITEM_COVERAGE.md`). Checklist items **5** (rate
limiting), **12** (CORS) and **14** (ownership checks).

## What was wrong

`scripts/security/` held 47 gates. **Twelve were named by nothing** — not
`.github/workflows/ci.yml`, not `package.json`, not another script. They had
been written, reviewed, merged, and then never executed again.

That is worse than not writing them. A gate nobody runs still reads as
coverage: the file exists, the concern looks handled, and the next person greps
for "cors" or "authz", finds a check, and moves on. Meanwhile the thing it
guards drifts freely.

Run by hand for the first time, four failed.

## The four failures

Two were live defects. Two were gates that had gone stale against a refactor —
which is its own kind of failure, because a gate asserting a model the code
abandoned is a gate that will never fail usefully again.

### 1. Credentialed wildcard CORS — a live outage (item 12)

`get-vapid-public-key`, `push-subscribe` and `push-unsubscribe` answered
`Access-Control-Allow-Origin: *` while being reached by `invokeSecureFunction`,
which sends `credentials: 'include'` so the HttpOnly `__Host-session_token`
cookie arrives. The Fetch spec requires the browser to **reject** a credentialed
response carrying a wildcard origin, and to do it opaquely — `TypeError: Failed
to fetch`. So all three had been failing in the browser regardless of what the
function returned. Web push could not be set up at all.

Fixed by wrapping each handler in `withRequestOrigin` (`_shared/corsOrigin.ts`),
which rewrites the origin per request from the same `ALLOWED_ORIGINS` allowlist
every other function uses. This *tightens* the policy — a wildcard becomes an
allowlist — it does not loosen it.

`finance-portal-agreements` was a fourth, milder instance: it spread
`createCorsHeaders(origin)` and then restated `Access-Control-Allow-Headers`
after the spread. The literal wins over the spread, so the copy could only ever
narrow the canonical list, and it already had — it was missing `x-step-up-token`
and `x-portal-request`. Override deleted.

### 2. Solicitor portfolio reads skipped the client permission matrix (item 14)

`solicitor-portal-intelligence`'s `loadVisibleMatters` scoped matters by
`accessibleMatterIds` and `firm_id`, and nothing else.

`listAccessibleMatterIds` has two paths. On the `SOLICITOR_MATTER_ACCESS_V1`
path (the default) it filters each matter through
`can(permissions, 'matters', 'view')`. Its **legacy fallback** — reached when
the flag is set to `false` — returns every matter of every assigned client with
no permission check at all. A solicitor assigned to a client but denied
`matters.view` would have read the whole portfolio through `pipeline_board`,
`portfolio_kpis` and `at_risk_matters`.

The default is safe, so this was a fail-open path rather than an open door. It
is now closed either way: `loadVisibleMatters` resolves the per-client matrix
with `resolveClientPermissions`, keeps only clients granting `matters.view`, and
scopes the query with `.in('client_id', visibleClientIds)` **in addition to**
the matter-level filter. Two independent checks, which is the repo's standing
rule that one access source is never the sole gate (`AGENTS.md` §3).

### 3. Borrowing-capacity authorization — gate drift, not a defect

`check-client-portfolio-authz.mjs` asserts the exact call
`canAccessClient(supabase, actor, clientId)`. `calculate-borrowing-capacity`
inlined the shape as `canAccessClient(supabase, { userId, authMethod }, clientId)`,
so the literal never matched and the gate reported the authorization missing.

The authorization was in fact present and correctly ordered — `verifyAuth` at
:1378, entitlement at :1385, `canAccessClient` at :1398, first client read at
:1434. The fix names the actor once (`const actor = { userId, authMethod }`), as
`get-client-data` and `manage-bc-scenarios` already do, which removes a
duplicated literal and lets the gate keep its exact-match strictness. Exact
matching is what makes these gates hard to fool; loosening the gate would have
been the wrong repair.

### 4. Builder login throttling — gate drift against a security improvement

`scripts/builder-portal/security-check.mjs` asserted that the literal
`check_and_bump_rate_limit` appeared before the account lookup. The function had
since moved onto the shared `enforceAuthRateLimit` helper — which keys on the
platform's unforgeable address header instead of caller-set `X-Forwarded-For`,
and degrades to a per-isolate counter instead of failing open. Strictly better,
and it stopped naming the RPC directly.

So the gate read a security improvement as a regression. The invariant it exists
to protect is the **order** — throttle, then look up, so enumeration cannot
outrun the limiter — and that order was never broken. The assertion now names
`enforceAuthRateLimit(`, matching what
`scripts/security/check-auth-rate-limit-coverage.mjs` already looks for.

## Collateral: four pre-existing type errors

`scripts/security/check-edge-functions.mjs` was failing on `main` before any of
this work, at 430 errors against a committed baseline of 428. Three were real
bugs, and one of them mattered:

- `_shared/agreements/documentHtml.pure.ts:633` read `palette.ink`, which
  `ResolvedReportPalette` has never had — every neighbouring rule uses
  `bodyInk`. At runtime the cover's particulars emitted `color: undefined` and
  silently inherited.
- `partner-agreement-records/index.ts:308` guarded on `markdown.truncated`;
  `MarkdownResult` calls the field `degraded`. The guard was `undefined` on
  every render, so the comment directly above it — *"A clipped legal document is
  worse than no document: fail loudly"* — described something that could not
  happen. A truncated agreement would have shipped silently.
- `update-stamp-duty-rates/index.ts:216` asserted `body?.states` into
  `string[]`. Besides the type error, `{"states":[1]}` reached `.toUpperCase()`
  on a number and took the sweep down with a 500. Now narrowed at runtime.

The fourth was `finance-portal-agreements` importing `supabase-js` from
`https://esm.sh/…` while handing the client to `_shared/finance-portal-session.ts`,
which imports `npm:@supabase/supabase-js@2.55.0`. Same package, same version,
two type identities. Aligned onto `npm:`.

Baseline rebanked at **426** (from 428). Numbers may only go down.

## The gate that keeps this closed

`scripts/security/check-gates-wired.mjs`. Every `scripts/security/check-*.mjs`,
plus the per-portal checks, must be reachable from a workflow — directly, or
through an npm script a workflow runs, resolved transitively so
`npm run security:test` chains count. Deliberate exemptions go in
`UNWIRED_BY_DESIGN` with a written reason, and a stale exemption fails too.

Currently: **41 gates, all reachable, 0 exempt.**

## Verification

```
npm run security:test                                  # 23 gates, all green
node scripts/security/check-gates-wired.mjs            # 41 gates reachable
node scripts/security/check-security-gate-negatives.mjs # 16 controls removed, 16 gates failed
node scripts/security/check-edge-functions.mjs         # 426, at baseline
```

`npm run lint` reports 44 pre-existing errors across 31 files, none of them in
anything this work package touched. They belong to another programme.

## Residual

- `check-cors-contract.mjs` still only forbids a wildcard on functions reached
  by a *credentialed* transport. Roughly 90 functions hardcode `ACAO: *`
  outside that set. Phase 4 (WP-19) takes those.
- The two gate-drift failures (3 and 4) argue for a periodic re-read of every
  literal-matching assertion, not just a green run. A gate that cannot fail is
  indistinguishable from one that passes.
