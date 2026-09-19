# RF-7.2B.1B1 — buying the enrichment once, and knowing which postcode may speak

Two pre-certification hardening items. One is commercial, one is evidential, and
they share a cause: **something deterministic was being re-derived, from a source
that was never asked whether it was sure.**

Read this before touching `_shared/reports/location/locationEnrichmentReuse.pure.ts`,
`_shared/reports/location/crimePostcodeAuthority.pure.ts`, the enrichment block in
`generate-investment-report`, or the crime call sites.

---

## 1. The enrichment was bought on every resume

### What it cost

An investment report cannot finish inside one Edge Function invocation — 17
sections at ~25s against a ~150s ceiling — so it is resumed repeatedly by
`investment-report-resume-2min`. Every invocation re-entered the enrichment block
and called `location-intelligence-service` again, because
`existingEnhancedFields.locationIntelligence` was consulted **only when deciding
what to write**:

```ts
if (!existingEnhancedFields.locationIntelligence && enhancedData?.locationIntelligence) {
  earlyUpdate.location_intelligence = enhancedData.locationIntelligence;
}
```

That guards the write. Nothing guarded the fetch.

One enrichment is **eight Google calls**, counted from the source and confirmed
by the production ledger:

| call | count | endpoint |
| --- | --- | --- |
| Geocoding | 1 | `/maps/api/geocode/json` — skipped when a coordinate is supplied |
| Places Nearby | 6 | `transit_station`, `school`, `hospital`, `shopping_mall`, `park`, `restaurant` |
| Distance Matrix | 1 | the CBD commute |

`api_usage_log` over 2026-09-05..08 recorded **612 nearbysearch and 102
distancematrix** — exactly 6:1, which is the ratio this table predicts.

The 2026-09-12 health check resumed **eleven** times and bought eleven geocodes
for one address. Had the geocode succeeded, the same eleven resumes would have
bought **88 Google calls for one report**, of which 80 are a second, third and
eleventh purchase of an answer that cannot change. The property does not move
between resumes.

### The rule

**A successful, complete enrichment acquired for THIS subject is reused on later
resumes instead of being bought again.**

Three refusals make that safe, and all three are refusals rather than
permissions.

**Identity is stamped, never inferred.** The persisted object carried no subject,
no provider status and no timestamp — measured against a real production row,
it holds `coordinates`, `commute`, `walkScore`, `amenities`, `schools`,
`healthcare`, `lifestyle` and `transport`, and nothing that says *which property
this is*. So `assessEnrichmentReuse` refuses anything without the stamp, which
means **every row written before this change re-fetches exactly as it does
today**. An object that cannot name its subject is not evidence about this one.

**Only success is reusable.** A refused geocode is never persisted in the first
place — the service answers `success: false` with no `data`, and the caller
writes nothing — so failure cannot become a cache by accident. The guard refuses
again anyway on missing coordinates, because the F1 outage is live and a guard
that could freeze a failure into place would turn a provider problem into a
permanent one.

**Incomplete is not complete.** `fetchNearbyPlaces` swallowed a failed call into
`{ count: 0, results: [] }`, which once stored is indistinguishable from a
genuinely quiet rural suburb. It now reports `ok`, and the acquisition stamp
records `places: 'complete' | 'partial'`, so a Places outage cannot be locked in
as "this address has no schools". A commute that is `no_route` or
`destination_unknown` is still a complete acquisition — those are real answers.

### The identity is the database's own, not a second one

`subjectKeyFor` normalises with **exactly the rule
`canonical_property_key` uses** —
`regexp_replace(lower(trim(raw_address)), '[^a-z0-9]+', ' ', 'g')`, from
`20260724100000_canonical_generated_report_property_identity.sql` — over the
address, postcode and state together. All three steer the result, because
`buildAuGeocodeQuery` composes all three into the geocode request, so a change
in any of them can move the coordinate.

Inventing a second normalisation would have refused reuse on reports the
database considers one property — safe but pointless — and would drift the day
either rule moved.

### A partial acquisition retries a bounded number of times

The incompleteness rule is its own amplification if left unbounded: a Places
category that fails persistently — a quota, a category Google has no data for —
would refuse reuse on every resume and re-buy **all eight calls** each time,
reaching the 88-call behaviour through the guard written to prevent it.

`MAX_PARTIAL_ACQUISITIONS = 3`. A partial enrichment is re-acquired twice more
and then accepted:

