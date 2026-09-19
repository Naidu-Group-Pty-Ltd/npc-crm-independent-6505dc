# WP-29 — the validation schemas took four of the five logins down

WP-27 put zod schemas in front of every pre-session endpoint. They shipped, and
sign-in stopped working across the product.

```
custom-auth-login-v2   400  {"error":"Invalid request","code":"invalid_body","fields":["turnstile_token"]}
custom-auth-verify-v2  400  {"error":"Session token is required","valid":false}
```

## Root cause

`z.string().optional()` accepts `undefined` and **rejects `null`**.

In TypeScript those are two different absences. Over JSON they are the same one,
and which a caller sends is decided by how its form state happens to be typed.
Every login form here holds its CAPTCHA token as `useState<string | null>(null)`
and passes it through unconditionally, so the body on the wire is
`"turnstile_token": null`.

The second error is downstream of the first: no login → no
`__Host-session_token` cookie → `checkSession` gets a 400 → `clearAuthState()`
→ blank screen (`src/hooks/useAuth.tsx:229`).

**The rule this cost us:** a validator placed in front of a handler inherits
responsibility for everything that handler used to tolerate. These endpoints
never rejected a null optional field — `turnstile_token` was not even read
unless `TURNSTILE_SECRET_KEY` was set — so the schema must not either. It ran
before the handler's own tolerance and was stricter than it.

### Blast radius

| Endpoint | Caller |
|---|---|
| `custom-auth-login-v2` (staff) | `src/hooks/useAuth.tsx:359` |
| `client-portal-login` | `src/hooks/usePortalAuth.tsx:110` |
| `finance-portal-login` | `src/hooks/useFinancePortalAuth.tsx:221` |
| `solicitor-portal-login` | `src/hooks/useSolicitorPortalAuth.tsx:55` |

`builder-portal-login` survived by accident: `src/lib/builderPortal.ts:144`
spreads the key conditionally.

Already live on the reporting path too —
`generate-investment-report/index.ts:2255` sets `postcode` to `null` when an
address has no four-digit postcode, and posts it to `crime-statistics-service`,
`abs-employment-service` and `climate-data-service`; `school-data-service` (two
call sites) and `public-transport-service` take the same nullable values.

## The fix

`_shared/schemaHelpers.ts`:

```ts
export const optionalField = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());
```

Applied to all 21 optional fields across `authBodySchemas.ts` and
`publicServiceSchemas.ts`.

`z.preprocess` rather than `.nullish()` deliberately: `.nullish()` widens the
parsed type to `T | null | undefined` and would ripple through seventeen
handlers. This keeps it `T | undefined`, so a null-tolerance fix stays one.

**Nothing else was relaxed**, which is the whole point:

| Input | Before | After |
|---|---|---|
| `{"password": {"$ne": null}}` | rejected | **still rejected** — an object is not `null` |
| `{"password": [null]}` / `123` / `true` | rejected | **still rejected** |
| oversized body | 413 | unchanged |
| unknown key on a `.strict()` schema | rejected | unchanged |
| `null` in a **required** field | rejected | **still rejected** |
| `{"password": null}` | rejected | absent → the handler's own 400 |

Only the last row moved, and it restores the pre-WP-27 contract.

`parseJsonBody` now also logs `[validate.invalid_body]` with the failing field
names — **fields only, never values**, the same rule the response body follows.
This outage was invisible in the logs; one line names it in seconds.

## What actually let this happen

Three things, and the third is the one worth keeping.

**1. Every control in this programme tests the wrong direction.**
`check-security-gate-negatives.mjs` removes a control and requires the gate to
go red. That is right for a gate and blind here: nothing proved a schema
*accepts legitimate traffic*.

`src/lib/security/requestSchemas.spec.ts` is that missing measure. Each payload
is transcribed from a real call site, cited by file and line, **including its
nulls** — a payload invented to match the schema tests nothing, because the
schema was written to match an invented payload. Both directions are asserted:
the real body parses, and injection still does not. Reverting `optionalField`
to `.optional()` fails 11 of its cases.

**2. `src/lib/security` ran in no workflow at all.** Eight specs, ~82
assertions, executed by nothing — the WP-16 defect (a gate nobody runs) in the
other half of the suite. Now wired into `verify`.

Turning it on found four specs red:

- **two from the WP-28 shim** — `accountLockoutRecovery` and
  `crossPortalSessionIsolation` read entrypoint source as text, and the handler
  had moved to `_shared/customAuth/`. The same relocation broke two CI gates,
  which I fixed at the time; these broke silently beside them.
