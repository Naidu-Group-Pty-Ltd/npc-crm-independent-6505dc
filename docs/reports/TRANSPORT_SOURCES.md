# Public transport — the feeds, and reading an archive too big to download

Read this before touching `_shared/gtfsFeed.pure.ts`,
`_shared/transportReading.pure.ts`, `transport-gtfs-ingest` or
`public-transport-service`.

## What this replaced

Audit §24 named `public-transport-service` as the clearest fabricator in the
product: eight per-state "fetchers" that **ignored the coordinate entirely**
and returned a hard-coded landmark list. Every NSW property, wherever it
stood, was 450m from Central Station with the T1–T8 lines; every VIC property
250m from a Swanston Street tram; and so on for all eight states and
territories, each with an invented `qualityScore` and a summary reading
"Excellent public transport access".

That invention was not inert. The result was cached for 30 days
(`transport_data_cache` held **639 rows at removal; not one live**) and flowed
into `location-intelligence-service`, where the invented `qualityScore` drove
**up to 30 points of every report's walk score**, and "Nearest Station:
Central Station" was printed on properties hundreds of kilometres from it. A
`generateFallbackData` beneath it invented a *different* answer ("Unknown",
999m, score 25) for the error path.

It has answered `sourceUnavailable` since that removal. This is the real
source arriving.

## Why the archive is addressed rather than downloaded

Measured 2026-09-07 from the publishers themselves. NSW's bundle is
**292,247,414 bytes**; VIC's is 319,320,298. The crime-ingest pattern — fetch
the file, parse it in the function — cannot hold either.

But most of the download answers nothing about what is near a property:

| member | uncompressed | compressed |
|---|---|---|
| `shapes.txt` | 946.61 MB | 225.77 MB |
| `stop_times.txt` | 399.06 MB | 46.88 MB |
| `trips.txt` | 26.44 MB | 1.61 MB |
| **`stops.txt`** | **16.21 MB** | **4.09 MB** |
| `routes.txt` | 1.18 MB | 0.17 MB |

`shapes.txt` alone is 77% of NSW's download and is pure route geometry.

Every publisher measured honours HTTP range requests, and a zip's central
directory sits at the **end**. So the archive is addressed: read the tail,
parse the directory, fetch one member's compressed bytes. **4.09 MB instead of
278.7 MB — 1.467%.** That is the difference between this fitting in an Edge
Function and not.

Three things it refuses rather than guesses:

- **A range request answered `200` is the server sending the whole archive.**
  Refused, not consumed: accepting it exhausts the function's memory instead
  of reporting that a source changed its behaviour.
- **A zip64 archive has saturated central-directory offsets.** Refused rather
  than mis-read, because a truncated offset addresses the wrong bytes and
  parses as garbage.
- **The member's inflated length is checked against the archive's own declared
  size.** The local header repeats the name and extra fields at its OWN
  lengths, which routinely differ from the central directory's; reading the
  wrong one is a silent off-by-n that inflates to something plausible rather
  than failing. The declared size is the archive's checksum on our arithmetic.

`crimeIngest.pure.ts`'s `zipSingleDeflateSpan` is deliberately **not** reused:
it refuses any archive with more than one entry (BOCSAR's holds exactly one,
and that refusal is a guarantee worth keeping) and it takes the whole archive
in memory, which is the thing that cannot happen here.

## The feeds

| feed | network | archive | fetched | stops |
|---|---|---|---|---|
| `nsw_sydney` | Greater Sydney and regional NSW (TfNSW) | 292,247,414 B | 1.467% | 171,061 |
| `qld_seq` | South East Queensland (TransLink) | 37,356,493 B | 0.92% | 13,119 |
| `nt_darwin` | Darwin (NT DIPL) | 2,998,647 B | 0.675% | 898 |
| `nt_alice` | Alice Springs (NT DIPL) | 29,618 B | 6.824% | 99 |
| `vic_ptv` | Victoria (PTV) | 319,320,298 B | — | **not loaded** |

**185,177 stops.** All four licences are Creative Commons Attribution; PTV's
is recorded as unconfirmed because the feed is not loaded.

### VIC is declared and deliberately not loaded

PTV publishes **eight per-mode archives nested inside one zip**, and the inner
archives are DEFLATED rather than stored — so a member cannot be
range-addressed without inflating a whole inner archive, 139 MB and 77 MB for
the two largest. (An early reading of `comp ≈ unc` suggested they were stored;
they are not. They are already-compressed zips, which is why the ratio looks
that way.)

It stays **declared with `loadable: false` and a rendered reason** rather than
deleted, because a feed that simply vanished would let an empty answer read as
"no public transport in Victoria".

### Reachability was probed from the Edge Function, not from a sandbox