| resumes | complete first time | persistently partial | before this change |
| --- | --- | --- | --- |
| 11 | **8 calls** | **24 calls** | 88 calls |

Two extra attempts are worth buying because a transient Places failure is
common and a complete set is materially better evidence. Past that, re-buying
costs more than it recovers.

**Accepting a partial set is not calling it complete.** `stages.places` still
reads `partial` afterwards and the verdict is its own value,
`partial_retry_exhausted`, never `reusable` — what is exhausted is the
re-buying, not the honesty. The counter is per PROPERTY, not per row, so moving
a report to a new address does not inherit the old address's exhaustion.

One wiring detail is load-bearing: the early-write guard was "only write what is
missing", which is right for a reused object and **wrong for a retried one** —
a re-acquired partial would never persist its incremented count, so the bound
would never be reached. The write now also fires on a re-acquisition, tracked by
a handler-scoped `locationEnrichmentReused`. The first attempt scoped that flag
to the enrichment block and the edge-function gate caught it as a
`ReferenceError` before it could ship.

### What is persisted, and who consumes it

| Google call | persisted field | downstream consumer |
| --- | --- | --- |
| Geocoding | `coordinates.{lat,lng}` | `resolveOneReportGeography` (point-in-polygon → `report_geography`), planning, climate, regional trends, area scoring |
| Places `transit_station` | `transport.*`, `amenities[Public Transport]`, `walkScore` | report body "Nearest Station", amenity table |
| Places `school` | `schools.*`, `amenities[Schools]`, `walkScore` | `schoolDistance.pure.ts`, report body |
| Places `hospital` | `healthcare.*`, `amenities[Healthcare]`, `walkScore` | report body healthcare row |
| Places `shopping_mall` | `lifestyle.shoppingCenters`, `amenities[Shopping]`, `walkScore` | report body shopping rows |
| Places `park` | `lifestyle.parks`, `amenities[Recreation]`, `walkScore` | report body parks row |
| Places `restaurant` | `lifestyle.restaurants`, `walkScore` | walk score only |
| Distance Matrix | `commute.{mode,distanceKm,durationMinutes}` | report body CBD commute |

Google's `formatted_address` was **discarded** and is now captured as
`matchedAddress` on the acquisition stamp. It is evidence, never an input:
nothing keys on it, because a `formatted_address` describes what the provider
MATCHED, which is smaller than what the source said — the rule
`ADDRESS_COMPOSITION.md` already records.

**No figure in any document changes.** A reused enrichment is byte-identical to
the stored one, because it *is* the stored one.

---

## 2. A lot number was allowed to select crime statistics

### What was measured

The generator derived the postcode it keys evidence on from one expression:

```ts
propertyAddress.match(/\b(\d{4})\b/)
```

That is the **first** four-digit token in a free-text string, not the postcode.
Over the production corpus on 2026-09-12:

```
addresses containing a 4-digit token            418
where the first token is NOT the postcode        30
where that wrong token is a real postcode        17
```

The wrong tokens are builder-stock **lot numbers** — the same trap
`builderStockAddress.pure.ts` already records for the address line:

```
"Lot 2267 Hunza Road, Truganina, VIC 3029"   → parsed 2267, a NSW postcode
"Lot 2325 Ned Street, Mambourin, VIC 3024"   → parsed 2325, a NSW postcode
```

### Nothing was served wrong, and the reason matters

`crime-statistics-service` filters `.eq('state', st)` as well as
`.eq('area', area)`, and no Victorian postcode register is loaded — so
`area=2267, state=VIC` returns nothing. Exactly one corpus row would have
returned data for a mis-parsed postcode, and it is
`"Properties in Armidale NSW 2350, 2351"`, a two-postcode query where taking the
first is legitimate.

**So the containment is accidental, not designed.** It rests on Victoria not
being loaded. The day a VIC postcode register lands, twelve stored addresses
begin selecting Cessnock's crime figures for properties in Truganina, and nothing
in the pipeline would notice — the figures would be real, current, correctly
attributed to BOCSAR, and about somewhere else.

That is the failure this platform is least able to detect, and the one a client
is least able to question.

### The rule

**A postcode may select client-facing statistical evidence only when it comes
from a source that ASSERTED it as a postcode.**

| provenance | trusted | what it is |
| --- | --- | --- |
| `resolved_geography` | **yes** | the ABS point-in-polygon POA for the verified coordinate |
| `structured_subject` | no | `propertyDetails.postcode` — see below |
| `free_text_parse` | no | a regex over the address string |
| `none` | no | nothing available |