- **two already red** — `financePortalClientCommsAuth` and
  `solicitorPortalSessionTransport`, both stale against refactors. Checked
  before touching: every control is intact.
  `purchase_file_client_mismatch` became `purchase_file_access_denied` inside
  `validatePurchaseFileScope`, and the solicitor cookie is still set — the
  arguments were renamed by `issueSolicitorSession`. One assertion got
  **stronger**: WP-11A moved solicitor sessions to hash-only storage, so
  `session_token: sessionToken` now appears zero times rather than once, and
  the spec had been permitting the plaintext write it no longer does.

**3. `check-edge-functions.mjs` fails open.** Diagnosing this, `deno check` hit
`error: Import '...' failed: 408 Request Timeout` — and the gate reported
**0 errors across 421 entry points** and passed. `--update` would have banked
that zero, freezing a gate that checks nothing into the repo as a perfect score.
It was one command from happening.

Its `RESOLUTION_FAILURE` guard already existed and had the right comment; it
just has to predict how Deno phrases each failure, and it had not seen this one.
Replaced with a structural check — deno exited non-zero **and** nothing was
parsed out means it did not run — which needs no such prediction.

## Verification

- `npx vitest run src/lib/security` — 82 pass across 8 files; 11 fail if
  `optionalField` is reverted.
