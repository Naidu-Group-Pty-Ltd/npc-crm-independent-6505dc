# 48 Redfern Street, Cowra NSW 2794 — evidence record

Every fact this report may state about the property, its planning controls and the
infrastructure around it, with the source that answered, the day it was retrieved,
the publisher's own currency date and the limitation that travels with it.

Retrieved **19 September 2026** from the production egress, by execution, not from
documentation. Nothing here is a search snippet: every row names an endpoint or a
publisher's own page, and the raw responses are reproducible from the URLs given.

**Assessment date and render date are different things.** The retrieval dates below
are when the evidence was obtained. A PDF drawn later does not re-date them.

---

## 1. Property identity

The report's own record carried an address string and nothing else — no coordinate,
no parcel, no title reference. Identity had to be established before any register
could be asked a question about this land.

| Fact | Value | Source | Retrieved | Publisher's currency |
|---|---|---|---|---|
| Address point | `48 REDFERN STREET COWRA` | NSW Spatial Services, *NSW Geocoded Addressing Theme*, `AddressPoint` layer 1 | 19 Sep 2026 | last update recorded on the feature |
| Coordinate | −33.824993, 148.683685 (GDA/WGS84) | same | 19 Sep 2026 | — |
| GURAS address id | 11378584 | same | 19 Sep 2026 | — |
| Address point type | 1 (property-level, not interpolated) | same | 19 Sep 2026 | — |
| Parcel | **Lot 19, Section 5, DP 977420** (`19/5/DP977420`) | NSW Spatial Services, *NSW Land Parcel Property Theme*, `Lot` layer 8 | 19 Sep 2026 | — |
| Cadastral id | cadid 101565139 | same | 19 Sep 2026 | — |
| Property id | propid 476363 | *Property* layer 12 | 19 Sep 2026 | — |
| Parcel area | **990.9 m²** (computed from the published boundary, 5 vertices) | same | 19 Sep 2026 | — |
| Parcel shape | 52.5 m (E–W) × 27.9 m (N–S), rectangular | same | 19 Sep 2026 | — |
| Lots in the property | 1 (`dissolveparcelcount: 1`, `valnetlotcount: 1`) | *Property* layer 12 | 19 Sep 2026 | — |

**Limitation.** One lot, one property — so no parcel aggregation question arises.
The 990.9 m² is computed from the cadastral boundary, which is a mapping product
and not a survey; it reconciles with the operator's recorded 988 m² to within 0.3%,
and the two are consistent rather than one correcting the other.

**A note on units.** The cadastre's own `Shape__Area` field reports 1435.88 for this
parcel. That is not square metres — it is the service's own planar unit. Reading it
as an area would have overstated the block by 45%. The figure above is computed from
the boundary coordinates.

**Not established.** Title particulars, registered proprietor, easements or covenants
on the folio, and the dwelling's approval history. See §2.4 and §5.

---

## 2. Planning

### 2.1 What was asked

Thirty-eight layers across the three NSW ePlanning map services, each asked
**explicitly by layer id** at the parcel centroid. `layers=all` is not a substitute:
on this server it resolves against layer *visibility*, and the Hazard group is not
visible by default — so an `all` query against it answers `{"results":[]}`, which is
an empty answer to a question nobody asked and reads exactly like a property with no
bushfire and no flood.

| Service | Layers asked | Answered |
|---|---|---|
| `Planning_Portal_Principal_Planning` | 11 (8, 11, 14, 16, 19, 22, 23, 24, 25, 26, 221) | 2 |
| `Planning_Portal_Hazard` | 4 (229, 230, 231, 232) | 0 |
| `Planning_Portal_Protection` | 23 (all children of group 233) | 1 |

The repository's own layer list asks 12 of the 23 protection layers. The other 11
were added for this retrieval; all 11 were silent here, so the coverage gap made no
difference to this property — but it is a gap and it is recorded in §6.

### 2.2 What answered

| Control | Value | Instrument | Clause | Commenced | Currency date |
|---|---|---|---|---|---|
| Planning instrument | **Cowra Local Environmental Plan 2012** | Cowra LEP 2012 | Clause 1.3 | 25 Jan 2013 | 25 Jan 2013 |
| Local government area | **Cowra** | — | — | — | — |
| Land zoning | **E3 — Productivity Support** | Cowra LEP 2012, as amended by *State Environmental Planning Policy Amendment (Land Use Zones) 2023* | — | 26 Apr 2023 | **8 Aug 2025** |
| Groundwater vulnerability | **Groundwater Vulnerable** | Cowra LEP 2012 | — | 25 Jan 2013 | 25 Jan 2013 |