The SALM lesson. `{"stage":"probe"}` asks the question from where the load
will actually run: per feed, whether a range request was honoured, whether the
central directory parses, and whether the member inflates to its declared
size. It writes nothing, and its answer is what admits a feed to the register
at all.

### The networks that are not held, measured from both vantages

The first version of this document said SA, TAS and ACT "refuse a scripted
client from this project's vantages" when they had only ever been tried from
the repo sandbox. That asserted more than had been measured, about precisely
the distinction `probe` exists to make — and it was luck rather than rigour
that it turned out to be true. `GTFS_CANDIDATES` and the `probe_candidates`
stage exist so the claim rests on evidence from the egress that would do the
loading.

Measured 2026-09-07, sandbox and Edge Function both:

| candidate | sandbox | Edge Function | state |
|---|---|---|---|
| Adelaide Metro (SA) | HTTP 403 | **HTTP 403** | refused at the edge |
| Transport Canberra (ACT) | HTTP 403 | **HTTP 403** | refused at the edge |
| Metro Tasmania | HTTP 403 | **HTTP 403** | refused at the edge |
| Transperth (WA) | page 200, no archive named | **page 200, no archive named** | address unresolved |

**WA is a different state from the other three and is recorded as one.** Its
published GTFS page answers 200 from both vantages, but the 82 KB of static
HTML names no `.zip` and no GTFS address at all — the page is client-rendered
— and a headless Chromium cannot reach the site from this environment either
(`ERR_CONNECTION_RESET`). Transperth is not refusing the data; this project
has not established where the archive lives. Calling that a refusal would
repeat the same error in the other direction.

A candidate is probed and **never loaded from that list**. Admitting one means
moving it into `GTFS_FEEDS` with a measured stop floor, which cannot happen
until a real parse has produced that number.

The candidate list is FIXED. A probe that took a URL from the request body
would be a server-side request forgery in a function holding service-role
credentials — a far worse thing than an unprobed feed.

### The diagnostics must not seal themselves

`probe`, `probe_candidates` and `digest` were first gated on
`succeeded < loadable feeds`, so they closed the moment every feed had loaded
— which is exactly when a maintainer needs them, and which made
`probe_candidates` unusable by construction, since it exists for networks that
are *not* loaded. They are permitted behind the gateway JWT now: they write
nothing, read nothing out of the database, and can reach only the fixed public
addresses compiled into the deployment. The per-feed seal on the **load**
stages is untouched.

## The columns differ between feeds — including two from one publisher

```
NSW    stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station,...
NT     stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type
QLD    stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,zone_id,stop_url,location_type,parent_station,platform_code
```

**`stop_lat` is the 4th field in one and the 5th in the other**, and Alice
Springs carries a `parent_station` that Darwin does not — two feeds from the
same publisher. Mapping is by header NAME and never by position; a positional
reader silently loads `stop_desc` as a latitude. Values are trimmed because NT
publishes unquoted with a leading space on every coordinate (` -12.369522`).

## Three of NSW's 171,064 stops carry an impossible coordinate

0.0018%, and each is a different corruption:

- `G2583258` "Woodward Lane Opp 54" at lat `30.51656633`, lon `-30.51657273` —
  the sign flipped **and** the longitude a copy of the latitude
- `G2663247` "83 Pitt St" at lon `-179.99891116`
- `G268012` "Brinagee St At Gunbar St" at exactly `(0,0)`

These are real streets with broken positions. A stop whose position is wrong
cannot answer "how far is this from the property", so it is **excluded and
counted** — the SAPOL interstate-postcode rule. The tolerance is 0.1%, about
55× the measured worst case, and does not apply below 500 rows because one
unplaced row in four is 25% and says nothing about whether a column moved.

The bounding box is deliberately generous: the NSW feed's real extent runs lon
138.5884 to 153.6213 and lat −37.8183 to −27.4643, because "Greater Sydney"
includes NSW TrainLink coach terminals in **Adelaide and Melbourne**. Those are
real stops and are kept. A feed's coverage is not its name.

## A station and its platforms are ONE place

The finding that only production data revealed. Within 1.6 km of the
Parramatta test coordinate, `transport_stops` holds **thirteen rows all
carrying `parent_station: 215020`** — "Parramatta Station, Platform 1" through
"Platform 4", "Stand A1", "Stand A2", "Stand B1" through "Stand B3", "Darcy
St", two "KAR Fizwilliam St" and a "TXI Fizwilliam St". "Church Street Light
Rail" is three rows; "Westfield Parramatta, Argyle St" is two at an identical
coordinate.

A nearest-eight over the rows lists **six platforms of one station and calls
them six stops**, and a count reports thirteen places where there is one.

