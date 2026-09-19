# Reaching Didit without holding its key

**Read this before touching `_shared/aml/providers/diditStandaloneRoute.pure.ts`,
`probeStandaloneRoute`, the `verification_selftest` operation, or anything in
Mission Control's `verificationBroker.*`.**

## The measurement that forced it

A Didit API key is scoped to an **application**, and that scope includes the
application's session list. Measured against the live account on 7 Sep 2026:
`GET …/application/{id}/sessions/` returned **all eight sessions**, each with
the customer's name and **live pre-signed URLs to their passport portrait and
selfie**.

Fleet policy forwarded that key to every clone. So three tenant projects each
held a credential that could read every other tenant's customers' identity
documents — and Didit publishes no API to create an application or mint a key,
so per-tenant credentials cannot be provisioned. Creating one by hand per
client is the manual step this control plane exists to abolish.

**The credential stops travelling and the CALL travels instead.** Mission
Control holds the one key; a clone presents its own Mission Control key and
names one of three operations.

## What may be reached, and what may not

`BROKERED_OPERATIONS` is an allow-list of the three **write** operations:

| operation | vendor path |
|---|---|
| `id-verification` | `POST /v3/id-verification/` |
| `passive-liveness` | `POST /v3/passive-liveness/` |
| `face-match` | `POST /v3/face-match/` |

Each creates a new verification. **Nothing readable is offered**, so the
enumeration this closes cannot be reached through the thing that closes it.

The **hosted-session** flow (`diditClient.ts`, `didit-webhook`) is *not*
brokered and still reads `DIDIT_API_KEY` directly. It is legacy — no new
attempt is created against it, the portal serves the capture journey instead —
and `diditConfigured()` already refuses to create a hosted session without the
key, so no webhook can legitimately arrive on a deployment that holds none.
That deployment answers 500 and says which shape it is in, rather than a bare
`not_configured` that reads as an outage. **Brokering it would need more than
another allow-list entry**: a decision read is parameterised by session id, so
the broker would have to record which clone created which session and refuse
the rest — otherwise the broker becomes the leak it was built to close.

## The rules

**A brokered call must not be metered at the clone.** Mission Control writes
the usage row because Mission Control made the vendor call. Metering at both
ends bills the tenant twice, which this platform's own rule names as worse
than not billing at all. `StandaloneRoute.meter` carries it and is `false` for
exactly one route.

**Unconfigured is a named state, never a silent direct call.** A deployment
with neither route refuses and says which half is missing. Falling back to an
unauthenticated vendor call would produce a 401 that reads like a customer
failing verification.

**Who refused is read from a header, never guessed from a body.** Mission
Control sets `x-mission-control-refusal` on every refusal it makes and on
nothing it relays, so the header's **absence** is what identifies an answer as
the vendor's. Both ends can answer 401 with similar JSON and they send an
operator to opposite remedies — *this clone's Mission Control key is wrong or
missing `verification:run`* against *the fleet's Didit credential is wrong*.

**A credential is withheld per clone, not per fleet.** `prime_secret_forwards`
is all-or-nothing and `clone_secret_forwards` can only add, so Mission Control
carries a `withheld` ledger status: the clone does not hold the value (the
register stays true) and no sweep may write it (the withdrawal stands).
Deleting the value alone does not survive — the fleet reconcile rewrites it
within thirty minutes.

## Configuration is not reachability

Every readiness reading in this product answers a question about
configuration — key present, provider active, thresholds parseable — and all
of them were green on three tenants that had **never completed a single
verification**. On the brokered route four things no local flag can see stand
between an edge function and the vendor: the clone's Mission Control key, its
scopes, Mission Control's own Didit credential, and the vendor itself.

`verification_selftest` makes one real call and reports what came back.

- **It spends nothing.** The body is deliberately incomplete, so the vendor
  rejects it at validation. **Being rejected is the pass** — it proves the
  request authenticated, arrived and was answered — and the endpoint says so,
  because otherwise the healthy reading looks like a fault.
- **It is never metered and writes nothing.** No check, no case, no event, and
  the plain `fetch` on both routes: a diagnostic must never reach a tenant's
  invoice.
- **It reports the host**, never the URL and never a credential.
- It is **reviewer-or-MLRO**, because it names which credential a failure lies
  with and because it makes an outbound call.

## What the free tier actually allows — and what it does not cover

**The free tier does not apply to the route this product uses.** That is the
correction that matters, and it was got wrong twice before the counters were
read properly.

Didit meters two families under similar names. The **workflow/session**
features — `id_verification`, `passive_liveness`, `face_match` — each carry
`free_tier_limit: 500` per calendar month. The **direct `/v3/` API**
endpoints, which is what `diditStandaloneClient` calls on every route, meter
under the `_api` suffix — `id_verification_api`, `passive_liveness_api`,
`face_match_api` — and measured 8 Sep 2026 **not one `_api` counter carries a
`free_tier_limit` at all**. Every one of the eighteen reads `NONE`.