### Why the "structured" field is not trusted either

The first cut trusted `propertyDetails.postcode`, reasoning that a field a
caller fills in is an assertion rather than a number found inside a sentence.
**Tracing every production origin refutes that.**

| producer | what it sets |
| --- | --- |
| `InvestmentReportGenerator` (3 call sites) | never sets `postcode` |
| `ClientPropertyInvestmentReport` | never sets it |
| `useChunkedRegeneration` | never sets it |
| `bulkReportWorker` | sends `zipCode` — a different key |
| `auto-report-sync` | `listing.zipcode`, from Airtable |
| `auto-report-webhook` | `detectedPostcode` |

and `detectedPostcode` is a cascade that falls through to exactly the mechanisms
this module exists to refuse:

```
extractPostcodeFromText(listing.address)   a free-text parse
lookupSuburbInDatabase(listing.suburb)     a suburb-name lookup
lookupSuburbStatic(listing.suburb)         a hardcoded table —
                                           'BRISBANE': { postcode: '4000' }
```

A suburb-name lookup returns the suburb's **representative** postcode, which for
any suburb spanning more than one is wrong for most properties in it. `BRISBANE`
resolves to the CBD for a property anywhere in Brisbane. The Airtable route is
no safer: `NPC_EMAIL_1_AUDIT` and `ADDRESS_COMPOSITION` record that Make
geocodes `{{address}},{{suburb}}` and a second model call re-parses the answer
over eight address columns, so that column can itself be model-derived.

There is no origin metadata on the field to tell these apart at the point of
use, and no `postcode` in the manual-override allow-list, so there is no
authoritative override either. Rather than add a migration to carry provenance,
the narrowest safe distinction the existing data contract supports is the honest
one: **only the resolved POA selects evidence.**

`structured_subject` is kept as its own provenance because it is its own
*refusal*: "a postcode arrived but its origin cannot be established" sends an
operator somewhere different from "the address was scanned for a number".

### State consistency is a rejection test, not authority

`postcodeMatchesState` refuses a candidate that contradicts the subject's state
at any rank, which catches `Lot 2267 … VIC` on its face rather than relying on
Victoria's register being absent. It is **necessary and not sufficient**:
belonging to the right state is not evidence of belonging to the right property.
Positive authority comes only from the hierarchy above.

A candidate that contradicts the subject's state is refused **at any rank**,
using Australia Post's allocation. That is what catches the measured case
directly rather than relying on Victoria's register being absent: 2267 is inside
NSW's range and nowhere near Victoria's, so `Lot 2267 … VIC` is refused on its
face. The check never *infers* a state and never *repairs* a postcode — an
unknown jurisdiction refuses nothing, because that is not evidence about the
postcode.

### What happens when nothing is trusted

Postcode-level crime counts are **withheld**, with `CRIME_EVIDENCE_WITHHELD_NOTE`.
The risk being avoided is not a missing number — it is a precise, sourced,
plausible number about the wrong town. The note is about the RECORD and never
about the area, and it promises no substitute: there is no fall back to LGA or
SA2, which would be the cross-grain substitution `SCREENING_SCOPE.md` and F4 both
already forbid in their own domains.

The call is made twice, matching the treatment ABS demographics already get:
once at intake (structured postcode only — the geography has not resolved yet),
and again once the coordinate lands, re-keyed onto the canonical POA.

### This is orthogonal to F4

F4 decides whether a rate may be **divided** — whether an admitted population of
the same grain and area exists. This decides which **area** is being described at
all. They are different questions and neither is a substitute for the other:

- trusted postcode + no admitted population → **counts, no rate** (F4)
- no trusted postcode → **no counts at all** (this)

`admitPopulationForArea` and the rate block are untouched, and a test asserts the
postcode module cannot compute with a population, a rate or a denominator.

---

## 3. What this does not do

- It does not introduce a cache framework, Redis, or any storage the report
  record did not already have. The enrichment stamp rides on the existing
  `location_intelligence` column.
- It does not change canonical crime calculations, BOCSAR provenance, A.2's
  governed-authority remediation, the stamp-duty validator or F3's metering.
- It does not make the free-text parser smarter. A better parse would still be
  untrusted under the rule above, and making it cleverer is how a guess acquires
  the appearance of authority.

