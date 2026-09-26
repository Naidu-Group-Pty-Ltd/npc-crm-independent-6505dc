# Geocoding without Google

**Status: built 16 Sep 2026, on branch `claude/adoring-hopper-g02tdt`.**
Production proof is recorded in §9 as it is obtained; until the migration is
applied and the functions are deployed, every claim below about production is a
claim about the code.

Read this before touching `supabase/functions/_shared/geocode/*`,
`google-places-autocomplete`, the geocode step in `estimate-capital-growth`,
`resolve-listing-coordinates`, `location-intelligence-service` or
`parse-property-pdf`, or the `geocode_cache` table.

---

## 1. What went wrong, and the decision

Every server-side geocode in this product was a direct call to Google's
Geocoding API under one key. On **12 September 2026** that key began
answering `REQUEST_DENIED` to every request — 25 refusals after 15 successes
that day, 22 on the 14th, 139 on the 15th (`api_usage_log`, service
`googlemaps`) — and it has not answered since. Four surfaces went dark at
once, each reporting it differently:

| Surface | Symptom |
|---|---|
| Listings map (`resolve-listing-coordinates`) | Pins stopped appearing for any listing without a cached coordinate. |
| Investment report location intelligence (`location-intelligence-service`) | `geocoder_unavailable`; every Places Nearby and Distance Matrix call went quiet with it, because each begins with a geocode. |
| PDF import (`parse-property-pdf`) | Addresses stayed incomplete — no suburb, state or postcode filled in. |
| Estimate CGR (`estimate-capital-growth`) | Fell back to parsing the typed text: "the geocoder answered REQUEST_DENIED". |
| Address field (`google-places-autocomplete`) | `502 upstream_error` on every keystroke (pg_net 246932, 16 Sep). |

The remedy was in the Google Cloud console, and the owner's decision was that
the product must not depend on that console or on Google's charges. This is a
commercial product cloned per tenant; a geocoder that any tenant can switch off
by mis-setting a billing account, and that bills every clone against the prime's
key, is not a foundation.

## 2. The design

One chain, one contract, a cache in front and the same gates behind.

```
geocodeAddress(supabase, ask, options)          _shared/geocode/geocoder.ts
  1. geocode_cache        by the folded address key — a hit is the answer
  2. nominatim            OpenStreetMap: house or street precision
  3. abs_locality         the suburb's own centroid from the ABS boundary server
  4. google               ONLY if listed in GEOCODER_PROVIDERS and a key is set
  → assessGeocodeGranularity on every answer, whoever gave it
  → the council from the ABS point-in-polygon query, when asked for
  → cached
```

The default order is `nominatim,abs_locality`. **It names no Google.** An
operator who wants Google as a last resort sets
`GEOCODER_PROVIDERS=nominatim,abs_locality,google` — and that provider still
meters, judges the body and consumes the daily cap exactly as the four call
sites it replaced did.

Every provider answers in one shape (`GeocodeResult`): a coordinate, a
precision (`address` / `street` / `locality` / `postcode`), Google-shaped
`types` so the existing granularity gate judges every provider alike, the
suburb, state, postcode and council it named, what it MATCHED, which provider
it was and the licence line the data travels under.

### 2.1 Measured, not assumed

From the production egress, 16 Sep 2026 (pg_net request ids in brackets):

| Provider | Probe | Answer |
|---|---|---|
| Nominatim [246882] | `10 Leakes Road, Truganina VIC 3029` | Leakes Road, Truganina, 3029 — `road`, street precision |
| Nominatim [246884] | `291 Stone Mason Drive, Kellyville NSW 2155` | Stone Mason Drive, Kellyville, 2155 |
| Nominatim [246936] | `Cobblebank VIC 3338` | a **railway station first**, the suburb second — the rule in §4 |
| Photon [246883, 246934] | `10 Leakes Road Trug` | Leakes Road, Truganina, 3029 |
| Photon [246935] | `291 Stone Mason Dr Kelly` | a bus stop first, the street second — the rule in §5 |
| ABS SAL [246900] | `Glenelg (SA)` | the suburb's polygon, 3.9 KB of rings |
| ABS LGA [246899] | point `144.7265, -37.8375` | `Wyndham`, code `27260` |
| ABS SAL [246898] | the query shape itself | name matched under the ABS qualifier |
| Google geocode | any address, since 12 Sep | `REQUEST_DENIED` |

Every mapper in `_shared/geocode/*.pure.ts` is pinned against those verbatim
answers by `src/lib/geocode/__tests__/*.spec.ts`.

## 3. The rules

**Every provider is judged by the same gates.** OpenStreetMap has Google's
failure modes: a query it cannot match can answer a state, a country or the
centre of the continent. The Google-shaped `types` every result carries feed
`assessGeocodeGranularity` unchanged, so "matched the state, not the address"
is refused for OSM exactly as it was for Google, and `resolve-listing-coordinates`
still runs `assessAuPoint`, `assessAuPostcodePoint` and the suburb consensus on
top, as before.

**A cached answer is the first provider.** OpenStreetMap's usage policy
requires it, the listings sweep re-asks the same addresses daily, and every
allowance holds only if a repeat costs nothing. `geocode_cache` is keyed by the
folded address text (case and punctuation folded; spelling variants such as
`Rd`/`Road` deliberately NOT folded, because a key that guesses equivalence
serves the wrong cached answer). A wrong answer that was cached is removed by
deleting its row; a street or address answer never expires, because an address
does not move. An answer coarser than a street is different (§17): it is never
remembered while a street-level provider could not be asked, and a remembered
one is asked again of the street-level providers once it is an hour old.

**The free providers spend no credential, so they are never metered.** They
are fetched through `fetchWithTimeout`, never `meteredFetch`, and
`openstreetmap.org` and `komoot.io` sit on the billing map's never-metered
list beside `abs.gov.au`. Only the Google provider meters.

**The allowance fails closed.** `osmAllowance.ts` holds two things the public
services ask for: a daily ceiling per kind (`OSM_GEOCODING_DAILY_LIMIT`,
default 2000; `OSM_AUTOCOMPLETE_DAILY_LIMIT`, default 5000) and the
one-request-a-second turn Nominatim's policy makes an absolute maximum. Both
are held in the shared limiter (`security_consume_rate_limit`), not in an
isolate, and a limiter that cannot be read REFUSES — the reading
`consumeGoogleDailyCap` takes, for the same reason: the per-isolate fallback
answers `ok` for the first N requests of every isolate, and Edge Functions
scale horizontally. The verdict words are two of the Google caps' three
(`daily_cap`, `limiter_unavailable`), so `clientStatusFor` reads them
unchanged and no call site spells a client status of its own.