So the standalone prices are the real ones, per call, from the first call:

| Operation | Counter | Price |
| --- | --- | --- |
| ID verification | `id_verification_api` | $0.20 |
| Passive liveness | `passive_liveness_api` | $0.05 |
| Face match | `face_match_api` | $0.05 |

One complete verification is therefore **$0.30**, and the $9.00 balance
measured that day is about thirty of them. Reading the free-tier row and
concluding a verification costs nothing is the mistake to avoid: the
free-tier numbers are true, they are simply about the hosted session flow
this deployment does not use.

`allow_free_usage: true` and a `0.00` balance still do not block *free-tier*
work, and enabling white-label on a workflow still drops that workflow out of
the free tier. Neither fact reaches the standalone path.

## The brokered call bills the tenant — and did not, at first

Measured 8 Sep 2026 by running the loop end to end on NPC Test. Didit charged
the prime USD 0.30 and Mission Control wrote three usage rows, correctly
attributed to the clone, every one of them `billing_reason: no_key`,
`billable: false`, `cost_micros: 0`. The money left and nobody was recharged —
the exact failure `API_USAGE_METERING.md` names.

One CASE arm caused it. `resolve_api_key_billability` charges on
`clone_backend_secrets.status = 'inherited'` and drops everything else into
`no_key`. `withheld` — the status that exists so a clone can STOP holding a
forwarded key — landed in that else. Correct before the broker: no forwarded
key meant the clone could not spend our money. Exactly inverted after it:
`withheld` is now the one status that GUARANTEES the prime paid, because the
credential stays here and the CALL travels instead.

Four rules carry the fix.

**Two independent routes, either sufficient.** The broker STATES `brokered` in
the event metadata — it made the call, so it is the only party that knows, and
it is right about a clone whose ledger row says anything at all. The status
column catches usage arriving by any other path while the clone is
demonstrably stripped of the key. Neither is trusted to cover the other.

**A reporter may not assert its own route.** `normalizeEvent` strips
`brokered` from clone-supplied metadata. That a clone could only ever use it
to charge ITSELF more is not the point: an input to the money rule comes from
the party that knows, or the rule is decorative.

**`brokered` is not `inherited`.** Same charge, different fact — one
credential travelled to the tenant, the other never left this project. An
operator asking the ledger which tenants hold our keys must not be told a
brokered one does.

**A failed brokered call is still `error_call`.** Nothing was delivered, and
the route the credential took does not change that.

The metadata is read as jsonb (`(_metadata->'brokered') = 'true'::jsonb`),
never cast. `::boolean` RAISES on a string Postgres cannot read, and metadata
is free-form — one malformed value would abort the function and stop every
tenant's usage being recorded at all.

## One credential, three prices

Turning billing on exposed a second fault, older than the broker.
`api_provider_rates` holds one row per SECRET, so `DIDIT_API_KEY` had one
price for every call: cost USD 0.20, resale USD 0.40. Measured against the
vendor's own counters that is true of exactly one of the three operations —
`id_verification_api` USD 0.20, `passive_liveness_api` USD 0.05,
`face_match_api` USD 0.05.

So a verification costs USD 0.30 and the flat rate booked USD 0.60, the
platform's own ledger overstating what it paid by 2x, and charged the tenant
USD 1.20 — 4x cost, against the 2x margin the owner actually set. The direct
(`inherited`) path was always priced this way; it never showed because
nothing was being charged at all.

`api_provider_rate_features` is an override table, deliberately not a
replacement: `api_provider_rates` keeps its `UNIQUE (secret_name)` and stays
the one row the rate editor reads and writes, so that surface is untouched and
cannot break by a second row appearing under the same name. A feature with no
override is priced by the base row exactly as before, which is what leaves
every other vendor alone.

**The resale figures are not a new pricing decision.** Each is the measured
cost times the margin already on the base Didit row (400000/200000 = 2.0), so
the owner's own multiple is preserved and only the cost it multiplies is
corrected. Changing the margin is a commercial decision and those three rows
are where it happens.

Verified on the live ledger after repair: three events, cost USD 0.30 total —
matching Didit to the cent — and charge USD 0.60. The rollup reconciles: 3
billable of 3, alongside 8 error events from the free probes at zero.

### A rejected call does not appear to bill

Measured on the same reading: `passive_liveness_api` stood at **2** after the
empty-form probe had been run against three clones several times over. A call
the vendor refuses at validation is not counted. That is what makes
`verification_selftest`'s "spends nothing" guarantee hold — it is a property
of the refusal, not an assumption — and it is why the loop check's expected
cost is also nothing despite sending real bytes: a synthetic image carries no
document and no face, so it is refused too. The difference is that the loop
check **could** bill if a call got far enough to succeed, so it declares
`spends: true` and is never the default.
