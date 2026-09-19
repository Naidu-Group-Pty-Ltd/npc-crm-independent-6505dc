# RF-7.2B.1B0 — the location and geography lineage

Why a report says it has no demographics, and what is actually wrong.

Read this before touching `location-intelligence-service`, `geocodeAddress`,
`resolveOneReportGeography`, or anything that reads `report_geography.status`.

---

## The symptom

Every backend report generated for the RF-7.2B.1A verification carried
`report_geography.status = 'unresolved'`, and therefore no demographics, no
SEIFA, no employment and no location section. The reports were correct — they
said so rather than inventing anything — but they were incomplete, and nothing
in the product said why.

| report | address | `geography.status` | `location_intelligence` |
| --- | --- | --- | --- |
| `09f8569e-…` | 48 Redfern Street, Cowra NSW 2794 | `unresolved` | **NULL** |
| `3fbbcfe6-…` | 28 Bligh Street, Muswellbrook NSW 2333 | `unresolved` | **NULL** |
| `a6f0693c-…` | 48 Redfern Street, Cowra NSW 2794 | `unresolved` | **NULL** |
| `0ec278ea-…` | 48 Redfern Street, Cowra NSW 2794 | `unresolved` | **NULL** |

All four carry the flag `missing_coordinate` and the note *"No coordinate is
stored for this report, so no geography can be derived."*

## The lineage, and where it actually breaks

```
address  →  location-intelligence-service  →  coordinate  →  resolveOneReportGeography
         →  report_geography  →  trusted POA  →  ABS  →  Client-Safe Gate  →  snapshot
```

Everything from `resolveOneReportGeography` rightwards behaved **correctly**.
The break is at the very first hop, and it is not in this repository.

Measured from the production logs, 2026-09-12:

```
✓ Google Maps API key found, fetching real data...
[location-intelligence-service] geocode returned no point: REQUEST_DENIED
[location-intelligence-service] unresolved: address_not_resolved
```

Over a 24-hour window: **24 geocode attempts, 24 `REQUEST_DENIED`, 0
successes, 0 `ZERO_RESULTS`.** Not intermittent — total.

`REQUEST_DENIED` is Google's status for a credential that is refused: an
invalid key, an API not enabled on the project, a key restriction that
excludes this caller, or billing disabled. It is never a statement about the
address; a bad address is `ZERO_RESULTS`.

**So the addresses were never the problem, and no code in this repository is
the problem.** `GOOGLE_MAPS_API_KEY` is being refused by Google.

## Three findings

### B0-F1 — the geocoding credential is refused (P0, infrastructure)

Not fixable in code. The remedy is in the Google Cloud project that issued
`GOOGLE_MAPS_API_KEY`: check that the key is valid, that the **Geocoding API**
is enabled on the project, that billing is active, and that any application
restriction on the key admits a server-side caller with no referer.

While it holds, every newly generated report loses its coordinate, and with it
geography, demographics, SEIFA, employment, schools, amenities, transport and
the CBD commute. The report remains *accurate* — the Client-Safe Gate
withholds rather than guessing, exactly as designed — but it is *incomplete*,
and no release can be certified as producing a complete report until the key
is restored.

Historic corpus for scale: 867 reports resolved geography, 251 did not, 93
have no row. The outage is recent, not structural — the pipeline demonstrably
works when the credential does.

### B0-F2 — a provider refusal was reported as a fact about the address (P1, fixed here)

`geocodeAddress` returned `null` for every failure — HTTP error, thrown
request, `REQUEST_DENIED`, `ZERO_RESULTS`, a point rejected as outside
Australia — and its caller stamped the single reason `address_not_resolved`,
whose message reads:

> The address could not be resolved to a location in Australia.

For `ZERO_RESULTS` that is true. For `REQUEST_DENIED` it is **false**, and it
is the expensive kind of false: it blames the customer's address for this
deployment's own credential and sends whoever reads it to re-check an address
that was never wrong. It is the same failure this repository has named
repeatedly — *a read that FAILED is not a row that is ABSENT*; *a provider
configured but in simulator mode reported as no provider at all, sending the
administrator to the wrong remedy.*

The fix: `geocodeAddress` returns a discriminated outcome carrying
`providerRefused`, and the reason vocabulary gains `geocoder_unavailable`,
whose message says the fault is ours and that the address was never rejected.

Two rules hold it.

**The provider's own status decides, and it is read where it is in hand** —
never re-derived downstream from the absence of a point, because a refusal and
a genuine miss look identical from outside.

**`ZERO_RESULTS` is the only status that is a statement about the address.**
Every other status — `REQUEST_DENIED`, `OVER_QUERY_LIMIT`, `OVER_DAILY_LIMIT`,
`INVALID_REQUEST`, `UNKNOWN_ERROR` — and every unrecognised one counts as
ours. Attributing our outage to a customer's address is the error that costs,
so an unknown status takes the conservative side and we own it.

Nothing client-facing changes. No figure, no section, no document is altered
by this: it changes only which reason the platform records and logs for its
own operators.

### B0-F3 — a refused vendor call is metered as a success (P1, reported, NOT fixed)

`api_usage_log` records **every one** of those 24 refused geocodes as
`status = 'success'`. `meteredFetch` decides the outcome from `response.ok`
alone, and Google answers `REQUEST_DENIED` with **HTTP 200** and the real
verdict in the body — the same shape `resolveOneReportGeography`'s own header
already warns about for the ABS boundary server:

> ArcGIS reports failures as 200 plus an error body. That is transport.

Two consequences. `googlemaps` is in `apiUsageBilling.pure.ts` as a per-request
vendor, so the tenant is **billed for calls that returned nothing**. And every
health reading built on `api_usage_log.status` reported the vendor as perfectly
healthy throughout a total outage — which is why B0-F1 ran invisibly.

**This is deliberately not fixed here.** `meteredFetch` is the fleet-wide
metering wrapper and `MeteredFetchOptions` carries no outcome override, so
correcting it means changing how *every* vendor call decides success — which
changes billing for the whole fleet. That is a material architectural
decision, not a narrow B0 repair, and CLAUDE.md's own rule bites in both
directions here: double-billing is worse than not billing. It is recorded for
a decision rather than taken unilaterally.

## What this means for the release

The engine behaved correctly at every layer it owns. The gate withheld, the
narrative disclosed, nothing was invented, and the resulting document is safe
to rely upon.

It is not, however, **complete**, and completeness is one of the six release
requirements. A release certified while B0-F1 stands would be certifying a
document that correctly reports the absence of data the product is supposed to
carry.
