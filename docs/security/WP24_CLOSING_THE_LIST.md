# WP-24 — Closing the list

A second pass over all twenty items, asking of each: *is this implemented as far
as it reasonably goes, and is there something holding it there?*

Four items were closed and held by nothing. One was genuinely open. Two things
turned out to be measurably wrong on the live system.

## Item 7 — the one that was actually open

`_shared/validate.ts` shipped in WP-20 with **no call sites**. A helper nobody
calls is a plan, not a control.

The nine functions classified `public` in `SECURITY_REGISTRY.json` are the ones
that matter most: no session, no cookie, no login in front of them. Seven read a
request body, and every one of those did it unbounded:

```ts
const { suburb, state, postcode } = await req.json();
```

A TypeScript type assertion checks nothing at runtime, so this had three
consequences. A non-JSON body threw and answered 500. `{"state": {"$ne": null}}`
reached the handler as an object. And — the one that made this the first place
to fix rather than the tidiest — **`req.json()` reads whatever is sent**, with no
credential required to send it.

All seven are fixed. Five now use `parseJsonBody` with a `.strict()` zod schema
(`_shared/publicServiceSchemas.ts`) at an 8 KiB ceiling; `google-places-autocomplete`
and `request-lead-magnet` already sanitised every field but not the *read*, so
they take `enforceJsonBodyLimit` at 8 and 16 KiB.

The schemas produce a normalised type rather than a union — `postcode` accepts a
number because callers send both and always yields a string. A validator that
hands downstream code a `string | number` has moved the problem, not solved it,
and it broke `school-data-service`'s call into `fetchSchoolDataFromDB` until it
was fixed.

`check-public-validation.mjs` holds it. Adoption across the 31 `public-auth` and
70 `portal-authenticated` functions is still per-function work, and deliberately
so: those sit behind a session, a CSRF guard and a size bound, which is a
different risk from an endpoint anyone can post to.

## Items 6, 8, 9, 13 — closed, and held by nothing

Each of these was in good shape because of how somebody wrote the code once,
with no mechanism to notice the next person writing it differently. Every other
item on the list had a gate; these four had the reviewer's word.

`check-baseline-invariants.mjs` now asserts each, and each has a negative test
that removes the control and requires the gate to fail:

- **item 6** — no generic SQL-execution RPC, no RPC whose *name* is
  interpolated, no migration defining a function that `EXECUTE`s a text
  argument. This codebase is not safe from SQL injection because its queries are
  escaped; it is safe because there is nowhere to send SQL. That property is one
  convenient helper away from gone.
- **item 8** — a new `dangerouslySetInnerHTML` with no sanitiser fails. The two
  existing uses are named with their reasons, and the one that renders external
  mail must keep calling `DOMPurify.sanitize`.
- **item 9** — `_shared/password.ts` must keep using a real password hash
  (bcrypt/scrypt/argon2/PBKDF2 — a fast general-purpose digest is not one), and
  no function may compare a submitted secret against a stored `password` /
  `password_hash` column directly.
- **item 13** — all four portal `*-verify` functions must exist. Deleting one
  would let unverified addresses through that portal only, which is invisible
  until somebody uses it.

## Item 15 — 51 sites to 15

Real fixes, not just accounting: `manage-commercial-data` and
`manage-industrial-data` moved off a three-column denylist onto declared
allowlists (`_shared/assetWritableColumns.ts`), and `aml-finance`'s two writes
now filter through `pickAllowed`.

`industrial_properties` alone has 27 writable columns; the denylist protected
three of them and let a caller overwrite `linked_at`, which is provenance. It
also let `evidence_references.external_url` through unvalidated, past the
absolute-URL check immediately above it.

The rest of the reduction came from the gate getting more accurate. Four
precision faults, all of which had been reporting correct code as mass
assignment:

1. **It read comments as code**, and flagged `_shared/amlWritableColumns.ts` —
   the module whose entire purpose is holding the allowlists — because its
   header quotes the bug it prevents. Same class of fault as the comment that
   satisfied `check-client-portfolio-authz` by restating the call it asserts on.
2. **It resolved the first definition in the file, not the nearest above the
   write.** These handlers multiplex a dozen operations and reuse short names;
   `patch` is declared five times in `aml-risk` alone.
3. **It captured only the rest of the declaring line**, so a ternary between two
   object literals looked like a bare identifier, and the alias-follow then
   chased the *condition* back to `!!body.unverify`.
4. **It treated any `...` as disqualifying**, so `{ ...defaults, name: body.name }`
   — still an allowlist — was reported alongside `{ ...body.alert }`.

Each one mattered in the same way: a gate that reports correct code is a gate
people learn to ignore, and the fastest route to that is being right about
something dangerous while being wrong about five things that are fine.

## Two things confirmed wrong on the live system

Probed against the deployed project, not inferred from source.

**The Lovable preview origins are trusted for credentialed responses right now.**

```
Origin: https://id-preview--7976d60b-…lovable.app
  → access-control-allow-origin: https://id-preview--7976d60b-…lovable.app
```

`lovablePreviewSuffixAllowed` has always been gated behind
`CORS_ALLOW_LOVABLE_PREVIEW` and says production leaves it unset — but the two
*exact* preview URLs sat in the allowlist unconditionally. A page on either host
can read a response carrying the staff session cookie. WP-19 gates them; **NT-41**
is the row that will say whether the fix is deployed.

**`ALLOWED_ORIGINS` cannot be determined from outside, so the fail-closed
change was reversed.**

WP-19 originally made an unset `ALLOWED_ORIGINS` fail closed. Probing a deployed
function with a disallowed origin returns `allowedOrigins[0]`, which is
`command-centre.npcservices.com.au` whether the variable is set to it or the
fallback supplied it. The two states are indistinguishable from outside, and the
repository cannot see the secret.

The problem was never exposure — the fallback is two exact, legitimate
production hostnames, an allowlist rather than a wildcard. It is config hygiene:
a missing variable is invisible, and trust stays pinned to hostnames in source
after the app moves off them. Trading a possible full outage for a hygiene
improvement, on a guess, is a bad trade.

So it stays available and gets loud. `CORS_STRICT_ALLOWED_ORIGINS=true` opts into
failing closed once the operator has confirmed the variable is set, and NT-41
prints the observed allowlist head so it can be compared against what they
configured.

## Verification

```
npm run security:test                                   # 26 gates, green
node scripts/security/check-security-gate-negatives.mjs # 29 removed, 29 failed as required
node scripts/security/check-edge-functions.mjs          # 381 (was 430 at the start of this programme)
node scripts/security/check-mass-assignment.mjs         # 15 (was 51)
node scripts/security/check-public-validation.mjs       # 9 functions, all bounded
npm run build && npx vitest run src/lib/auth src/lib/client-fact-find   # 98 passed
```

The type-check baseline fell again — `wp09Guards.sha256Hex` was passing a
`Uint8Array<ArrayBufferLike>` to WebCrypto, which rejects a `SharedArrayBuffer`
view, and `school-data-service` had two implicit-`any` comparator parameters.
Both are now fixed rather than baselined.

## What remains, honestly

- **Two migrations are authored and unapplied.** The live database still has 2
  ERROR-level SECURITY DEFINER views, ~96 over-broad EXECUTE grants, and an
  `email_copilot_emails` policy that accepts an anonymous insert.
- **Nothing has been proven live.** The negative-test workflow is wired, extended
  to eleven rows, and has never run — it needs three secrets on a
  `production-verification` environment.
- **15 mass-assignment sites** remain, capped by a baseline. Each needs a
  per-table decision about which columns are legitimately writable.
- **Two owner actions**: enable Auth leaked-password protection, and take the
  Postgres 17.4.1.074 security upgrade.
