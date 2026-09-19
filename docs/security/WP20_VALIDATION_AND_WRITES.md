# WP-20 — Validate the body; write only declared columns

Phase 5 of the 20-item app-security programme. Checklist items **7** (no
server-side input validation) and **15** (saving the whole request body), plus
the ownership half of **14**.

The two compound. An unvalidated body spread into an update is how a column
nobody named gets written.

## Item 7 — validation

`zod` has been a production dependency for a long time and appeared in **2 of
419** edge functions. What *is* systematic is the envelope: `requestSecurity.ts`
bounds body size nearly everywhere, and `scan-auth-patterns.mjs` rule R4 stops a
trust decision being derived from a body field. Both are real. Neither looks at
the contents.

That gap has already cost something. `update-stamp-duty-rates` asserted
`body?.states` into `string[]` and then called `.toUpperCase()` on each element,
so `{"states":[1]}` took the sweep down with a 500 — fixed in WP-16 when the
type-check surfaced it.

`_shared/validate.ts` makes the size bound and the shape check one call:

```ts
const parsed = await parseJsonBody(req, Body, corsHeaders);
if (!parsed.ok) return parsed.response;
const body = parsed.data;
```

Two calls is one too many — a function that reaches for `enforceJsonBodyLimit`
and forgets the schema is exactly the state this is trying to leave.

On failure the caller is told **which fields** were wrong and nothing else.
Naming the field is what makes the error actionable; echoing the value back is
how a validation message becomes a reflection gadget, and quoting the expected
type of an internal field describes the schema to whoever is probing it.

`parseValue` covers the dominant shape here — one endpoint multiplexing
operations, where the thing to validate is `body.alert` rather than the request.

The module deliberately does **not** decide what a caller may write. A body of
the right shape can still name a column no request should set. Shape and
authority are different questions, and conflating them is how a schema ends up
doubling as an access-control list.

## Item 15 — mass assignment

90 write sites derive from a request body. Most are already laundered — this
repo has `pickAllowed` (in `_shared/wp09Guards.ts`), `pickKnownColumns`,
`pickEditable`, `buildMatterPayload`, `buildDocumentPayload`,
`normaliseTemplatePayload`. The finance portal in particular does this properly
throughout.

The unlaundered remainder concentrates in AML, and it is the sharpest instance:

```ts
const a = body.alert ?? {};
aml.from('alerts').update(a).eq('id', a.id)
```

Every column the caller named got written. In `aml.alerts` that reaches
`resolved_by`, `resolved_at` and `resolution_note` — the record of who closed an
alert and when, which `resolve_alert` is supposed to stamp from the verified
session. One operator could record another as having closed an alert.

These sit behind `requireWrite()` and MLRO gates, so it is not an anonymous
hole; it is an authorised user reaching past the workflow. In an AML file that
matters more than usual, because `AGENTS.md` §2 treats that trail as evidence.

**Fixed here** — five writes, now filtered with the existing `pickAllowed`:

| Function | Table |
|---|---|
| `aml-monitoring` | `aml.alerts`, `aml.monitoring_rules` |
| `aml-risk` | `aml.risk_factors`, `aml.mandatory_triggers` |
| `aml-transactions` | `aml.transaction_parties` |

The column sets live in `_shared/amlWritableColumns.ts`, read from
`information_schema.columns` on the live project minus the identity and audit
columns no request may set, then narrowed further where a column belongs to a
different operation — which is why `ALERT_WRITABLE` has no `resolved_by`.

Adding a column to a table does not add it there. That is the point: a new
column is not writable from a request body until somebody decides it should be.

**Not a denylist.** `manage-commercial-data` shows the alternative —
`delete payload.id; delete payload.user_id; delete payload.property_id` — which
is safe for the three columns somebody thought of and open for every column
added since. It also verifies ownership and allowlists `body.table`, so it is
not urgent; it is simply the weaker shape.

## The gate

`scripts/security/check-mass-assignment.mjs`, ratcheted against
`supabase/functions-registry/mass-assignment-baseline.json` at **51 sites across
26 files** — the same convention `edge-typecheck-baseline.json` uses. The
remaining 51 each need a per-table decision about which columns are legitimately
writable, which is product knowledge and not one change. New sites fail
immediately; the backlog is visible and capped.

> **Superseded.** WP-20 took this to 15, and
> [WP-25](./WP25_MASS_ASSIGNMENT_TO_ZERO.md) took it to **0** — the baseline now
> reads zero, so the ratchet behaves as a zero-tolerance gate without having
> been rewritten as one. The figures above are what this work package measured,
> kept because the rest of this document explains them.

It follows bare-identifier aliases before deciding a value is request-derived.
The first version did not, and its own negative test —
`const alertRow = a;` where `a = body.alert` — walked straight through it. That
is recorded here because the gate would have looked like it was working.

## Verification

```
node scripts/security/check-mass-assignment.mjs         # 51, at baseline
node scripts/security/check-security-gate-negatives.mjs # 25 removed, 25 failed as required
node scripts/security/check-edge-functions.mjs          # 384, at baseline
npm run test:aml-sanctions                              # 0 failures
npm run security:test                                   # green
```

## What is left

- **51 write sites** still unallowlisted, capped by the baseline. The clusters
  are `aml-cases`, `aml-entities`, `aml-finance`, `aml-records`,
  `manage-commercial-data`, `manage-industrial-data`, `manage-portal-client-data`.
- **`parseJsonBody` has no call sites yet.** It is the tool for the next
  function that needs it and for the 9 `public` / 31 `public-auth` /
  70 `portal-authenticated` endpoints that should adopt it first; retrofitting
  419 functions is not this phase. Nothing regresses in the meantime — the size
  bound and R4 still apply — but the count of schema-validated functions is
  still 2, and honesty about that is worth more than a number that moved.
- **Item 14's ownership half** was the `borrowing-capacity` ordering defect,
  fixed in WP-16. IDs themselves were never the problem here: ~726 UUID primary
  keys, `gen_random_uuid()` across 298 migrations, and one `BIGSERIAL` on a
  low-sensitivity enrichment cache.
