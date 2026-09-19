# Land, zoning and council data — the national picture, verified by execution

Revised 2026-09-06. **Every table below was produced by running the query, not
by reading documentation.** The first version of this document was written from
service descriptions and got three things materially wrong; those corrections
are marked. Endpoints, parameters and returned values are reproducible.

---

## 0. Correction first: 16.5% of stored coordinates are not in Australia

The earlier state split was computed from `location_intelligence.coordinates`
without checking those coordinates were in the country. They are not always:

| check | reports |
|---|---|
| with coordinates | 1,112 |
| **inside Australia** (lat −44…−9, lng 112…154) | **929** |
| **outside Australia** | **183 (16.5%)** |
| of those: western hemisphere (lng < 0) | 135 |
| of those: northern hemisphere | 159 |
| of those: near New Zealand | 15 |

Real examples from the corpus: `Lota` geocoded to **−37.09, −73.15** (Chile);
`1 Fauna Street` to **−43.58, 172.55** (Christchurch, NZ); `23 Collins Road` to
**−37.82, 175.28** (Hamilton, NZ).

### The mechanism, proven

| address contains | reports | outside Australia |
|---|---|---|
| state **and** postcode | 284 | **1 (0.4%)** |
| state only | 22 | 0 (0.0%) |
| postcode only | 38 | 2 (5.3%) |
| **neither** | **768** | **180 (23.4%)** |

An address with any locality anchor geocodes correctly. A bare street address —
69% of the corpus — is wrong about a quarter of the time, because the geocoder
returns a global best match.

### The cause, located

Four geocoding call sites, and they disagree:

| call site | country restriction | effect |
|---|---|---|
| `resolve-listing-coordinates` | `components=country:AU` | filtered ✓ |
| `parse-property-pdf` | `region=au` + `components=country:AU` | filtered ✓ |
| `_shared/builderStock/images.ts` | `region=au` only | **bias, not a filter** ⚠ |
| **`location-intelligence-service`** | **none** | **unfiltered** ✗ |

`location-intelligence-service` is the one that writes the coordinates the
reports carry. `region=au` biases ranking; only `components=country:AU`
restricts. Three of four sites got it right and the fourth is the one that
matters here.

> **This blocks the whole coordinate-keyed programme.** Any zoning or cadastre
> lookup keyed on these coordinates would query the wrong jurisdiction for up to
> one report in six, and return *nothing* rather than an error — indistinguishable
> from "this property has no zoning". Fix the geocoder and re-resolve the 183
> before building anything on top.

### Corrected state distribution (Australian coordinates only, n = 929)

| jurisdiction | reports | share | previously stated |
|---|---|---|---|
| **QLD** | 408 | **43.9%** | 36% |
| **VIC** | 207 | 22.3% | 19% |
| **WA** | 179 | **19.3%** | 31% ← inflated by 168 foreign points |
| NSW / ACT | 115 | 12.4% | 10% |
| SA | 11 | 1.2% | 1% |
| TAS | 7 | 0.8% | 0.8% |
| NT | 2 | 0.2% | — |

WA was overstated by 168 reports because the earlier bucket used `lng < 129`,
which is satisfied by every western-hemisphere longitude. QLD is the dominant
jurisdiction at nearly 44%.

---

## 1. What each jurisdiction actually returns — executed

Each row below is a live query against a real corpus coordinate.

### NSW — zoning ✅ free, commercial use permitted

`28 Bligh Street, Muswellbrook NSW 2333` → `-32.257687, 150.8934483`

```
GET mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/
    Planning_Portal_Principal_Planning/MapServer/19/query
    ?geometry=150.8934483,-32.257687&geometryType=esriGeometryPoint
    &inSR=4326&spatialRel=esriSpatialRelIntersects&f=json
```

| field | value |
|---|---|
| EPI_NAME | Muswellbrook Local Environmental Plan 2009 |
| **LGA_NAME** | **MUSWELLBROOK** |
| **SYM_CODE** | **R1** |
| LAY_CLASS | General Residential |
| CURRENCY_DATE | 2023-06-09 |