Grouping is by `parent_station ?? stop_id` — the publisher's own statement
that these are one facility, not a guess from names or distances (the same
reason `listingImage`'s asset key is trusted only within one listing). The
group takes the **station's** name where one exists (`location_type` 1),
because "Parramatta Station" is what a reader knows and "Parramatta Station,
Stand B3" is an implementation detail; and it takes the distance of its
nearest member, so a platform closer than its station entrance is not reported
as further away than it is. Sixteen real rows collapse to six places.

`location_type` 2 (entrance), 3 (generic node) and 4 (boarding area) are
excluded outright: they are structural points inside a station, and naming
them would list "Wynyard Station Entrance 4" as a nearby stop.

## A stop found is a fact about the area; no stop found is a fact about the FEEDS

The rule the whole reading turns on. Four networks are loaded and nothing
else. A Perth property is **not badly served by public transport** — it is
outside every feed this platform holds, and "no stops nearby" about it would be
the confident-answer-against-nothing failure removed twice already (the
sanctions register, the PEP index).

So the two are different answers and are never collapsed:

| verdict | means |
|---|---|
| `stops_nearby` | places found inside the walk radius |
| `none_within_radius` | a loaded network reaches here; nothing is within 1.6 km. The nearest place is named |
| `outside_loaded_networks` | no loaded network reaches here — returned as `no_data_for_location`, naming the networks that ARE held |

Coverage is decided by **measurement, not by a state name**: a stop within
`COVERAGE_RADIUS_M` (50 km) means a loaded feed reaches here. Deciding it from
`state` would claim coverage for all of NSW when the feed is Sydney plus the
regional coach network, and would deny it to a border property a neighbouring
network genuinely serves.

**A failed read is not an empty area.** A database fault answers 503 so a
caller can retry, never "no transport here" — the `aml.cases` lesson.

## No score, and no mode

**Nothing returns a rating, grade or `qualityScore`.** The invented one is
exactly what corrupted the walk score, and a score computed from stop counts
alone would be a new invention wearing the same clothes: a stop served hourly
counts the same as one served every four minutes.

**Mode is NULL on every row loaded, meaning "not established".** A stop's mode
lives in `routes.txt`, reachable only through `stop_times.txt` — 399 MB
uncompressed for NSW alone — so the reading omits mode rather than guessing it
from a stop's name. Frequency is absent for the same reason. `notMeasured`
states both in words a report can print, on every answer including a full one.

## The loader

`transport-gtfs-ingest`, running where the egress lives. Stages:

- `{"stage":"probe"}` — reachability per feed. Writes nothing.
- `{"stage":"digest"}` — the behaviour digest (below). Writes nothing.
- `{"stage":"<feed key>","offset":N,"budgetMs":M}` — the load.

Three things it learned by running rather than by being read:

**The bootstrap arm is per FEED and seals on SUCCESS.** Counting the whole
table meant loading `nt_darwin` sealed `nt_alice` and `qld_seq` out of their
own first load with a 403. Counting *any* row for the feed then sealed a feed
on its own FAILURE: NSW's first invocation was killed at 117,000 of 171,061,
left a `running` row, and every resume was refused — a feed could be locked
permanently half-loaded, which is worse than untouched because a partial
network would be served as though it were whole.

**`HEAD` is not how you ask an archive's length.** TransLink answers HEAD with
no `content-length` at all while answering a ranged GET with `Content-Range:
bytes 0-0/37356493` and `accept-ranges: bytes`. Reading HEAD alone reported a
perfectly range-addressable feed as un-addressable — this loader's fault, not
the publisher's, and only a real request could find it.

**NSW does not fit in one invocation.** The call is killed without returning,
so the `catch` never runs and the sync row stays `running`; the load completes
by resuming, and each resume re-pays the download and parse. `stops_written`
is read back from the table rather than accumulated, so it cannot overstate
what is stored.

A load that broke is **recorded as broken**. Left at `running`, a half-written
feed is indistinguishable from one still in progress.

## The deployment is shown to be the repo, not assumed to be

Deploying through the Management API means re-sending every dependency by
hand, so `{"stage":"digest"}` returns a SHA-256 over what the modules *do* —
the feed declarations, the bounds, and the parse of a fixed sample carrying
every awkward shape the real feeds contain (NT's leading-space coordinate,
NSW's quoted name containing a comma, a row of the wrong width, an impossible
coordinate, a repeated id). Repo and deployment agree on
`47d61cace23e474dddc827ce80326037207c33772080903085e28568f4e57e41`.

A first version hashed the module *sources* through `import.meta.url` and
every path answered "path not found": Supabase compiles the function and keeps
no sources on disk at runtime. Behaviour is the better subject anyway — it is
what a caller depends on, and `sectionRegistry`'s digest hashes a data
structure for the same reason.

## Refreshing

Re-invoke the feed's stage. Rows are replaced wholesale per feed, because a
stop withdrawn from the timetable must not go on being served as though it
were still there. A reload after the first success needs the internal edge
secret.