**No Maps caller touches the raw abuse-control quota.** `enforceGlobalDailyQuota`
is named in `osmAllowance.ts` and nowhere a Maps caller can reach it;
`googleMapsDailyCaps.spec.ts` scans for the name.

**A failure says which kind it was.** The chain's failure carries
`no_match` / `unavailable` / `budget` / `refused`, `providerRefused`, and for
`budget` a `capReason`. `location-intelligence-service` maps it onto its
existing vocabulary — `address_not_resolved` only for `no_match`,
`geocoder_unavailable` for a provider fault, `geocoder_not_attempted` with
the cap reason — and re-derives nothing from the absence of a point. The
ZERO_RESULTS rule (RF-7.2B.1B0) moved with the Google provider: the chain reads
`ADDRESS_IS_THE_ANSWER` and never enumerates refusal statuses.

**The locality floor is offered only where a caller accepts it.**
`allowLocalityFallback` is `true` for the map, the report and Estimate CGR
(a suburb centroid is the grade the map already accepts) and `false` for the
PDF import, whose whole purpose is to learn the suburb, state and postcode the
extraction did not read — a centroid names only what it was given.

**The order is configuration, and a misspelt setting is the default.**
`parseProviderOrder` drops unknown names and falls back to the default on an
empty result, so a typo can never switch every geocode off silently.

## 4. Nominatim, in detail (`osmGeocode.pure.ts`)

The search is **structured** where the parts are known — `street`, `city`,
`state`, `postalcode`, `country=Australia` — because Nominatim matches a
structured query far better than the same words free-text; free-text
otherwise. Always `countrycodes=au`, `addressdetails=1`, `limit=5`,
`dedupe=1`.

**The first result is not always the answer.** `Cobblebank VIC 3338` answered
a railway station first. A property's geography is never a station, so
`chooseNominatimPlace` chooses by what the caller asked for: a query that names
a street prefers a house, then the road, then the place; a query that names only
a place prefers the place and never a point of interest. Anything wider than a
suburb (`state`, `county`, `country`, `administrative`) is `coarse` and never
an answer.

**Precision is what the provider matched, in the assessor's words.**
`addresstype` → `house` (`address`), `road` (`street`), `suburb`/`town`/…
(`locality`), `postcode` — each mapped onto the Google-shaped type the
granularity gate already judges.

**Etiquette.** The `User-Agent` is `npc-property-dashboard/1.0 (+repo URL)` —
the product, never a person and never an email address. One request a second
per application, held in the shared limiter (§3). Nominatim's policy forbids
using it for autocomplete, which is why the address field uses Photon (§5).

## 5. Photon, for the address field (`osmAutocomplete.pure.ts`)

`google-places-autocomplete` keeps its name, its route and its response
projection — `{ placeId, description, mainText, secondaryText }` — because
`AddressAutocomplete.tsx` and the three portal forms read exactly that, and
they use one field of it: the chosen prediction's `description` becomes the
address text. The provider behind it is `ADDRESS_AUTOCOMPLETE_PROVIDER`:
`osm` (Photon, the default) or `google` by an operator's explicit choice.
Any other spelling is the default.

Three rules. **A point of interest is never an address suggestion** — a bus
stop, a petrol station and a self-storage yard all sit on Leakes Road; a
feature under an amenity, shop or transport key is dropped unless it carries a
house number, and then it is offered as its ADDRESS. **The typed house number
is kept**: OSM holds address points for a fraction of Australian houses, so
most answers are the street, and a description without the number the person
just typed would delete their own input. **Every line ends in the state code
and postcode when known**, because that is what `parseAddressText` reads
downstream.

The endpoint's abuse controls are unchanged: per-IP and per-session quotas,
input cap, timeout, redacted upstream errors. The circuit breaker is **per
provider** (`osm_autocomplete` / `google_places`) so an outage at one cannot
open the other, and `GOOGLE_PLACES_KILL_SWITCH` still stops the endpoint
whichever provider answers.

## 6. The ABS boundary server (`absLocality.pure.ts`)

`geo.abs.gov.au` serves the ASGS 2021 boundaries the report geography already
resolves through. Two more questions it answers here: a suburb's own polygon by
name (`SAL_NAME_2021`, matched under the ABS qualifier — `Glenelg (SA)`,
`Richmond (Vic.)` — with the state pinned by `STATE_NAME_2021`) whose centroid
is the `locality` answer, and the council a point falls in (`LGA` layer,
point-in-polygon), asked with `wantLga: true` because Queensland's sales
register is by council and Truganina alone straddles Melton and Wyndham.

The centroid is computed by the shoelace formula over the largest outer ring;
holes are ignored. It is a floor, not a substitute: never offered where a street
was asked for and could have been found.

## 7. What each call site does now

| Function | Before | Now |
|---|---|---|
| `resolve-listing-coordinates` | Google, `GOOGLE_MAPS_API_KEY` required, `google_listing_geocoding` breaker | The chain; `GEOCODING_KILL_SWITCH` stops it; breaker `listing_geocoding`; `listing_geocodes.provider` records `nominatim` / `abs_locality` / `google`; `precision` carries `nominatim:street` etc., read by `describeGeocodePrecision` on the map by its suffix; fresh lookups stop after a **20 s wall-clock budget** and the rest are reported as `pendingLookups`, which the client already drains |
| `location-intelligence-service` | Google geocode, then Places and Distance Matrix; no key → `not_configured` for the whole measurement | The chain for the geocode; the key gates only the amenity and commute calls, which are recorded as unmeasured without it — a coordinate is a measurement in its own right |
| `parse-property-pdf` | Google, only when a key was set | The chain, always, never the locality floor |
| `estimate-capital-growth` | Google with the daily cap and the body judge | The chain with `wantLga: true`; `locationType` reads `<provider>:<precision>` |
| `google-places-autocomplete` | Google Places | Photon by default; Google by choice |