Licence CC BY. **The LGA comes back with the zone**, so council area is free here.

### VIC — zoning ✅ free (CC BY 4.0), commercial use permitted

`1 Boxer Drive, Wyndham Vale VIC 3024` → `-37.866888, 144.6194495`

```
GET opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0
    &request=GetFeature&typeNames=open-data-platform:plan_zone
    &outputFormat=application/json
    &CQL_FILTER=INTERSECTS(geom,SRID=4326;POINT(144.6194495 -37.866888))
```

| field | value |
|---|---|
| **lga** | **WYNDHAM** |
| **zone_code** | **UGZ8** |
| zone_description | URBAN GROWTH ZONE - SCHEDULE 8 |
| gaz_begin_date | 2014-07-17 |
| ufi_created | 2025-08-21 |

### WA — zoning ⚠ works, but licence-blocked

`1 Hazlett Street, Kalannie WA 6468` → `-30.365141, 117.1194347`, SLIP layer 112:

| field | value |
|---|---|
| **lga** | **Shire of Dalwallinu** |
| scheme_nam / scheme_no | DALWALLINU / 2 |
| **zone** | **Residential** |
| gazettal_d | 2014-02-06 |

Technically ideal. The SLIP public terms restrict the data to *"personal and
non-commercial use"*, with derivative works requiring written authorisation.
**This platform renders commercial client PDFs, so this is unusable as-is.**

### QLD — zoning ❌ does not exist at state level

The `PlanningCadastre` folder contains **no zoning service**. Enumerated live:

```
AreasOfRegionalInterest · CoastalManagement · CoordinatedProjects ·
LandParcelPropertyFramework · LandUse · PriorityDevelopmentAreas ·
ResidentialLandSupply · StateDevelopmentAreas · StatePlanning
```

`PlanningCadastre/LandUse` is the **Queensland Land Use** layer, classified to
the Australian Land Use and Management Classification. It is land *use*, not
planning *zone*. Bound to a report it would print "agriculture" where the client
needs a zone name — a plausible wrong figure, worse than an absent one.

Queensland zoning is set by each local government's planning scheme.

---

## 2. The finding that changes the plan: cadastre ≠ zoning

Chasing zoning in QLD led to the cadastre, which answers a different and
partly more valuable question. Same Moranbah coordinate, layer 4:

```
GET spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/
    LandParcelPropertyFramework/MapServer/4/query
    (geometry as JSON: {"x":148.0452959,"y":-22.0043462,
     "spatialReference":{"wkid":4326}})
```

| field | value |
|---|---|
| **lot_area** | **809.0** |
| **shire_name** | **Isaac Regional** |
| lotplan | 45M9738 |
| lot / plan | 45 / M9738 |
| **tenure** | **Freehold** |
| locality | Moranbah |

For the largest jurisdiction in the corpus, with no zoning service at all, the
free state cadastre returns **land size, council area, the legal parcel
identifier and tenure** — four of the attributes this programme is chasing.

### And the pattern inverts