---

## §13 (RF-7.2B.1B2) — a failed Places lookup is not a measurement of zero

RF-7.2B.1B1 added `ok` to `fetchNearbyPlaces` so the ACQUISITION could tell a
failed amenity lookup from an empty area. It could. Nothing else could: `ok`
was reduced to one `stages.places: 'complete' | 'partial'` flag and then
discarded, so the object that is persisted — and that every consumer reads —
stored `count: 0` and `nearest: 'N/A'` for a category whose provider never
answered. Byte-identical to a genuine zero, and unrecoverable afterwards.

It reached a client. `regenerate-report-qualitative` composes the model's
location context with

```ts
const healthcare = loc.healthcare?.facilitiesWithin5km;
if (typeof healthcare === 'number') lines.push(`- Healthcare facilities within 5km: ${healthcare}`);
```

and `typeof 0 === 'number'`. Executed against the pre-change projection, a
Places outage handed the model:

```
- Healthcare facilities within 5km: 0
- Shopping centres nearby: 0        nearestHospital = "N/A"
```

The author had already refused the string `'N/A'` for `nearestSchool` on the
line below. The COUNT had no such guard, because until `ok` existed there was
nothing in the data that could justify one.

Three things compounded it. `'N/A'` is **truthy**, so it survived every `||`
fallback in the generator's prompt and arrived in front of the model as though
it were a value ("Nearest Station | N/A"). `walkScore` is a composite over all
six categories and spends points per category, so an outage did not omit a
figure — it **depressed** one, publishing a confident low walkability nobody
measured. And the Client-Safe Gate disowns only four location paths
(`walkScore`, `transport.qualityScore`, `commute`,
`schools.schoolsWithin3km`), so healthcare, shopping, recreation, restaurants
and transit counts all reached the narrative unguarded.

### The rule

**A measurement that was not taken is absent, never zero** — the rule
`rentalEvidence` established when 83 reports printed `0.00%` beside a real
rent. `placesAvailability.pure.ts` is the one place that applies it, and the
correction is entirely at the producer: a failed category stores `null` for
its count, its nearest name and its distance; a reached-and-empty category
still stores `0`, because a rural address with no hospital within five
kilometres is a fact worth printing.

No consumer changed. `null` is what each of them already handles correctly —
`typeof null === 'object'` makes the two `typeof x === 'number'` guards OMIT
the line (§3's "omit the unsupported category"), `null || 'XX'` renders the
placeholder the prompt already had, and `investment-scoring-service` gates on
`hasNum(...)` so an absent value is simply not scored.

Two more: the acquisition stamp now names **which** categories did not answer
(`stages.placesUnavailable`, additive — the RF-7.2B.1B1 reuse decision reads
`places` alone and is unchanged), and `walkScore` is `null` rather than
depressed whenever any category is missing, because a composite over an
incomplete basis is not a measurement of the composite.

`placesAreComplete` is now the single implementation of complete-vs-partial,
shared by the stamp and the projection, so the record and the figures cannot
disagree about which lookups answered.

### What was checked and found already correct

The withheld-crime path needed no change. `crimeStatBlocks` returns one honest
line and an explicit prohibition when the reading is absent — no table, no
score, no rating, no rate, and no digit of any kind — so a withheld postcode
cannot become zero crime, low crime or a safe area. State-wide movement is
composed only ALONGSIDE a real local total (it sits after the `total === null`
early return), so nothing substitutes a state, LGA or SA2 figure into a
postcode slot. The QLD LGA path refuses without a cadastre-derived LGA
("figures are unavailable rather than guessed from a suburb name"), refuses an
ambiguous council match ("rather than reporting another council's offences"),
and names its grain in the client-facing prose
(`areaKind: 'local government area'`).

One imprecision is recorded and deliberately **not** changed: the withheld line
reads "No recorded-crime register is integrated for this location", which is
exact for an unloaded register (Victoria) but names the wrong reason when the
register is loaded and it is the POSTCODE that could not be established. Both
reach the same safe behaviour — say it plainly, print nothing — so this is
cosmetic wording, not a client-facing error.

### Tests

`rf72b1b2PartialPlacesSemantics.spec.ts` is the §4 matrix A–E; every source
probe in it is present exactly once in the pre-change file and absent from the
current one, so the suite discriminates rather than merely passing.
`rf72b1b2CrimeWithholdSemantics.spec.ts` is the §6 matrix A–G.