Nothing in the frontend changed except `describeGeocodePrecision`, which learned
the chain's suffix form.

## 8. Configuration

Every setting below is a **project environment variable** — a Supabase secret
on the deployment, set the way `OPENAI_API_KEY` is. None of them is required:
the defaults are the shipped behaviour and a deployment that sets nothing
geocodes correctly.

| Name | Default | Meaning |
|---|---|---|
| `GEOCODER_PROVIDERS` | `gnaf,nominatim,photon,abs_locality` | The order. Add `google` to make Google a last resort. A misspelt value falls back to the default, never to "no providers". Photon joined the default on 24 Sep 2026 (§17), and G-NAF leads it wherever a register is configured (§18). |
| `GEOCODER_GNAF_URL` | unset | The G-NAF register the product's own address service serves (§18) — `https://<app>.fly.dev/<token>/gnaf`, written by the deploy workflow once the service has proved itself. Unset, the `gnaf` provider is skipped without a request. |
| `GEOCODER_OSM_URL` | `https://nominatim.openstreetmap.org` | A self-hosted Nominatim (§10). |
| `GEOCODER_PHOTON_URL` | `https://photon.komoot.io` | The Photon the chain asks for a street address (§17). Falls back to `AUTOCOMPLETE_PHOTON_URL`, then the public instance — so pointing the address field at a self-hosted copy points the chain at it too. |
| `OSM_GEOCODING_DAILY_LIMIT` | `2000` | The day's geocoding allowance across the deployment, shared by Nominatim and Photon. |
| `ADDRESS_AUTOCOMPLETE_PROVIDER` | `osm` | `osm` or `google`. Any other spelling is `osm`. |
| `AUTOCOMPLETE_PHOTON_URL` | `https://photon.komoot.io` | A self-hosted Photon (§10). |
| `OSM_AUTOCOMPLETE_DAILY_LIMIT` | `5000` | The day's Photon allowance. |
| `GEOCODING_KILL_SWITCH` | unset | Stops `resolve-listing-coordinates` geocoding at all (503, and the client backs off). |
| `GOOGLE_GEOCODING_KILL_SWITCH` | unset | Stops the Google PROVIDER only, through `consumeGoogleDailyCap`. |

### Why these are not on the Integrations page

They were, for one commit, and the card was wrong twice over.

The Integrations page is a register of **credentials**: every card maps to a key
an edge function or the browser reads, and the page derives a card's status from
its **required** fields alone — `configuredFields.length === 0` is
`not_configured`. These providers are free and keyless, so every field on such a
card is optional, the required set is empty, and the card reads **"Not
configured" for ever**, however the deployment is set, for a geocoder that is on
by default and working. Measured across all 144 cards at the time, it was the
only one with no required field. A register that prints a false status about
itself is worse than a register that does not mention the thing.

The second fault: a card on that page must have at least one workflow operation
(`catalog.spec.ts` pins it — an app an operator can configure is an app they can
use). The only honest operation would be "geocode an address", and a live
workflow step calling Nominatim through the generic executor bypasses
`osmAllowance.ts` — no daily ceiling, no one-request-a-second turn. A workflow
looping five hundred rows through it would breach OpenStreetMap's usage policy
under this product's own User-Agent and get it **blocked**, taking the listings
map, the reports and the address field down together. A palette entry with no
request descriptor would instead be a step that draws and does nothing.

So the rule that put the Google caps on that page does not reach here, and
reading it again says why: it is about a **spending** limit on a paid vendor,
where a ceiling nobody can see is a ceiling nobody can raise before a bill
arrives. Nothing is spent here. `allowedSecrets.test.ts` now fails on any card
whose every field is optional, and `geocoderWiring.spec.ts` asserts this table
names every setting the runtime reads, and that the runtime reads every setting
this table names.

### The migration

`20261128090000_geocode_cache.sql`: the table, RLS on with no policy
(service-role only), and `geocode_cache_touch(text)` granted to `service_role`
alone. Apply it through `apply-migration.yml` after the merge; the chain works
without it (a failed cache read is a miss, a failed write is a warning), but
every allowance assumes it.

## 9. Production proof

Measured against production on 16 September 2026, after the merge of #2677
deployed every function (deploy run 35051461790, completed 03:36:48Z) and
`apply-migration.yml` run 35051482023 applied the cache migration. pg_net
request ids in brackets.

| Step | Evidence |
|---|---|
| Migration applied, `geocode_cache` present | 18 columns, RLS on, **0 policies**, `geocode_cache_touch` present. Read from the catalogue, not from the workflow's word. |
| Autocomplete answers from Photon | [247817] `200 {"success":true,"predictions":[{"placeId":"osm:W:1298039489","description":"10 Leakes Road, Truganina VIC 3029",…}]}` — an OpenStreetMap **way id**, so Photon answered; the same query returned `502 upstream_error` from Google Places on 16 Sep. The typed house number `10` is carried onto the street suggestion, as §5 requires. |
| A geocode resolves through Nominatim | `provider: nominatim`, `precision: street`, `provider_precision: road` — the `addresstype` mapping of §4, on the real answer. |
| The council comes from the ABS | `lga: Wyndham`, `lga_code: 27260` at `-37.83753, 144.72653`. Truganina straddles **Melton and Wyndham**, and the point-in-polygon query returns the one the coordinate is actually in — the case §6 exists for. |
| The suburb, state and postcode travel | `Truganina` / `VIC` / `3029`, with `matched_address` `Leakes Road, Truganina, Melbourne, Victoria, 3029, Australia`. |
| The licence travels with the coordinate | `attribution` reads `Data © OpenStreetMap contributors, ODbL 1.0. https://osm.org/copyright`. |
| A second ask is a cache hit | [247828] `200`, `geocode_cache` still **1 row**, `hit_count` 0 → 1, `last_hit_at` 03:38:26Z against `resolved_at` 03:37:56Z. The second ask spent no Nominatim call, which is what every allowance in §3 assumes. |
| Estimate CGR reads the chain's geography | [247819] `200 {"found":true,"ratePct":5.5,"level":"suburb","areaName":"Truganina, VIC"…}` — the Victorian register, reached through the geography the chain resolved. |

Not proved here, and why: a listing pin through `resolve-listing-coordinates`
is driven by the map's own sweep from a signed-in staff session, so it is
proved by use rather than by a probe. The chain it calls is the one measured
above, and `listing_geocodes.provider` records which provider placed each pin.