Publisher: NSW Department of Planning, Housing and Infrastructure — NSW Planning
Portal spatial services. Licence: CC BY 4.0. Geographic scope: the point queried, and
verified at the parcel centroid **and each of the four corners** — the zone is uniform
across the whole of Lot 19.

### 2.3 What was asked and is not here

Each of these was queried by layer id at this parcel and returned no feature. That is
a statement about this land, not about the platform's reach.

- **Hazard:** bushfire prone land; flood planning; landslide risk.
- **Development standards:** maximum building height; floor space ratio; minimum lot
  size; minimum dwelling density; foreshore building line; land reservation
  acquisition; land reclassification.
- **Heritage:** EPI heritage item or conservation area; State Heritage Register
  curtilage.
- **Protection:** acid sulfate soils; airport noise; obstacle limitation surface;
  drinking water catchment; mineral and resource land; riparian land and watercourses;
  watercourse; natural resources (water, biodiversity, sensitivity); salinity; scenic
  protection; terrestrial biodiversity; wetlands; environmentally sensitive land;
  natural landform; NPWS estate; marine protected areas.

**Cowra LEP 2012 publishes no mapped height, floor space ratio or minimum lot size
standard at this parcel.** That is not the same as "no limit": built form on E3 land
is governed by the zone's own provisions, the Cowra Development Control Plan and the
merit assessment under s.4.15 of the *Environmental Planning and Assessment Act 1979*.
The DCP is a council document and was not retrieved.

### 2.4 The land use table

Retrieved from the NSW Planning Portal's own permissibility service
(`api.apps1.nsw.gov.au/eplanning/data/v0/FetchEPILandUsePermissibility`,
`EpiName: Cowra Local Environmental Plan 2012`, `ZoneCode: E3`), 19 September 2026.
The service returns each land use twice; the lists below are de-duplicated and
otherwise verbatim.

**Zone objectives (verbatim, Cowra LEP 2012, Zone E3):**

> To provide a range of facilities and services, light industries, warehouses and
> offices. To provide for land uses that are compatible with, but do not compete with,
> land uses in surrounding local and commercial centres. To maintain the economic
> viability of local and commercial centres by limiting certain retail and commercial
> activity. To provide for land uses that meet the needs of the community, businesses
> and industries but that are not suited to locations in other employment zones. To
> provide opportunities for new and emerging light industries. To enable other land
> uses that provide facilities and services to meet the day to day needs of workers, to
> sell goods of a large size, weight or quantity or to sell goods manufactured on-site.
> **To ensure commercial development in the Redfern Street area** and at the Cowra
> Airport is consistent with the commercial hierarchy of the Cowra township and does
> not involve major retailing activities or detract from the core commercial functions
> of the Cowra central business district. To maximise public transport patronage and
> encourage walking and cycling. To ensure commercial, industrial or other compatible
> development at the Cowra Airport provides aviation-related services and facilities or
> services and facilities to support that development.

**Permitted without consent (3):** Environmental protection works; Home occupations;
Roads.

**Permitted with consent (46), the ones that bear on this property:**
**Dwelling houses**; Shop top housing; Business premises; Office premises;
Neighbourhood shops; Light industries; Warehouse or distribution centres; Depots;
Storage premises; Local distribution premises; Timber yards; Landscaping material
supplies; Hardware and building supplies; Rural supplies; Specialised retail premises;
Industrial retail outlets; Service stations; Vehicle repair stations; Vehicle body
repair workshops; Vehicle sales or hire premises; Veterinary hospitals; Animal boarding
or training establishments; Garden centres; Plant nurseries; Take away food and drink
premises; Function centres; Hotel or motel accommodation; Markets; Mortuaries;
Community facilities; Centre-based child care facilities; Respite day care centres;
Places of public worship; Information and education facilities; Industrial training
facilities; Research stations; Recreation areas; Recreation facilities (indoor, outdoor
and major); Passenger transport facilities; Wholesale supplies; Boat building and repair
facilities; Oyster aquaculture; Tank-based aquaculture; Any other development not
specified in item 2 or 4.