| jurisdiction | zoning | cadastre attributes |
|---|---|---|
| **QLD** | ❌ none at state level | ✅ authoritative `lot_area`, `shire_name`, lot/plan, tenure |
| **NSW** | ✅ free, CC BY, incl. LGA | ⚠ `lotidstring` (B//DP156945) but only a computed `shape_Area` |
| **VIC** | ✅ free, CC BY 4.0 | ❌ open parcel/property layers return **identifiers only** (pfi/ufi) — no area, no lot/plan, no LGA |
| **WA** | ⚠ licence-blocked | ⚠ same SLIP licence |

**No jurisdiction is good at both, and the strengths are opposite.** QLD is best
for cadastre and worst for zoning; VIC is best for zoning and worst for
cadastre. So the plan cannot be organised per state — it is a matrix of
**(jurisdiction × attribute)**, and each cell needs its own source, licence and
confidence.

### Surveyed area is not computed area

QLD returns `lot_area: 809.0` — a surveyed figure. NSW's cadastre layer returns
only `shape_Area: 1081.5`, the polygon's computed area in the layer's projection
units. For a due-diligence document these are different claims: one is the area
on title, the other is what the boundary geometry happens to enclose. **They must
not be published under the same label**, and a computed area needs saying so.

---

## 3. Rules this must be built to

1. **Fix the geocoder before anything else.** `components=country:AU` in
   `location-intelligence-service`, reject any result outside Australia, and
   re-resolve the 183 bad rows. Everything else keys on coordinates.
2. **The jurisdiction router is geographic and must not use bounding boxes.**
   Rectangles put Chile in Western Australia in this very document's first
   draft. Resolve by point-in-polygon against an authoritative boundary, or take
   the answering service's own LGA/state field.
3. **Two fields, never one.** Store the verbatim local code (`R1`, `UGZ8`,
   `Residential`) *and* a normalised national family. NSW returned `R1 / General
   Residential` and VIC `UGZ8 / Urban Growth Zone – Schedule 8` for equivalent
   suburban land: different legal systems, not different spellings. **The family
   must never be printed as though it were the zone.**
4. **Label the provenance of area.** Surveyed lot area and computed polygon area
   are different facts.
5. **Licence is a gate checked before a value reaches a PDF**, not a footnote.
   `data_provenance.licence_tag` exists for this. WA is currently barred.
6. **Coverage is disclosed, never inferred.** A cell with no usable source says
   so (law 2).
7. **Overlays are separable from zoning.** QLD publishes `StatePlanning` and
   FloodCheck statewide with no zoning dependency, and flood/bushfire drive more
   of a due-diligence conclusion than the zone code does.
8. **A spatial layer is indicative; the certificate is the instrument** — NSW
   s10.7, VIC s.199 Land Information Certificate, QLD council planning and
   development certificates. The Due Diligence tier's value is naming what to
   verify and where.

---

## 4. Order of work

| step | what | why here |
|---|---|---|
| **0** | **Geocoder fix + re-resolve 183 rows** | Blocks everything; one parameter and a bounds check. |
| **1** | **QLD cadastre** — land area, LGA, lot/plan, tenure | 44% of the corpus, free, authoritative, and delivers four attributes without touching zoning. |
| **2** | **VIC + NSW zoning** | 35% combined, both CC BY, both verified working above. |
| **3** | **NSW cadastre / lot ID** | Free; area needs the surveyed-vs-computed caveat. |
| **4** | **QLD hazard** (`StatePlanning`, FloodCheck) | Statewide, no zoning dependency. |
| **5** | **WA licence** | 19%, blocked on terms not engineering — start the conversation in parallel with step 1, since it is procurement lead time. |
| **6** | **QLD zoning by council** | Per-scheme aggregation for the LGAs carrying volume. |
| **7** | **VIC cadastre attributes, SA / TAS / NT** | VIC's attributed parcel data is licensed; the three small jurisdictions are ~2% combined. |

Every step writes through `data_provenance` with source, confidence, licence tag
and fetch time — the envelope `cotality-service` already specifies.

---

## 5. What this means for the vendor question

Cotality remains the answer for AVM, sales and rental history. It is **not** the
answer for zoning — its own scoping brief puts planning at *"Cotality (partial)
+ state portals"*, fallback *"state portals only"*. And for land area, council
area, lot/plan and tenure, **QLD's free cadastre already returns better data
than a vendor would need to be paid for**, at least for 44% of the corpus.

The honest sequence is: fix the geocoder, harvest what the free cadastre and
planning services give per cell of the matrix, and let the residue define the
vendor requirement — rather than buying a licence to cover gaps that free
government data already fills.

---

## 6. Second execution round (2026-09-06, later the same day) — and what got built

Step 0 (the geocoder) merged as PR #2502. This round extended the executed
matrix and then **built the integration**: `planning-data-service`, the pure
modules under `_shared/planning/`, and the prompt blocks in
`_shared/reports/planningPromptBlocks.pure.ts`. Every row below is a live
query re-run through the REAL builders and parsers the service ships with.

### Newly verified jurisdictions

| jurisdiction | endpoint | executed result |
|---|---|---|
| **TAS** ✅ | LISTmap `Public/PlanningOnline` layer 13 (Tasmanian Planning Scheme Zones) | Hobart CBD → `Central Business`, Hobart Local Provisions Schedule, LPSDATE 2025-10-22. The LGA is read from the LPS name. |
| **ACT** ✅ | ACTmapi AGOL `ACTGOV_TP_LAND_USE_ZONE` FeatureServer layer 1 | Phillip → `CZ1 / CORE ZONE`, division PHILLIP, gazetted 2008-03-31. The layer keeps degazetted history, so the parser prefers `CURRENT_LIFECYCLE_STAGE = GAZETTED`. |
| **SA** ✗ | every candidate host | `location.sa.gov.au` 404s both path shapes; `sappa.plan.sa.gov.au` 403s a scripted client; three other hosts CONNECT-rejected at this egress. **No parser can be verified against a response nobody has seen** — the cell reads `not_integrated`, and the next probe should run from Supabase egress, which reached what this sandbox could not (the ABS load). |
| **NT** ✗ | `services.ntlis.nt.gov.au` | CONNECT-rejected at this egress. Same rule, same next step. |

### The DA half — the NSW Online DA API, verified end-to-end

`api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA` answers **without a key**.
Two executed facts shaped the design:

1. **The council filter is exact-match** — `["MUSWELLBROOK"]` matches
   nothing, `["MUSWELLBROOK SHIRE COUNCIL"]` matches 62 — and it accepts a
   **list**. So the service sends every dressing of the zoning layer's own
   `LGA_NAME` (`X COUNCIL`, `X SHIRE COUNCIL`, `CITY OF X`, …), reads the
   real name off the answer's own `Council.CouncilName`, and validates it by
   normalised-token equality (`CANTERBURY-BANKSTOWN` can never resolve to
   `BANKSTOWN`). Verified: the candidate list returns the same 62 rows as
   the exact name.
2. **The full flow, executed through the shipped code** (Muswellbrook LGA,
   183-day window): TotalCount **99**, all 99 rows read, resolved to
   *Muswellbrook Shire Council*; stated cost of development **$66,308,556**;
   **83 new dwellings** proposed; statuses 53 Determined / 18 Additional
   Information Requested / 15 Under Assessment / 9 On Exhibition / 2
   Rejected / 2 Withdrawn; largest application $26,048,000 (residential
   care facility, Denman, determined 2026-07-30).

Each row carries cost, dwellings, storeys, types, status, dates and
location — the "what is coming through council" reading the reports need,
attributed to the register and its period, with sampling disclosed whenever
fewer rows were read than the register's own total.

### QLD development instruments

The four StatePlanning layers (25 coordinated projects, 30 infrastructure
designations, 35 PDAs, 40 SDAs) are point-queried with their real field
names (probed live; layer 30's type field is literally
`id_type__per_legislation_`). Executed at the Moranbah corpus coordinate:
inside the **Central Queensland Gas Pipeline** coordinated project
(Completed EIS project); the other three layers answer definite empties.

### The router, proven

The doc's rule 2 said no bounding boxes. The implementation makes the
LAYERS the router: all integrated jurisdictions are point-queried in
parallel and the polygon that contains the point answers — executed check:
the NSW layer answers a definite EMPTY for the Wyndham Vale (VIC)
coordinate. The state hint only orders preference; the asserted
jurisdiction is always the answering service's own.

### What the service refuses to do

- **WA is never fetched** — the SLIP terms bar commercial republication, so
  the cell says that, rather than fetching a value the PDF may not carry.
- **A transport failure is never cached and never reads as an absence** —
  `unavailable` cells poison the cache write; only settled responses (every
  cell a reading or a definite reasoned absence) are stored, 7-day TTL.
- **The family never impersonates the zone** (`deriveZoneFamily` reads the
  instrument's own words; NSW's ambiguous post-reform "Employment" wording
  deliberately resolves to NO family; ACT uses the Territory Plan's own
  prefix legend because its labels name sub-policies like "CORE ZONE").
- **Surveyed vs computed area stays labelled**; NSW parcel attributes stay
  `not_integrated` until the computed-area caveat ships with them.