## 10. Scale, and the end state

The public Nominatim and Photon are run by volunteers for everybody. They are
right for this product's measured volume (tens of geocodes a day, a listings
sweep that the cache absorbs after its first pass) and wrong for a fleet of
clones each asking on its own: the allowance is per deployment and the
policies are per application. Two steps up, neither built here:

1. **Self-host on Fly.io.** `mediagis/nominatim` with the Geofabrik Australia
   extract, and `komoot/photon` built from it, behind `GEOCODER_OSM_URL` and
   `AUTOCOMPLETE_PHOTON_URL`. No code changes; the etiquette limits stop
   applying to a host you run, and the allowances become yours to set.
2. **G-NAF.** Geoscape's Geocoded National Address File is the authoritative
   register of every Australian address with a rooftop coordinate, published
   quarterly under an open licence. Loaded into the project's own Postgres it
   is a fourth provider answering `address` precision for every real address —
   and the only one that can. That is the commercial-grade end state; it is a
   loader and a provider, not a redesign, because the chain and the contract
   already exist.

## 11. What still asks Google

This programme moved the geocode and the address field, and §13 then moved
the last three surfaces. Google is now the TAIL of every location chain
rather than a dependency: amenities read the local OSM register first
(`AMENITY_PROVIDERS`, default `register,google`), the commute asks OSRM
first (`COMMUTE_PROVIDERS`, default `osrm,google`), and street imagery asks
Mapillary first (`STREET_IMAGERY_PROVIDERS`, default `mapillary,google`).
The Google key is spent only where the free provider could not answer —
a register slice not yet loaded, a routing outage, a street Mapillary's
crowd has not photographed — and an operator removes `google` from any of
the three orders to stop that surface spending it at all.

Why these three defaults still name Google where the geocoder's default
does not: the geocoder's free chain answers at request time for every
address, from day one. These three cannot promise that on day one — the
amenity register answers only after its first ingest, OSRM is somebody
else's live server, and Mapillary needs a token no deployment has minted
yet — so shipping a Google-free default would have turned real readings
into nulls on deploy day, which is a broken deployment, not a saving. The
free provider takes over the moment it can answer, with no configuration
change.

A deployment without the key measures its coordinate, its transport
reading, its crime area, its geography, its amenities (once the register
loads), and its driving commute — and records anything unmeasured as
unmeasured, never as zero (RF-7.2B.1B2's rule, unchanged).

## 12. What stays unverified until the merge

- Nominatim's precision on rural and builder-stock addresses (a lot number
  is not a street number: the composition rules in `ADDRESS_COMPOSITION.md`
  still decide what the chain is asked).
- The one-request-a-second turn under concurrent isolates — the limiter
  holds it by construction; it has not been measured under load.
- The ABS qualifier for every suburb name the register carries.
- Everything in §9.

## 13. Amenities, commute and street imagery without Google

The three surfaces §11 used to list as "still Google" each have a free
provider now, behind the same order-variable pattern as
`GEOCODER_PROVIDERS`. `_shared/openLocation/` holds all of it.

### 13.1 The amenity register (`amenity_register`, migration 20261130090000)

Schools, healthcare, shopping, recreation, restaurants and rail transit,
per state, loaded from a public Overpass instance **on a schedule** and
read **locally** at enrichment time. It is a register and not a
request-time call because the measurements said so (§14): the same
hospital query answered in under two seconds and then queued past 25 s an
hour later, and this project's egress is a shared NAT whose per-IP
fairness slots other tenants spend. The platform's own doctrine (the PEP
engine, GTFS stops, crime, sales medians) answers that shape one way:
load on a schedule, read locally, and a queueing mirror delays a
background retry rather than a report.

- **Ingest** — `amenity-register-ingest`, one pg_cron job per state at
  16:00 UTC (staggered 6 min), walking the six categories with the start
  rotated by day so a budget-clipped tail is a different tail tomorrow.
  Each slice is one Overpass CSV query (named columns, header verified)
  carrying `[timeout:90]`, behind `awaitOsmTurn` and the `amenities`
  allowance, identified by `GEOCODER_USER_AGENT`, tried against the
  mirror list in order. Slices upsert under their sync id and prune other
  sync ids only after every batch lands, so a run that dies leaves the
  previous load standing. A parse of zero rows is refused (no Australian
  state holds zero schools), and a slice whose newest successful load is
  older than `AMENITY_REGISTER_MAX_AGE_DAYS` reads as **unavailable**,
  never as quietly current — the daily refresh is what keeps the data
  live, and the ceiling is what stops a broken refresh serving old data
  silently.
- **Read** — `location-intelligence-service` walks `AMENITY_PROVIDERS`
  per category: the register answers every category whose
  (category, state) slice is current, and Google Places is asked — in
  parallel, through the untouched `fetchNearbyPlaces` — only for the
  rest. The lookup shape, radii (Google parity, except transit at
  2,000 m so `stationsWithin2km` is finally label-true and agrees with
  the GTFS reading), distance rounding, `count` cap of ten, walk score,
  amenity scores and the acquisition stamp are all byte-compatible;
  `stages.amenitySources` records who answered what and
  `stages.amenityRegisterLoadedAt` carries the register's currency into
  the stored object. `school-data-service` reads the same slice between
  the schools directory and Google, maps sector from the element's own
  tags (never the old hardcoded `'Government'`), and still answers
  `sourceUnavailable` rather than "0 schools" when nothing holds data.
- **Zero rows for a state never loaded is not "no schools here"** — the
  read consults the sync ledger before any rows, and a subject whose
  state cannot be normalised gets `unavailable` and the next provider.

### 13.2 The commute (OSRM)

`COMMUTE_PROVIDERS` (default `osrm,google`). OSRM's public router
(`router.project-osrm.org`) measures a **driving** route and the reading
says `mode: 'driving'` — the demo graph has no timetables, and wearing
the Google path's `public_transit` label over a different measurement
would be a lie. The one numeric consumer (`commuteTimeCBD` in the legacy
V1 score engine) reads minutes in ≤15/≤25/≤40/≤60 bands; the generator
prompt has been forbidden from narrating a commute since RF-7.2B, and
`safeGenerationInputs` strips the block. OSRM's own `NoRoute` is final —
an answer about the geometry — while an unreachable router or a spent
`routing` allowance hands the question to the next provider. Rounding is
byte-identical to the Distance Matrix mapper's, pinned on the measured
route in §14.