**Prohibited (45), the ones that bear on this property:**
**Residential accommodation**; Shops; Tourist and visitor accommodation; Registered
clubs; Entertainment facilities; Amusement centres; Industries; Heavy industrial
storage establishments; Freight transport facilities; Agriculture; Rural industries;
Farm buildings; Exhibition homes; Exhibition villages; Caravan parks; Camping grounds;
Eco-tourist facilities; Cellar door premises; Roadside stalls; Extractive industries;
Open cut mining; Forestry; Cemeteries; Crematoria; Correctional centres; Sewage
treatment plants; Water treatment facilities; Biosolids treatment facilities; Waste or
resource management facilities; Resource recovery facilities; Restricted premises; Sex
services premises; Home occupations (sex services); and a group of maritime uses
irrelevant to an inland parcel (jetties, marinas, moorings, mooring pens, boat launching
ramps, boat sheds, port facilities, wharf or boating facilities, charter and tourism
boating facilities, water recreation structures); Air transport facilities; Airstrips.

**The reading that matters, and it is a narrow one.** *Dwelling houses* is listed at
item 3 (permitted with consent). *Residential accommodation* — the group term that
covers dual occupancies, secondary dwellings, multi dwelling housing, attached
dwellings, seniors housing, boarding houses and the rest — is listed at item 4
(prohibited). A land use named specifically in item 3 is permissible notwithstanding
the group term in item 4; that is how the Standard Instrument's land use tables are
read. So on this land:

- a **dwelling house** is a permissible use with development consent;
- **no other form of residential accommodation is permissible at all** — not a
  secondary dwelling, not a dual occupancy, not a subdivision producing a second
  dwelling;
- **shops are prohibited**, and the zone's own objective names the Redfern Street area
  as land whose commercial development must not detract from the Cowra CBD.

**Limitation.** This is the land use table as the Planning Portal publishes it. It is
not a s.10.7 planning certificate, it does not establish that the existing dwelling was
lawfully erected or is a lawfully continuing use, and it does not reach the Cowra
Development Control Plan, any s.7.11/7.12 contributions plan, or a site-specific
provision in Part 6 of the LEP. A s.10.7(2) and (5) certificate from Cowra Shire
Council is the document that settles those, and it is the one to obtain.

**A discrepancy, recorded rather than resolved.** The permissibility service labels
E3 `"ZoneDescription": "Environmental Management"`, which was the meaning of E3 before
the 2023 employment-zone reform. The zoning map layer for this parcel reads
`Land Use: Productivity Support` under the 2023 amendment, and the objectives text
returned by the same service is unambiguously employment-zone text. The map layer and
the objectives agree; the `ZoneDescription` field is stale metadata and is not relied
on here.

### 2.5 What could not be retrieved, and why

The consolidated text of Cowra Local Environmental Plan 2012 on
`legislation.nsw.gov.au` **refused this egress** — HTTP 403 carrying a Cloudflare
managed challenge ("Just a moment…"), on the HTML view, the whole-document PDF and the
XML export alike, and again when driven from a real headless Chromium. `api.legislation.nsw.gov.au`
was not reachable at all. The AustLII mirror answers the same challenge.

This is a statement about a bot check, not about the document's availability: the
instrument is public and a person with a browser can read it. The material this report
needs was obtained from the Planning Portal's own permissibility service instead, which
is the publisher's structured copy of the same land use table.

---

## 3. Infrastructure — Cowra Hospital Redevelopment

The one project near this property large enough to bear on it, and the only one this
record states. It is **1.09 km** straight-line from the subject parcel to Cowra
Hospital on Liverpool Street (measured from the verified address point to the hospital's
published location; a road journey is longer).

**Project:** Cowra Hospital Redevelopment.
**Responsible authority:** Health Infrastructure NSW, with Western NSW Local Health
District. **Head contractor:** Richard Crookes Constructions.
**Stated investment:** $110.2 million. *One figure, one project, one government
announcement — the stages below are stages of this project and must not be added
together as separate investment.*