- All 43 wired gates, `security:registry`, `security:static`, inventory: clean.
- `check-security-gate-negatives.mjs` — 31/31.
- Also fixed: `update-stamp-duty-rates` returned the caught exception on a 500
  (arrived on `main` with #2041, red on `check-error-disclosure`).

---

## Addendum: `main` could not install at all

Pushing the fix above turned **all four CI jobs** red inside sixty seconds —
`verify`, `security`, `supply-chain` and `render-container` — none of them for
anything in the diff:

```
npm error The `npm ci` command can only install with an existing package-lock.json or
npm error npm-shrinkwrap.json with lockfileVersion >= 1.
```

The file was present and began `"lockfileVersion": 3`. It was **unparseable**:
a bad splice at line 20626 interleaved the `postcss-load-config` entry with a
`radix-ui` one, so `postcss-load-config`'s `funding` array contained an
`@types/react-dom` key and its `lilconfig` dependency ended up inside a
`@radix-ui/react-dropdown-menu` entry.

That message is worth remembering, because it names the wrong problem: it reads
as "the lockfile is missing" when the lockfile is merely broken.

`origin/main` carried the identical corruption at the identical byte offset —
this was not local. It has happened before: **#2038 "Restore a
package-lock.json that npm can parse"** landed earlier the same day, and the
next sync re-corrupted it.

### And a second, separate fault underneath it

Regenerating did not work either:

```
npm error Could not resolve dependency:
npm error peer react@"^19.0.0" from react-leaflet@5.0.0
```

Dependabot had raised `react-leaflet` 4.2.1 → **5.0.0**, a major requiring React
19 against a project pinned at React 18, and it merged. So even a
byte-perfect lockfile could not have been produced from this `package.json`. The
map component would have been broken at runtime too, silently, until somebody
opened it.

Pinned back to 4.2.1 and regenerated; `npm ci` now succeeds.

### The gate

`.github/dependabot.yml` already refuses majors for `react` and `react-dom`, and
that does not help — the danger is not React moving, it is something moving
*past* React. **50 direct dependencies declare a React peer** (the whole Radix
set, TanStack, framer-motion, recharts, tldraw, sonner, cmdk). A list of names
is wrong the moment somebody adds the 51st.

`scripts/security/check-peer-compatibility.mjs` asks the question instead of
maintaining the answer: for every direct dependency naming a `react` peer, the
range must admit the pinned major. It reads the peer ranges out of
`package-lock.json`, so it needs no `node_modules` and runs in any job, and it
fails on the exact bump that broke `main`. It also reports an unparseable
lockfile in those words, with the regeneration command, rather than letting npm
say the file is missing.

Gates 46 → 47; negative-test controls 31 → 32.

---

## Addendum 2: the type-check gate had been blind for days, and something walked through

Point 3 above ends with the edge type-check failing closed instead of open. It
then failed closed on **every run, on every branch, including `main`**, for the
same specifier:

```
error: Import 'https://esm.sh/@supabase/storage-js@2.99.3/dist/module/StorageClient' failed: 408 Request Timeout
```

That reads as an outage. It is not one. **It is permanent, and it had been
misdiagnosed three commits running** — one to widen the resolution guard, one to
retry with backoff, one to warm a module cache. All three treated a missing file
as a slow server.

### What is actually broken

`@supabase/supabase-js@2.55.0` — imported by **184 of the 421 entry points** —
ships this in its own declarations (`dist/module/lib/types.d.ts:4`):

```ts
import { StorageClientOptions } from '@supabase/storage-js/dist/module/StorageClient'
```

a deep import into a subpath of a dependency it pins only as a **range**,
`^2.10.4`. storage-js has since been restructured to a flat bundle: `2.99.3`
ships `dist/index.d.mts` and `dist/index.d.cts` and **no `dist/module/`
directory at all**. The subpath those declarations reach for does not exist in
the version the range resolves to.

esm.sh resolves that range at build time, rewrites the specifier to a URL under
`/@supabase/storage-js@2.99.3/dist/module/`, and its build service then **hangs
on the missing file rather than returning 404** — every request answers `408`
after ~30s, indefinitely. `deno check` follows `x-typescript-types`, so it
inherits the hang.

Nothing in this repository is wrong, and nothing in this repository could fix it
by waiting.

### The repair

`scripts/security/edge-typecheck.deno.json` — passed explicitly via
`deno check --config`, deliberately **not** named `deno.json` so no other Deno
invocation and no deploy can discover it. One mapping, from the specifier
upstream got wrong to the **same package at the same version's real
declarations**, which do export `StorageClientOptions`.

The evidence that this is a repair and not a relaxation is the number: the gate
now reports **421 entry points, 376 errors, baseline 376**. Not one file's count
moved. A weakened check would have reported fewer.

### And a second blocker underneath it

With that fixed, the gate got further and stopped again:

```
Could not find npm package '@lovable.dev/mcp-js' matching '0.26.2'.
A newer matching version was found, but it was not used because it was newer
than the specified minimum dependency date of 2026-08-10 …
```

Deno 2.9 refuses npm packages published in the last 24 hours. That is a good
default at the wrong control point. `supabase/functions/mcp/index.ts` is
**generated** by a Lovable sync that pins the version it has just published, so
the pin is always fresh and the gate would be red for a day after every sync —
reporting a supply-chain concern while the type errors it exists to catch went
unreported.

Decisive: **the same sync deploys that dependency to production, and no deploy
path applies an age policy.** Blocking the type-check delays the type-check, not
the dependency. Dependency risk is owned by the `supply-chain` job, Dependabot,
GitGuardian and gitleaks, and still is; the flag is scoped to this one
invocation.

### What the blindness cost

A syntax error on `main`. `update-stamp-duty-rates/index.ts` had an import
landed **inside an open multi-line import block**:

```ts
import {
import { internalError } from '../_shared/errorResponse.ts';
  AUSTRALIAN_STATES,
```

That function cannot parse, so it cannot boot. It arrived in **#2043 — this work
package's own fix** — and stayed, because the one gate that reads every entry
point had been unable to run since around the same day. Two failures
compounding: the gate went blind, and the next thing past it was a hard error it
was built to catch.

**Production was not affected**, which is worth stating precisely rather than
assuming in either direction. The deployed copy (`update-stamp-duty-rates`
v105, redeployed the same morning) carries the import correctly placed on its
own line — so whatever deploys this project repaired the ordering on the way
out and never wrote the repair back to git. The repository was the broken copy,
and it is the one the next deploy from git would have shipped.

Swept for the class rather than the instance — every `.ts` under
`supabase/functions`, looking for an `import` statement inside an unclosed
import block. One occurrence, the one above.

Fixing it revealed the type error underneath, which was also real:
`body?.states` is `unknown` off a `Record<string, unknown>` body and was
*asserted* to be `string[]`. `{"states": "NSW"}` reached `.map` on a string and
threw a 500; a non-string element reached `.toUpperCase()` and did the same.
Now narrowed, and still filtered against `AUSTRALIAN_STATES`, so no caller can
widen the set.

### Two smaller things the diagnosis exposed

**The gate described faults it could not be acted on.** It printed only lines
beginning `error:`, which is right for a resolution failure — those name the
specifier — and useless for a syntax error, where the file, the line and the
offending token are all on the *indented* lines beneath. It reported
`SyntaxError: Expected ',', got '{'` against a tree of 421 entry points and said
nothing about where. It now prints the whole block up to the stack trace.

**The module cache could never be seeded during the outage it exists to
survive.** `actions/cache` writes in a post step that runs only when the job
**succeeded**. The fetch failed, the job went red, nothing was saved, and the
next run started cold — every time. Split into `restore` + `save` with
`if: always()`, so a partly-fetched cache is banked and each attempt starts
warmer than the last. Guarded against the opposite mistake too: an **empty**
cache must never be written, because a key is writable once and an exact hit
does not consult `restore-keys`, so an empty entry would freeze that tree state
cold permanently.

### The rule

**A fault that never resolves is not transient, however much it looks like
weather.** Retry, backoff and caching all encode a belief that waiting helps. If
a retry exhausts on the same specifier run after run, that belief is wrong, and
every further commit spent shortening the window is a commit not spent reading
what is actually being fetched.