### 13.3 Street imagery (Mapillary)

`STREET_IMAGERY_PROVIDERS` (default `mapillary,google`). Mapillary
serves crowd-photographed, CC BY-SA 4.0 street-level imagery through the
Graph API under a free client token — `MAPILLARY_ACCESS_TOKEN`, a real
credential and therefore a real Integrations card (unlike the chain
settings below it). The `street-view` function walks the order: without
a token the mapillary branch skips with no network call and Google
serves exactly as before; with one, the nearest image within ~120 m is
served in the same envelope (base64 preview, `panoramaDate` as
`YYYY-MM`, the attribution in `copyright`), a Mapillary street nobody
has photographed falls through to Google, and only when every provider
has answered "nothing here" does the panel's `ZERO_RESULTS` reading
appear. Each provider has its own circuit scope
(`google_street_view`, `mapillary_imagery`); an open circuit on a
non-final provider skips it rather than 503ing a chain that may still
have an answer.

### 13.4 The new settings

Environment variables, like §8's (and for the same reason — free,
keyless, on by default; `MAPILLARY_ACCESS_TOKEN` alone is a credential
and lives on the Integrations page):

| Name | Default | Meaning |
|---|---|---|
| `AMENITY_PROVIDERS` | `register,google` | Amenity order for the location service and the school service. Remove `google` to stop those surfaces spending the key. |
| `COMMUTE_PROVIDERS` | `osrm,google` | Commute order. |
| `STREET_IMAGERY_PROVIDERS` | `mapillary,google` | Street imagery order. |
| `OSM_AMENITIES_DAILY_LIMIT` | `200` | The ingest's daily Overpass allowance (a full refresh spends 48 slice queries). |
| `OSRM_ROUTING_DAILY_LIMIT` | `1500` | The day's OSRM allowance — one route per commute measurement. |
| `AMENITY_REGISTER_MAX_AGE_DAYS` | `30` | How old a slice's newest successful load may be before the read declines in favour of the next provider. |
| `MAPILLARY_KILL_SWITCH` | unset | Stops the Mapillary branch only; the chain continues. |

## 14. The measurements behind §13 (16 Sep 2026, production egress)

Every decision above is a measurement, each disclosed with its pg_net
request id at the time it was made.

- **The main Overpass instance is unusable from this egress.**
  `overpass-api.de` answers 406 from Apache's front door before Overpass
  sees the query [248210]. It is deliberately absent from the mirror
  list.
- **A mirror's latency is not ours to schedule.** kumi.systems served
  ODbL-stamped JSON in under two seconds [248211, 248223, 248235] and
  then queued the SAME hospital query past 25 s [248352], alongside a
  25 s timeout on a single-category restaurants query [248347] and 30 s
  on a six-set union [248254]. VK's mirror (`maps.mail.ru`) answered the
  identical hospital query sub-second at the same moment [248394] — so
  the ingest carries a mirror list, and the READ path never talks to a
  mirror at all.
- **Every query carries `[timeout:]`.** Probe 248254 carried none, so
  the server ran its 180 s default long after pg_net hung up at 30 s —
  an abandoned request that kept costing a free service.
- **Exact tag values, never a value regex.** `shop~"^(mall|…)$"` forces
  a scan of every `shop=*` in the country and 504'd [248416]; the same
  ask as a union of exact values answered in about a second with 8,321
  elements [248430]. The query builder cannot spell a regex.
- **`nw`, never `node`; relations excluded.** A node-only schools query
  found 0 where 13 exist (schools are ways) [248211 vs 248235], and the
  one `nwr` probe drew the mirror's own 504 [248224]. `out center` fills
  a way's coordinates.
- **One request at a time.** Two of three concurrent probes were dropped
  outright [248222, 248236, 248237]; the shared turn limiter holds the
  line the same way it does for Nominatim.
- **Register sizing** (AU-wide `out count`, mail.ru): schools 10,157
  [248403], healthcare 5,824 [248407], shopping 8,321 [248430],
  recreation 70,750 [248439], restaurants + cafés 32,238 [248450];
  transit's four-way union count 504'd [248468] and is small by
  construction (~4–6 k rail stations, halts and tram stops) — ~130 k
  rows in all, inside the scale `transport_stops` already proves
  (185,177 rows).
- **The CSV contract, verbatim** [248491]: header row
  `@type	@id	@lat	@lon	name	amenity	…` (builtins print `@`-prefixed,
  plain names unquoted, tab-separated), way rows carry centre
  coordinates, and the ACT schools slice pins the parser's fixtures —
  including `Mackillop Catholic School` with EMPTY tag columns (sector
  reads `Other`: a NAME is never evidence) beside `St Vincent's Primary
  School` with `denomination=roman_catholic` (sector reads `Catholic`).
- **OSRM answers this egress** [248212]: a Truganina → Melbourne CBD
  route, `code: "Ok"`, duration 1411.9 s / distance 23441.3 m — the
  parser's fixture, rounding to 24 min / 23.4 km exactly as the Distance
  Matrix mapper would.
- **Mapillary answers its own refusal** [248213]: HTTP 500 with
  `MLYApiException` code 190 (`Invalid OAuth 2.0 Access Token`) — the
  vendor was reached and named the problem, the refusal-is-the-pass
  reading `verification_selftest` established. A real image cannot be
  proven until an operator mints the free token; that is named in §12's
  successor list below.

What §14 left unverified was obtained on merge day; §15 records it.

## 15. Production proof (merged 16 Sep 2026, PR #2680)

Migration 20261130090000 applied via `apply-migration.yml` (run
35059719049) and verified by effect: both tables live, the eight
refresh jobs in `cron.job` at 16:00–16:42 UTC, `amenity_register_refresh`'s
live ACL `postgres=X, service_role=X` (no PUBLIC, no anon, no
authenticated), RLS enabled. The merge's deploy run (35059693098)
verified 341 functions against the production host.

**The first loads, by their ledger** (fired through the cron's own
wrapper, `public.amenity_register_refresh`):