| Stage | Published status | Date of that status | Source |
|---|---|---|---|
| Construction of the new hospital | **Complete** | announced 11 Nov 2025 | Health Infrastructure, "Cowra Hospital Redevelopment reaches completion milestone" |
| Community open day | Held, ~600 attendees | 29 Nov 2025 | same publisher |
| Services operating in the new building | **Open and operating** — emergency, inpatient and outpatient services including maternity, surgical and oncology | **9 Dec 2025** | NSW Health / Western NSW LHD, "New $110.2 million Cowra Hospital ready to open its doors" |
| Demolition of the former hospital, then civil works, new car park and landscaping | **Under way**, scheduled | **5 Jan 2026 to mid-2026**; asbestos-containing material removal 12 Jan 2026 – late Mar 2026 | Health Infrastructure works notice, published 18 Dec 2025 |

**What is delivered:** an emergency department; a general medical and surgical
inpatient ward; a perioperative service; a maternity unit with a dedicated nursery;
ambulatory care; a dental clinic; renal dialysis; oncology; community health and
mental health services; drug and alcohol services; and the hospital's first CT scanner.

**Disruption on the record:** on-street parking on the northern side of Liverpool
Street is unavailable until mid-2026; demolition works run 7.00am–6.00pm weekdays and
8.00am–1.00pm Saturday, with no Sunday or public holiday work.

**What this evidence does not establish.** It does not establish any effect on
property values, rents or demand in Cowra, and no such effect is claimed. It does not
establish employment numbers, and none are stated. "Mid-2026" is the publisher's own
words for the end of the final stage and is an estimate, not a commitment; this record
was retrieved on 19 September 2026 and **no publisher's statement confirming that the
final stage has finished was found**, so its completion is not asserted here.

**Coverage limitation.** This is one project, found because it is the largest recent
public work in the town. Cowra Shire Council's capital works programme, the council's
budget papers, Transport for NSW regional programmes and private development were not
retrieved. An absence of other projects in this record is an absence of searching, not
evidence that the pipeline is empty — and it may not be rated.

---

## 4. Distance to the town centre

The stored report states "Approximately 1.6 km from the CBD" with no anchor named and
no basis. Measured from the verified address point:

| To | Straight-line |
|---|---|
| Kendal Street (Cowra's main commercial street) | **1.08 km** |
| Cowra Post Office, Kendal Street | **1.28 km** |

A road journey exceeds either. The report's 1.6 km is not refuted by this and is not
supported by it: what was missing was the anchor and the basis, and both are stated
here.

---

## 5. What is owed before this property is bought

Not a risk rating. A list of documents, each of which settles a question this record
leaves open.

1. **s.10.7(2) and (5) planning certificate**, Cowra Shire Council — settles the
   permissibility of the existing use, every LEP and SEPP provision applying to the
   land, contributions plans, and any council-held hazard or contamination notation.
2. **Title search and the deposited plan (DP 977420)** — settles easements, covenants,
   restrictions on use and the registered proprietor. The cadastral easement layer
   returned nothing at this parcel, which is a mapping answer and not a title answer.
3. **Cowra Development Control Plan** — the built-form controls the LEP does not map.
4. **Building approval history / occupation certificate** for the dwelling and any
   outbuilding.
5. **Building and pest inspection** — no condition evidence of any kind is held, and
   none of the descriptions in the stored report ("renovated", and the bedroom and
   bathroom counts) rests on an inspection or a source.

---

## 6. Findings about the platform, raised by this retrieval

1. **The planning service was never asked for this property.** `data_sources` on the
   stored row carries no planning key at all. The generator's planning fetch is
   guarded on `enhancedData.locationIntelligence?.coordinates`, the location enrichment
   produced nothing, and so the call was skipped silently. The document then printed
   planning content anyway.
2. **The repository asks 12 of the 23 NSW protection layers.** No difference here; a
   gap elsewhere.
3. **`legislation.nsw.gov.au` is unreachable from this egress**, including from headless
   Chromium. Any future feature that needs instrument text has to go through the
   Planning Portal's structured services, not the legislation site.
4. **`FetchEPILandUsePermissibility` takes its parameters as request headers**
   (`EpiName`, `ZoneCode`), not query parameters, and returns `{"ErrorMessage": "EPI
   Name cannot be empty!!!"}` with HTTP 400 for a query-parameter call. It also returns
   every land use twice.