- NSW: all six slices — schools 3,304 · healthcare 1,521 ·
  shopping 2,415 · recreation 18,522 · restaurants 10,232 ·
  transit 716 = 36,710 rows. The first invocation loaded five in
  101.5 s and HANDED OFF transit on the run budget exactly as designed;
  a categories-scoped second invocation finished it in 29 s.
- VIC: schools 2,554 · healthcare 1,744 · shopping 2,087 ·
  restaurants 9,390 = 15,775 rows; recreation and transit failed on
  both mirrors (fetch aborted at the ceiling) and are RECORDED failed —
  the previous load (none) stands, the read declines those two slices
  to the next provider, and the nightly refresh retries.
- QLD: schools 1,836; then even light categories began failing —
  after ~35 requests in 25 minutes the mirrors throttle this egress,
  which is precisely why coverage is the STAGGERED nightly cron's job
  (eight states, six minutes apart, category rotation) and not a
  burst backfill's. The burst was for proof; the schedule is the
  design.

**A Google-free enrichment through the deployed service** (pg_net
249308, Harris Park NSW): geocode `fetched` by the chain
(-33.8208516, 151.0092054), every amenity category answered by the
register — nearest school St Oliver's Primary 0.41 km, a `doctors`
practice at 0.09 km, Rosella Park, a supermarket at 0.03 km — walk
score 100, transit from GTFS as preferred, and the commute measured
by OSRM: `mode: "driving"`, 22.5 km, 23 minutes to the Sydney CBD.
The acquisition stamp reads `places: "complete"`,
`placesUnavailable: []`, `commuteProvider: "osrm"`,
`amenitySources` = `register` for all six, and
`amenityRegisterLoadedAt` carrying that morning's per-slice load
times — the currency promise, kept on the record itself. Not one
Google call was spent.

**The school service from the same slice** (pg_net 249318):
`dataSource: "OpenStreetMap Amenity Register"`, twenty schools with
the ODbL attribution and the slice's load date in the note, and the
sector reads `Other` where the element's tags state none — never the
old hardcoded Government.

**And one bug the failures taught, fixed the same day**: the VIC
recreation aborts were OUR client hanging up at a 60 s fetch ceiling
under the query's own `[timeout:90]` server grant — losing answers the
mirror was still lawfully computing, the very discourtesy the
`[timeout:]` discipline exists to prevent. The ceiling now sits above
the grant (100 s), the whole-union attempt gets a 50 s first window
(the heaviest union that ever succeeded took ~40 s), and a union that
outgrows it is re-asked per tag pair and merged — with every pair
required to succeed, because a category missing one pair's rows would
undercount as confidently as a complete one. A run scoped to named
categories is a repair, not the nightly sweep, and gets budget for the
ladder.

**And the hold-back the fix left behind, measured on the first slow
night.** On 16 Sep 2026 the nightly sweep (16:00–16:42 UTC) met a
mirror answering in ~45–50 s a request, and `schools` failed outright
in VIC and QLD — aborted at the 50 s union-first window with nothing
behind it. That window is a HOLD-BACK FOR THE LADDER, and `schools` is
a category of ONE tag pair: its union is its only query, so the
shorter window bought nothing and cost the difference between 50 s
and the 100 s ceiling it was entitled to. A single-pair category now
gets the whole ceiling on its first and only attempt
(`filters.length > 1 ? UNION_FIRST_WINDOW_MS : FETCH_CEILING_MS`), and
the ladder still runs only where there is more than one pair. The
multi-pair failures that same night were the run BUDGET rather than
the window — six categories against 120 s at 50 s a request — which
is the designed hand-off: the starting category rotates by day, so a
clipped tail is a different tail tomorrow, and a slice that failed
leaves the previous load standing rather than emptying an area.

Two observations for the record. One campus appeared twice in
`topSchools` (an OSM node AND way both tagged for it) — the register
deliberately does not merge same-name elements, because absent
evidence never merges; if it grates in documents, the fix is a
distance-epsilon + name dedupe at the READ, decided then, not
silently here. And the register's `count` fields cap at ten by
contract (the Google path's own slice), so dense-area counts read 10
exactly as they always have.

**And the Mapillary image, end-to-end** (pg_net 249584, later the
same day): the owner registered a READ-only application, saved the
client token on the Mapillary card, and the deployed `street-view`
answered the Harris Park coordinate `success: true, available: true`
with a 137 KB base64 JPEG, `panoramaDate: "2019-01"` and
`copyright: "© Mapillary, CC BY-SA 4.0"` — the free provider serving
first in the same envelope the panel has always rendered, Google
standing by for streets the crowd has not photographed. Nothing in
the programme remains unverified. One operator note: Mapillary's
capture dates vary by street (this one is 2019); the panel shows the
date, and an operator who prefers Google's fresher imagery for a
deployment simply reorders `STREET_IMAGERY_PROVIDERS`.

## 16. An address the chain could not read (24 Sep 2026)

Report `79d677d6` (93 Schofields Farm Road, created from a realestate.com.au
listing) was written with its geography unresolved: eight evidence sources
missing, data completeness 33%, grade withheld. The address never placed, and
the production log said why in two lines:

```
07:46:18  [geocoder] location-intelligence-service/geocode: nominatim: 0 candidate(s), none an address
07:46:18  [geocoder] location-intelligence-service/geocode: abs_locality: no suburb named (tallawong) in NSW
```

Four faults, stacked:

1. **The composer dropped the suburb** (`src/lib/reports/propertyAddress.pure.ts`).
   The scrape returned the street `93 Schofields Farm Road (tallawong)`, the
   suburb `Schofields`, `NSW` and `2762`; "never repeat a part the address
   already carries" found the word *Schofields* inside the **street name** and
   left the suburb out. A suburb is now judged by POSITION — a later
   comma-separated part, or the words the address ends with once its state and
   postcode are set aside — so a street named after its suburb (Schofields Road,
   Blacktown Road, Rouse Hill Drive) keeps it.
2. **A bracketed note sat where the suburb is read.** `(tallawong)` is the
   listing agent's note of the neighbouring suburb: the development is split,
   some of it Schofields and some Tallawong (the owner's own reading of the
   listing). `stripAddressAnnotations` removes a bracketed note before anything
   reads the address, the cache key included.
3. **A comma-less address handed Nominatim its state and postcode as the
   street.** `streetLineOf` sets aside a trailing postcode, state abbreviation
   (or a full state name followed by a postcode) and country — and the suburb
   where one is known — from the first part. A state's full name on its own is
   not stripped: "12 Victoria" is a street line.
4. **A suburb is a filter the street may not need.** On a development split the
   listing's suburb and the one OpenStreetMap files the street under can
   differ, and a structured search with the wrong `city` finds nothing. Where
   the street and the postal area are both known the plan asks once more
   WITHOUT the suburb. That question is there to find the STREET, so
   `suburblessAnswerRefusal` accepts only the house or the street, and only
   where the answer names the postal area asked: a suburb or postcode centroid
   is the locality fallback's job under the suburb's own name, a different
   postal area is a different street of the same name, and an answer naming
   none cannot show it is on this one. The bracketed place name is kept as
   the locality fallback's **second** candidate (`annotatedLocalities`), tried
   only after the first finds nothing.

Where the caller names no state, the plan reads it from the text, and that
read had its own fault, found alongside these rather than observed: the first
state name ANYWHERE, so `5 Victoria Street, Brisbane QLD 4000` was asked in
Victoria. It is now the state word in the locality position
(`localityStateOf` — followed by nothing but a postcode and the country), the
same rule the report generator's intake reads by.

What is asked is decided in `geocodePlan.pure.ts` and tested without a network;
`geocoder.ts` does the I/O and follows the plan. **The suburb a report's
evidence is keyed on is not decided here at all** — once a point is found the
report resolves its geography from the point, so a house on either side of a
split is described by the suburb it actually stands in. Under an ASGS edition
that predates a new suburb, that is the older suburb, which is what the edition
says.

The chain was driven against a stubbed Nominatim and ABS (the sandbox reaches
neither): on the code before this change it asked `street=93 Schofields Farm
Road (tallawong) NSW 2762 city=(tallawong)` and then the ABS for
`(TALLAWONG)` — the production failure, reproduced — and after it, the stored
address resolves at address precision on the first question, the composed one
on the second, and with OpenStreetMap silent the ABS is asked for Tallawong.
A second-question answer in another postal area, one that is only the
postcode's centroid, and one that names no postcode are each refused, and the
ABS suburb centroid answers instead. An ordinary comma address asks exactly
the question it asked before, under the same cache key (asserted in
`geocodePlan.spec.ts`).

**The composer had the mirror-image fault.** Judging the suburb by position
reads each comma-separated part with its locality tail set aside, and set
aside to the END, `Mount Victoria NSW 2786` loses the word that makes it
(`victoria` is a state name) and reads as "mount" — so the suburb would have
been added a second time. Every reading along the way is kept and compared,
not only the last (`propertyAddress.spec.ts`, Mount Victoria and Port
Victoria).

**Not verified until deploy:** that Nominatim itself holds 93 Schofields Farm
Road. The harness proves the question; the answer is OpenStreetMap's. If it
does not, the ABS suburb centroid is the floor, which resolves the geography
at suburb grain.

## 17. The day OpenStreetMap said no (24 Sep 2026)

From **07:51:29 UTC** the public Nominatim answered **HTTP 403** to every
request from the production egress. Measured from the function logs, the last
success was at 07:49:25 (`estimate-capital-growth`, `1408/5 SECOND AVE,
Blacktown NSW 2148`, street precision). The eight minutes before the refusal
held about a dozen requests, most of them one question asked over and over:
report `79d677d6`'s continuations re-asked the unfindable `93 Schofields Farm
Road (tallawong) NSW 2762` every thirty seconds. The six hours before that held
two. Our functions share outbound addresses with other Supabase customers, and
Nominatim blocks by address, so **the cause is not established**. The log
carried `nominatim answered 403` and nothing else, and the refusal page — which
says why — was discarded unread.

The chain then did exactly what §2 designed it to do. It fell through to the
ABS suburb centroid, and so it placed two properties in the middle of their
suburbs. Five faults turned that fallback into wrong reports.

1. **The centroid was remembered as the address.** `geocode_cache` held that "a
   hit is the answer; nothing expires, because an address does not move". The
   centroid was written there, so neither a regeneration nor the refusal lifting
   could ever have placed these two properties again.
2. **The precision was dropped.** The geocoder's answer said
   `precision: 'locality'`. `location-intelligence-service` returned the point
   and discarded that field.
3. **Every enrichment point was called a parcel.** `enrichmentCoordinate`
   stamped every enrichment point `address`, the one precision its own module
   says may select a planning control. So Blacktown's planning registers were
   asked at the middle of Blacktown. The report stated **"R2 — Low Density
   Residential" for a fourteenth-floor apartment**, under a sentence calling the
   point "the property's verified coordinate".
4. **The centroid's readings scored the property.** Its walk score, commute and
   school count verified as the property's own and scored Location.
5. **The planning answer would have been reused.** It carried no record of
   where it was read. Reuse keeps a `cadastral` answer for thirty days, so every
   regeneration would have been served the same wrong zone.

What each became:

- **Photon is the chain's second street-level provider**
  (`photonGeocode.pure.ts`; default order `nominatim,photon,abs_locality`;
  `GEOCODER_PHOTON_URL`, falling back to `AUTOCOMPLETE_PHOTON_URL`). It reads
  the same OpenStreetMap data behind a different operator, so one operator's
  refusal no longer drops the chain to a suburb.
  - It is held to a stricter match than the address field's suggestions,
    because nobody chooses between its candidates.
  - A house is accepted only when its number AND street agree with the ask.
  - Either way, the answer must stand in the postal area asked (or in the
    suburb, where no postcode can be compared).
  - A lot number is never read as a street number.
- **A refusal pauses the provider that sent it**
  (`geocodeChainPolicy.pure.ts`: 403 → 30 min, 429 → its `Retry-After` inside
  1 min–6 h, a failing 5xx → 1 min). The refusal's own first words and its
  `Retry-After` are logged.
- **An answer coarser than a street is never remembered while a street-level
  provider could not be asked** (`cacheVerdict`).
- **A remembered answer coarser than a street is provisional.** Where the
  question names a street, the street-level providers are asked again once the
  row is an hour old.
  - A finer answer replaces it.
  - A finer "no such street" re-dates it.
  - A finer outage leaves it standing.

  That is what repairs the rows the outage wrote, with no migration and no row
  deleted by hand. A caller that refuses a suburb-level answer (the PDF import)
  is no longer handed one from the cache.
- **The point's precision travels with everything measured from it.**
  - The location service stamps `stages.geocodePrecision` / `geocodeProvider`.
  - `enrichmentPoint.pure.ts` is the one reader.
  - `enrichmentCoordinate` and `recoveredCoordinate` share one rule: `address`
    reads planning; `street` reads it and the page says "at a point on the
    property's street"; a suburb or postal-area centre is `too_coarse`.
  - The page then says the registers were not asked, and why, rather than
    printing a neighbouring zone.
- **An area centre's readings are neither scored nor stated as the property's.**
  - `locationInputVerification` has a rule 4, and the grade's gap reads
    `LOCATION_MEASURED_AT_AREA_CENTRE`.
  - The amenity and transport blocks open with where the figures were measured
    from.
- **Reuse asks what the point was.**
  - An enrichment with no recorded precision is re-acquired.
  - One measured at an area centre is reused only within six hours — one
    generation's continuations.
  - A planning answer is reused only where it records a point at the property
    or its street (`planningPointIsRecorded`).

**Migration `20261220090000`** widens `geocode_cache.provider`'s CHECK to admit
`photon` and `gnaf`. Without it, a Photon answer is served but refused at the
insert, which is the repeated question this section exists to stop. The code
ships in either order: a refused cache write logs and the answer still stands.

**What stays unverified until deploy:**

- whether Photon answers the production egress (the address field's own
  Photon calls do not appear in today's logs);
- whether it holds `5 Second Avenue` as a house;
- what the refusal page says. The next 403 will log it.

The durable answer to "a public service can refuse us at any time" is the one
§10 already names: our own copy of the lookup service, and G-NAF as the
provider that places every real address on its own block. The owner approved
both on 24 Sep 2026.

## 18. Our own address service (G-NAF + Photon)

Both durable answers §17 names are built, as one service:
[`ADDRESS_SERVICE.md`](./ADDRESS_SERVICE.md).

- **G-NAF** is the national address register: 15.9M addresses, 98% of them
  geocoded at the address itself. It is served as static files, one per postal
  area, and read by the `gnaf` provider (`gnafShard.pure.ts`), which leads the
  default order and is skipped without a request where `GEOCODER_GNAF_URL` is
  unset.
- **Photon** runs on the same machine over the Australia–Oceania index, behind
  `GEOCODER_PHOTON_URL` and, where it is unset or already ours,
  `AUTOCOMPLETE_PHOTON_URL`.
- **A copy this product runs is never held to the public allowance or the
  one-a-second turn** (`isPublicPhotonBase`, one rule for the address field
  and the chain).

The register is **not** in the database, because it would add sixty per cent
to it, needs a credential the repository does not hold, and would never reach
a clone. Every build is proved in CI before anything serves it: the register
checked against itself, the image run in the runner, the real chain asked for
the owner's addresses. A deploy is a person's dispatch, at ≈ A$19–24 a month
for one always-on machine.

## 19. The first run through the register, and the street answer it missed (25 Sep 2026)

The owner regenerated three reports at 00:18 UTC, the first production use of
the register. Read from `function_logs`:

| Report | Placed by | Precision | Zone read there |
|---|---|---|---|
| 93 Schofields Farm Road (tallawong), Schofields NSW 2762 | `gnaf` | address | R2 — Low Density Residential |
| 1408/5 SECOND AVE, Blacktown NSW 2148 | `gnaf` | address | MU1 — Mixed Use, Blacktown (the suburb centroid had read R2) |
| 60 Lawley Street, Spalding WA 6530 | `nominatim` | street | none — WA zoning is licence restricted |

The first two are rule 2 working as written: `the remembered locality answer
is provisional — asking the street-level providers again`, then G-NAF.

The third is the defect. There is no `[geocoder]` line for it, because the
answer came from `geocode_cache`: OpenStreetMap's street point, remembered
before the outage. Rule 2 re-asks only an answer coarser than a street, on the
ground that an address does not move. That is true of an address answer. A
street answer is what a provider gives when it found the street and not the
lot, and every one in the cache was written before the register existed, so
the one provider that can see the lot was never asked. The register's own proof
run (§18) places this address at its property centroid (`PC`).

Three changes, one rule each:

1. **Rule 4** (`geocodeChainPolicy.pure.ts`,
   `rememberedStreetAnswerIsProvisional`). A remembered street answer is put
   to the register once it is an hour old, where the ask names a number or a
   lot, a register is configured, and the operator's `GEOCODER_PROVIDERS`
   still names it. The register alone is asked. Its address point replaces the
   street and is remembered; "nothing finer here" re-dates the street answer
   for an hour; an outage of ours leaves it exactly as it was. A street the
   register placed itself is never re-asked.
2. **A stored enrichment measured from a street point stands through the
   generation that measured from it, and is placed again when the next one
   starts** (`streetPointIsStale` in `enrichmentPoint.pure.ts`, refused as
   `street_point_stale`). "Starts" is measured by what the generation has
   written, not by the clock: a generation that has written sections keeps its
   point however long it runs, because every section was measured from it,
   and one that has written nothing asks again unless it placed the point
   itself in the last hour (`STREET_POINT_REUSE_HOURS`, the hand-off before a
   first section). Unlike the area-centre refusal, it still stands in when the
   re-fetch fails: a street reading is sound, and was refused only in the hope
   of a better one.
3. **A reused planning answer follows the point** (`planningAnswerFitsPoint`
   in `acquisitionReuse.pure.ts`). Its `pointBasis` now records the
   coordinate, and the generator compares it with this run's point before the
   registers are asked: a different precision, provider or coordinate drops
   the reused answer and reads the zone again (`withdrawReuse` takes it back
   from the provenance ledger, which is written last). The clock could not
   decide this: the stored packet is re-stamped on every invocation while the
   enrichment keeps the time it was actually placed, so the two would have
   expired at different moments and a report could have measured its
   amenities at the property while reading its zone on the street.

The cost is bounded by construction: the register is our own machine, and an
address it does not hold is asked at most once an hour, and only when something
geocodes it. Nothing is migrated or deleted; each row is repaired the next time
it is asked for.
