# Planning controls in the report

Read this before touching `_shared/planning/planningFacts.pure.ts`, the
`# Zoning & Planning Analysis` block in `generate-investment-report`, the
`planning` entry in `dataSources`, or `propertySpecs.zoning` /
`propertySpecs.councilArea`.

Companion documents: `ZONING_BY_JURISDICTION.md` records where each
jurisdiction's planning data comes from and how every endpoint was verified;
this one records what the **report** does with the answer.

---

## 1. The defect

`planning-data-service` has worked since 2026-09-06. It resolves the
jurisdiction from the layers themselves, returns the zone, the parcel, the
state development instruments and the DA activity, and says which of five
kinds of absence each empty cell is. `generate-investment-report` calls it on
every report with a verified coordinate and assigns the answer to
`enhancedData.planningData`.

The zoning **section** read none of it.

Measured on 262 Pallas Street, Maryborough QLD 4650 (report
`aa41bcec-5a5c-434d-9162-96deb50e9bdb`, generated 16 Sep 2026):

| question | answer |
| --- | --- |
| `property_specs.zoning` | null |
| `property_specs.councilArea` | null |
| zoning keys among the report's 25 manual overrides | 0 |
| `data_sources ? 'planning'` | false |
| the report's own stored coordinate | −25.5161079, 152.7074047 — correctly in Maryborough |

A live call to the deployed service at that report's own coordinate (pg_net
request 260612) answered `200` with `jurisdiction: QLD`, `parcel.status: ok`,
`lga: "Fraser Coast Regional"`, `locality: "Maryborough"`, `tenure: Freehold`,
licence CC BY 4.0, `zoning.status: not_served` (Queensland sets zoning in each
council scheme) and `developmentInstruments.status: none_at_point` — an
evidenced negative, not a gap. **The enrichment worked and the report
discarded 100% of it.**

What the reader got instead was the prompt's own furniture. The section was
101 lines of template carrying `[XX]%` site coverage, `[X]m` setbacks, `[XX]m²`
private open space, "Refer to LEP" for minimum lot size, height and floor space
ratio, and the sentence *"Check minimum lot size requirements (typically
450m²)"* — handed to a model with no source to fill any of it from. A model
asked for a control it has not been given supplies a plausible one. **450 m²,
8.5 m and 0.5:1 reached a client's document**, and nothing on the page told
them apart from a measurement. The template was also written for New South
Wales — Local Environmental Plan, Development Control Plan, a s10.7
certificate — on a Queensland property, where none of those instruments
exists.

---

## 2. The rules

1. **A control with no source is never a number.** Every cell is a value with
   a provenance or a named absence. There is no default, no "typical", and no
   bracketed placeholder for a model to fill. This is the rule the 450/8.5/0.5
   trio broke.
2. **An audited operator override outranks a layer, and says so.** A person
   who has read the certificate knows more than a spatial layer, so an
   override is never overwritten by an automatic reading — and it is labelled
   `operator_stated` rather than presented as a published control.
3. **A layer is indicative; the instrument settles it.** Every answer carries
   the jurisdiction's own verification instrument, and the section says on the
   page that this is desktop research rather than a planning certificate.
4. **The five absences are five different sentences.** `not_served` (the
   jurisdiction publishes no such dataset), `not_integrated` (no verified
   adapter), `licence_restricted` (the data exists and may not be
   republished), `none_at_point` (the service answered and nothing covers this
   point) and `unavailable` (the read failed). Collapsing them into "Not
   specified" is how "we did not look" comes to read as "there is nothing
   there".
5. **Adopted and draft never merge.** A control carries its standing, and a
   draft amendment is never reported as though it were in force.
6. **A zone that admits a use is not approval for it.** Development potential
   is described as conditional and subject to assessment, and no uplift is
   quantified.

---

## 3. What changed

`_shared/planning/planningFacts.pure.ts` is the one place that decides what a
report may state about planning.

- `buildPlanningFacts({ planningData, overrides })` folds the service's answer
  and the operator's audited overrides into one record: jurisdiction, council,
  locality, lot/plan, parcel area and basis, and a `PlanningCell` per control
  carrying `value | status | note | source | sourceUrl | licence |
  effectiveDate | retrievedAt | standing`.
- `renderPlanningControls(facts)` composes the client-facing table — Control /
  Reading / Standing / Evidence — plus the two paragraphs that qualify it
  (rules 3 and 6).
- `planningFactBlocks(facts)` is the prohibitions the prose beside it must
  obey. It deliberately does **not** repeat the readings: `planningStatBlocks`
  already puts the measured cells in the prompt and the table is handed over
  verbatim, so a third copy would give a model three versions of one fact to
  choose between.

In the generator:

- the eight `effectiveZoning*` constants are gone. They were computed from the
  overrides alone, at a point in the run **before a coordinate has been
  verified** and therefore before anything could have been retrieved — which
  is why a property whose zone the state's own layer would have answered
  printed placeholders instead.
- `property_specs.zoning` and `.councilArea` take the operator's record first,
  then what the jurisdiction's layer answered, then whatever the listing
  carried.
- `dataSources.planning` exists, carrying jurisdiction, council, zone status,
  source, licence, the layer's currency date, the verification sentence and
  the portal URL — so the coverage disclosure stops counting a source the run
  had already spent.

---

## 4. Queensland: what a council scheme can and cannot be read from

Queensland has no state-wide zoning layer; the zone is set in each council's
planning scheme. That is what `zoning.status: not_served` means, and it is
correct rather than a gap.

Measured 17 Sep 2026 from the production egress (pg_net; every request id is
recorded here):

| probe | request | result |
| --- | ---: | --- |
| ArcGIS Online search, "Fraser Coast zoning" | 261122 | 200 — the only Fraser Coast asset is `FCRC_Inundation_Zones`, published by the Queensland disaster-management org (`si70weKpzPSa0BGV`), not a planning scheme |
| that org's full catalogue, filtered for zone/planning/scheme/overlay | 261146 | 200 — evacuation and inundation zones for a dozen councils; **no planning-scheme zoning** |
| `eplan.frasercoast.qld.gov.au` | 261155 | **403** — the host exists and refuses a scripted client |
| ArcGIS Online, `title:(planning scheme zon*)` + Queensland | 261156 | 200 — **five councils publish a public planning-scheme zoning Feature Service**: Mackay, Moreton Bay (zones, dissolved zones and zone precincts), Burke Shire, Townsville and Sunshine Coast |
| Townsville's layer, queried at −19.2590, 146.8169 | 261206 | **200 with a feature** |

So Fraser Coast publishes no machine-readable scheme layer, and for 262 Pallas
Street `not_served` with the council named is the honest answer.

For the councils that do publish one, the endpoint shape is the same ArcGIS
point query the ACT adapter already uses, and Townsville's field names are
verified: `LVL1_ZONE` (`"Centre"`), `LVL2_ZONE` (`"Principal Centre"`),
`TCC_CODE` (`"PC"`), `LGA_CODE` (`7010`), with `GAZ_DATE` for currency.
Building `QLD_COUNCIL_SCHEME_LAYERS` — keyed by the cadastre's own `lga`, so
the council that answers the parcel query selects the scheme — is the next
step, and each council's field names must be verified by execution before it
is added, exactly as `planningSources.pure.ts` requires.

**One probing note worth keeping.** `services*.arcgis.com` answers `400 Bad
Request — invalid header name` to a pg_net request carrying a `User-Agent`
header, and `200` to the identical request without one. That is an artefact of
the probe tool, not of the endpoint: the edge functions use `fetch` and the ACT
adapter against `services1.arcgis.com` is verified working. Do not read a 400
from a pg_net probe as evidence that a council's layer is unreachable.

---

## 5. Infrastructure and the future outlook

Same shape, one section later. The enrichment already holds evidenced
development facts — Queensland's declared instruments at the property's own
coordinate, New South Wales' DA register for its council — and the outlook
sections used none of them.

What the prompt offered instead:

- a SWOT strength reading *"**Metro connectivity:** [Metro Line] opened
  [Year], fundamentally improving transport profile and CBD commute time to
  [XX] minutes. This infrastructure investment typically drives long-term
  capital growth"*;
- an opportunity reading *"**Infrastructure development:** Planned residential
  and commercial developments in [Suburb] region support continued population
  growth and property appreciation"*;
- a Location Overview paragraph opening *"A major infrastructure advancement
  occurred with the opening of [Station Name] in [Year]"*, with the line, the
  connecting station and the station's facilities all in brackets;
- and a formatting directive: *"Any infrastructure/project pipeline MUST use
  `{{timeline: …}}`"*, with a worked example carrying the horizons
  `Existing / 0-2y / 3-5y / 5y+`.

None of that is a question a model can answer from the record, so what came
back was a plausible pipeline: named projects, horizons, and a causal claim
about capital growth, with nothing behind any of it.

`_shared/planning/infrastructureEvidence.pure.ts` composes what the registers
actually said, and six rules hold it:

1. **A project is named only where a register named it.** No inferred
   pipeline, no horizon a publisher did not state.
2. **A status is the publisher's own word.** The reader's vocabulary —
   proposed, approved, funded, under construction, completed, delayed,
   cancelled — is added in parentheses only where the word maps unambiguously.
   Approval is never read as funding and funding is never read as a start on
   site; those are the three a reader most wants collapsed and the three it
   would be most expensive to collapse wrongly.
3. **A completion date is never invented.** A gazettal or a determination is a
   date something HAPPENED and is labelled as that.
4. **An announcement is never a capital-growth claim.** Nothing composed here
   quantifies an uplift, and the rules handed to the model forbid it in the
   prose beside it.
5. **Coverage is stated every time**, on a full list as well as an empty one:
   council capital works, state and federal budget programmes, agency
   announcements and anything outside the local government area asked about
   are named as what these registers do not reach.
6. **Development nearby cuts both ways.** Dwellings in the pipeline are
   competing supply as well as a sign of confidence, and the reading says so.

On 262 Pallas Street the honest answer is a short one: the StatePlanning
layers returned an evidenced `none_at_point` and Queensland publishes no
state-wide DA feed, so the section states both absences, states the coverage
limitation, and forbids the prose beside it from naming a project, drawing a
timeline or claiming that infrastructure underwrites growth.

**The gap this leaves, named.** A council capital-works programme, a state
budget infrastructure line and an agency project announcement are all real
sources and none is integrated. The section says so on the page rather than
letting a short list read as a quiet area, and wiring any of them is a
separate piece of work with its own reachability and licensing measurement —
the same standard `ZONING_BY_JURISDICTION.md` holds every other provider to.

---

## 6. What the first regeneration found: a rule can reach the model and its evidence not

262 Pallas Street was regenerated on 17 Sep 2026 (report
`4640d10a-c2ba-4a5d-8c59-b697f3885d0e`) through the production resume path, on
the deployed code. The placeholders were gone — no `450 m²`, no `[XX]%`, no
Local Environmental Plan on a Queensland property, and no raw `~~[…]~~` array.
The document still asserted, in its own voice:

- *"low‑density residential zoning"*, on a property whose zone
  `planning-data-service` had answered `not_served`;
- *"no identified bushfire, flood or heritage overlays"*, sourced to a listing
  portal's "flood risk — not detected";
- *"Planning overlays under active review by Fraser Coast Regional Council"*,
  naming TLPI 01/24 and Flood Hazard Resilient Precincts, marked **Verified**;
- and a four-item `{{timeline: …}}` — Bruce Highway upgrades, a TAFE
  manufacturing centre, a school amenities upgrade — on horizons no publisher
  stated, from an enrichment that had answered `none_at_point`.

**The enrichment was never the problem and neither were the rules.** The
function logged `Planning facts: { jurisdiction: "QLD", council: "Fraser Coast
Regional", zone: null, zoneStatus: "not_served" }` on all eleven sections. What
the same log also shows, on every one of them, is this:

```
✂️ Base prompt for Risk Dashboard trimmed: 92129 → 52844 bytes
✂️ Base prompt for Due Diligence Checklist trimmed: 92129 → 52831 bytes
✂️ Base prompt for Final Recommendation trimmed: 92129 → 52852 bytes
```

`limitPromptContext` keeps 62% head and 38% tail. The planning controls table
and the infrastructure register sat under two headings of their own about a
quarter of the way into that base prompt — in the band it drops — while the
rule that points at them (*"An infrastructure/project pipeline is drawn with
`{{timeline: …}}` — and ONLY from items in the Infrastructure & Development
Outlook table"*) lives in the section instructions, which are subtracted from
the budget first and are never trimmed.

So the model held a rule about a table that was not in front of it, under a
truncation notice that says in as many words *"Prioritise extracted
specifications and request fresh web research for missing details"*, with live
search available. It did exactly that.

Three things changed.

1. **Pinned context.** `generateReportSection` takes a `pinnedContext`
   argument. Its bytes come off the budget *before* the base prompt is measured
   and it is concatenated *after* the trim, so it reaches every section whole —
   and it is carried into the emergency compact prompt too, which is the one
   that runs when the full prompt was refused and therefore exactly where a
   correctness rule must not go missing. The planning table, the planning
   rules, the infrastructure table and the infrastructure rules are its first
   members, ~5.6 KB in total, and they are gone from the middle of
   `propertyPrompt`. **What a client document may state about planning is not
   allowed to depend on a byte boundary.**
2. **The rules are the report's, not a section's.** They read `RULES FOR THIS
   SECTION` while the Compass section list has no planning section at all —
   Executive Verdict, Property & Locality Snapshot, Why This Location Matters,
   Demographics & Demand Drivers, Amenity & Access, Market Positioning,
   Property Fit, Risk Dashboard, Due Diligence Checklist, Final Recommendation.
   They now say `FOR THE WHOLE REPORT` and name risk registers, checklists and
   verdicts, because that is where the contradictions landed.
3. **A web search is not a retrieval, and the rules say so.** This model
   searches. Silence about that is what let a portal's "not detected" become
   this report's finding about the land. Both rule sets now state that a
   listing site, a news page, a budget page or an agency media release is not
   an entry in the table, and rule 4 extends to risk-register rows and
   checklists rather than prose alone.

And the tables themselves are now **in the document**, appended verbatim after
the post-processor under *"Planning controls and development registers"*, on
property reports only. Asking a model to reproduce a table is how a table comes
back paraphrased; this is the same composed markdown the prompt carries, and no
word cap can trim a row of evidence out of it. The one consequence worth
knowing is that it lands after `runQAValidation`, so the page estimate QA files
is the prose's rather than the document's — the deliberate order, because the
alternative is letting a word cap cut evidence.

**Still not closed by this.** The narrative's market claims (a "0.6% vacancy
rate", "double-digit annual growth") come from the same live search and are
governed by a different control — `auditMarketClaims` — which is outside this
document's scope. And the risk register's own **Verified / Unverified** column
is written by the model: nothing yet derives it from whether the platform
retrieved the underlying fact, so a desktop reading can still be labelled
`Verified` by the writer. That is named here rather than left to be discovered,
and it is the next piece of work in this area.

---

## 7. What the rendered pages showed

The regenerated report (`4640d10a`) was drawn through the Investment Compass
*Chancery* master with the pinned WeasyPrint 69.0 and every one of its 29 pages
was looked at. Three things the record now gets right, and four the pages
found.

**Right.** Page 5's cash-flow table foots on the page — rental income $26,000,
loan repayments $34,890, **council and water rates $5,000** (3,400 + 1,600, in
the row that names both), insurance $2,800, **management $2,580** (2,080 + 500
letting fees), maintenance $2,500, net position **−$21,770**, which is the
figure the rest of the document quotes. The audit's $2,100 gap is closed. Page
3 prints `Council — Fraser Coast Regional` where the 16 Sep report had null.
Page 6 states the assumptions the audit asked about in the open: capital growth
9.70%, **vacancy allowance 0.00%, occupancy 52 weeks a year** — the zero-vacancy
assumption is now disclosed rather than buried. And page 4 draws three scored
dimensions (Growth 77, Yield 53, Demand 35) with Location and Risk simply
absent rather than printed as zeros.

**Found.**

1. **A dial the record cannot back, drawn large.** Page 9 is a gauge reading
   **85 · /100 · STRONG** under the title *Land Appeal*; page 18 is a second
   one, **82 · STRONG**, titled *Large-block lifestyle appeal*; page 20 is a
   five-value risk `{{wheel}}` (25, 45, 30, 40, 35). Eight numbers, none in
   `investment_score`, on a record that issues no grade. The prompt asked for
   them in as many words — *"Investment Score, Affordability, Risk,
   Suitability, Confidence, and similar 0-100 ratings MUST use `{{gauge}}`"* —
   so the line is narrowed at the source and `suppressUnrecordedVerdictVisuals`
   is the check that it was obeyed. It is deliberately narrow: `gauge` and
   `wheel` are rating primitives, while `bars`, `tiles`, `heatmap`, `donut` and
   `pictograph` carry measured series and dropping those on a number match
   would take real data off the page.
2. **A prompt directive printed as the property's attribute.** Page 9, in the
   report's own prose: *"The property type is recorded as "Not stated in the
   record — if the property documents name the dwelling type, use that exact
   type in every section, never write 'Residential Property'"".* That string
   WAS `propertyTypeLabel` when nothing resolved, and it was interpolated into
   `| Property Type | … |` cells and a `- Property Type: …` line. **An
   instruction must never occupy a value slot**: the slot now carries the fact
   or nothing, and the instruction lives in the rules.
3. **And the type was known all along.** `rawPropertyType` read
   `propertyDetails?.propertyType` alone. Every Compass report is finished by
   the resume worker, which calls back with `{reportId, propertyAddress,
   continueFrom}` and no `propertyDetails` — so on the run that writes the
   document it was always `''`. The operator had recorded `propertyType:
   'house'`; `property_specs.property_type` stored it and page 3 printed it,
   while the model was told it was not stated and wrote a paragraph about the
   record not stating it. It reads `sourcePropertyType` now, which is the one
   answer the module already resolves (request first, then the overrides).
   The same read also stopped the rent-comparison row printing `X-Bed`.

**Named, not fixed.** Four residuals, with where they show:

- **Labels are clipped in three primitives.** A tile title on page 19
  (`OUTER MARYBOROUGH POCKETS…`), the timeline's only labelled stop on page 13
  (`Manufacturing Centre of Excellence – Maryborough…`), and a gauge caption on
  page 18. `fitLines` wraps a label into the units a drawing may use.

  **Two corrections to this entry, 19 Sep 2026, from reading the code.** "These
  three call sites truncate instead" is not true of the TIMELINE:
  `renderTimeline` calls `fitLines`, gives a lone milestone four lines and
  grows the drawing for them, and its own comment names the ellipsis as the
  rare case where four still is not enough — so whether the page 13 stop is
  that documented case or a different fault needs the document. And a FOURTH
  instance of the class was found while looking for these three and is closed:
  `renderWaterfall` cut every category label at fourteen characters with no
  wrapping at all, in a slot measured at 133 units and 19 characters a line —
  including the label in the `{{waterfall:}}` directive's own documented
  example. See `WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §8.
- **The timeline draws empty horizons.** Page 13 has stops at `3-5Y` and `5Y+`
  with nothing at them, which reads as a pipeline at those horizons. A horizon
  no item reaches should not be drawn.
- **`Evidence Chip: Verified` is written by the model, and the rule it breaks
  is already written down.** `compass.riskDashboard`'s own `purpose` says
  *"'Verified' only where a dated, parcel-level source is cited; 'Unverified'
  while the required check is still to be done"* — and pages 21–23 stamp
  `Verified` on overlay readings whose cited source is a listing portal's
  "flood risk — not detected". The instruction exists; what does not is
  anything that checks it, because "a dated, parcel-level source" is a
  judgement handed to the writer. The chip is a candidate for the same
  treatment the gauges got: derive it from what the platform retrieved rather
  than from what the prose cites.
- ~~**Two sections are drawn twice**~~ — **CLOSED 19 Sep 2026.** (Due Diligence
  Checklist on pages 24–25 and 25–26, Final Recommendation on pages 25 and 26,
  with one checklist item cut mid-sentence — *"8. Ask a local property
  manager"* — on page 26.) The registry was **not** the cause:
  `compass.riskDashboard` (ordinal 9), `compass.dueDiligenceChecklist` (10) and
  `compass.finalRecommendation` (11) are three distinct entries with no shared
  `sourceHeadings`. The model wrote the latter two inside the Risk Dashboard's
  own chunk and again as their own sections. `foldStraySections` carries the
  nested copy forward rather than dropping it — the nested copy was the
  complete one — and reads the cut-off item as the truncation it is rather than
  as a fourth obligation. The care this entry asked for turned out to be two
  things neither of which was the ordinals: a checklist is ONE block, so the
  comparison had to be per list ITEM, and the two copies could not be chosen
  between, only merged. See `WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §7.

---

## 8. The registers were answering the whole time (17 Sep 2026)

Until this section, §3 of this document was true of the code and false of the
world. `planningFacts.pure.ts` carried one honest sentence for overlays:

> Overlay mapping (heritage, flood, bushfire, character, acoustic) is held in
> the council scheme and is not retrieved by this platform. Nothing here
> states that the property carries no overlay — only that none was looked up.

The premise underneath it — *"No integrated layer publishes overlays at a
point yet"* — had never been measured. It is wrong for four of the eight
jurisdictions, including the two that carry most of the corpus.

### 8.1 What was measured

Probed from the **production egress** on 17 Sep 2026 (pg_net request ids
263970–263976, 263992–263998, 264009–264016; the local sandbox's proxy refuses
these hosts, which is why the measurement had to be taken from the deployment).
Every one answered **HTTP 200** with a parseable body, under an open licence,
with no key:

| Jurisdiction | Service | What it answers at a point |
|---|---|---|
| NSW | `ePlanning/Planning_Portal_Principal_Planning` | The LEP and its amendment, the zone, **maximum building height in metres**, **floor space ratio**, **minimum lot size**, **heritage** (item number, type, significance), land reservation acquisition, foreshore building line, minimum dwelling density — each with the **legislative clause** that creates it and its **own currency date** |
| NSW | `ePlanning/Planning_Portal_Hazard` | Bushfire Prone Land, Flood Planning Map, Landslide Risk Land |
| NSW | `ePlanning/Planning_Portal_Protection` | Acid sulfate soils, airport noise, drinking-water catchment, groundwater vulnerability, riparian land, salinity, terrestrial biodiversity, wetlands, scenic protection, environmentally sensitive land |
| VIC | Vicmap `plan_overlay` (WFS) | Every overlay at the point, with its schedule and gazettal date |
| QLD | `PlanningCadastre/StatePlanning` | Regional plan (name, **legal status**, version), priority living areas, PDAs, SDAs, coordinated projects, infrastructure designations |
| QLD | `FloodCheck/RapidHazardAssessment` | Flood hazard |
| QLD | `Environment/MattersOfStateEnvironmentalSignificance` | 26 layers: regulated vegetation, wildlife habitat, wetlands, watercourses, koala habitat |
| TAS | `Public/PlanningOnline` layers 14, 15 | The Code Overlay and the General Overlay, with the Local Provisions Schedule that carries them |

Two real answers, verbatim:

**Muswellbrook, NSW** — one `identify` call returned six controls:
`Muswellbrook Local Environmental Plan 2009` (Amendment No 7), R1 General
Residential, **8.5 m** maximum height under **cl. 4.3** current 18 Nov 2022,
**0.5:1** floor space ratio under **cl. 4.4**, **600 m²** minimum lot size
under **cl. 4.1** current 2 Jul 2021, and a **Residential Heritage
Conservation Area (item C2, local significance)** under **cl. 5.10** current
1 Mar 2024.

**262 Pallas Street, Maryborough QLD** — `Maryborough Priority Living Area`,
inside the `Wide Bay Burnett Regional Plan`, **Legal status: Statutory,
Version: December 2023**.

Every one of those is a fact this report had nothing to say about.

### 8.2 The four rules

**A constraint is named only where a layer named it.** Nothing infers a
control from a zone code, a suburb or a neighbouring parcel.

**A layer that was never asked is evidence of nothing.** `askedFamilies`
travels with the answer, an unreachable register contributes no coverage at
all, and "checked and not mapped at this coordinate" is a different sentence
from "nobody looked". Measured: `layers=all` on the NSW Hazard service answers
`{"results":[]}` at any point, because ArcGIS reads `all` as *all VISIBLE* and
that service's group carries `defaultVisibility: false`. An empty answer to a
question nobody asked is the worst shape this codebase knows — it reads as a
property with no bushfire and no flood — so the explicit layer ids in
`NSW_HAZARD_LAYERS` are required rather than a refinement.

**A value carries its unit, its instrument and its clause.** `8.5` is not a
fact. `8.5 m maximum building height, Muswellbrook LEP 2009 cl. 4.3, current
18 Nov 2022` is one, and it is the difference between a number a client can
take to a town planner and a number they cannot. Each layer publishes its own
currency and the report keeps them apart, because the maps amend separately.

**A retrieval is not information.** `planningControlGuide.pure.ts` explains
what each control IS, what it obliges, and what to obtain — about the
CONTROL, never about the property, which is what lets it be written in advance
and still be true. `planningConstraints.spec.ts` rejects any currency amount,
percentage, measurement or BAL rating in it, and any sentence that could read
as a clearance.

### 8.3 Why the legacy report is the wrong model for this section

The owner's 17 Sep review asked for the legacy long-form report as a benchmark
of substance. Its zoning section is fluent, specific and structured — a
controls table with an Implications column, future rezoning potential,
overlays and risks, investment implications, and a genuinely useful paragraph
telling the reader to obtain a Section 32.

It is also fabricated, and one file proves it. `df813535` carries **three
copies of its own zoning section**, on **one lot**, in **one document**, and
they disagree on every material control:

| | Copy 1 | Copy 2 | Copy 3 |
|---|---|---|---|
| Flood overlay | Moderate, 1% AEP near Werribee River | **Minimal — outside the 1-in-100 floodplain** | Moderate, affects 5% of the lot |
| Bushfire overlay | **High**, BAL-19 required | **Low risk** | BAL-12.5 to BAL-29 |
| Contributions | $45,000+ per lot | $15,000–$20,000 | $52,000 per lot |
| Height limit | 9 m | 9 m | 9.5 m |
| PSP approved | 2018 | 2018 | 2022 |
| Dwellings | 6,500 by 2036 | 13,000 by 2036 | 2,500 by 2031 |
| Subdivision | **High upside** | **No subdivision potential** | Two 200 m² lots, +$250,000 |

Copy 2 cites **Wyong Shire Council** flood mapping — a New South Wales
council, 900 km away — for a Victorian property. It is the same class as the
`450 m²` and the NSW instrument names on a Queensland property that §1 of this
document records.

So the legacy report is the benchmark for **structure, depth, educational
scaffolding and register**, and the opposite of the benchmark for
**provenance**. What it did well needed no retrieval at all: the paragraph
naming the document to obtain. `VERIFICATION_DOCUMENT` now carries that for
all eight jurisdictions, named precisely — asking a Queensland council for a
"Section 32" gets nowhere, and asking a Victorian vendor for a "planning and
development certificate" gets nowhere either.

### 8.4 Also fixed here

`Parcel area: 0 m² (surveyed)` printed on 262 Pallas Street — a surveyed
measurement of nothing — because the guard was `facts.parcelAreaSqm !== null`
and `num()` admits zero as a finite number. A parcel area of zero is the layer
declining to publish one.


### 8.5 What rendering the real section caught

The section above was written, tested against captured fixtures, and wrong — and
the way it was found is the point. Rendering the actual Planning section for
262 Pallas Street from LIVE production responses (pg_net 263994, 264598, 264599)
produced this row:

> | Strategic context | Lower Mary River | Queensland FloodCheck rapid hazard assessment | — |

Queensland's FloodCheck Rapid Hazard Assessment answers at that coordinate with
the value `Lower Mary River` — the sub-basin's own name. `familyFromLabel`
scans the label for a keyword, finds no flood word in "Lower Mary River", and
files it as `other` / `context`.

**A flood hazard reading, on a Mary River property, presented as strategic
context.** Four statements went wrong from that one classification:

1. it was drawn as context rather than as a hazard;
2. it lost the hazard-first ordering a reader triages by;
3. it appeared in the **Infrastructure & Development Outlook**, which is for
   what is planned nearby;
4. the coverage line read *"Checked and not mapped at this coordinate: … flood
   …"* — a clearance, on a property inside the mapping.

The rule: **a single-purpose register states its own family.** A register that
answers ONE question knows the answer's kind better than a keyword scan of what
the feature happens to be called, so the caller declares it and
`familyFromLabel` is used only where a register genuinely publishes many kinds
under descriptive names (Queensland's 26 MSES layers, Tasmania's codes). On a
single-purpose register the LAYER is also the finding and the feature is the
place, so the label reads *"Rapid Hazard Assessment — Lower Mary River"* rather
than a river's name on its own.

With that fixed, the section leads with:

> | Hazard | Rapid Hazard Assessment — Lower Mary River | Queensland FloodCheck rapid hazard assessment |
>
> **Flood.** Flood mapping or a flood planning control, made from modelled
> flood behaviour rather than from whether the property has flooded before. It
> typically sets a minimum floor level, restricts what can be built at ground
> level, and can require flood-compatible materials. It materially affects
> insurance: some insurers decline, and premiums can differ by a multiple.
>
> *Before you proceed:* Ask the council for the flood level and the flood
> planning level for this lot — a designation without a level tells you nothing
> about depth. Obtain an insurance quote in writing before exchange.

None of which the report said before this work, on any property, anywhere.

### 8.6 Two more the same render caught, read as a document

The flood fix was found by reading the rendered section rather than the code.
Reading it again afterwards found two more, and both are the same mistake in
different places: **a value taken from a field that means something else.**

**A region printed as a project's status.** The Infrastructure Outlook drew

> | Maryborough Priority Living Area | Growth / priority area | Wide Bay Burnett | No date stated | Priority Living Area | — |

against the headers `Project or instrument · Type · Status · Date recorded ·
Where · Stated cost`. So the **Status** cell said `Wide Bay Burnett` — a
region — and the **Where** cell said `Priority Living Area`, which is the name
of a spatial layer and not a place; on the regional-plan row the same cell
simply repeated the project's own name.

The cause is that `detail` on a constraint reading is a JOIN of everything the
layer published — legal status, version, region, hazard class. That is correct
for the planning register's *"What the register returned"* column, which is
explicitly a summary of what came back, and it is not a status. A reading now
carries `standingLabel` (the publisher's own word for the instrument's
standing, `Statutory instrument · version December 2023`) and `region`
separately, `detail` is composed from them so the register table is unchanged
byte for byte, and the Outlook reads the two fields that mean what its columns
mean. Where the register stated no standing the cell is empty and the renderer
prints the em dash — a designation with no published standing is a real state,
and filling that cell from the nearest available string is how the defect
started.

**A count that contradicted the table under it.** The Overlays row read

> 1 mapped control applies at this point

directly above a three-row table. Excluding the strategic designations from the
count is right — a regional plan does not control what is built on one lot, and
counting it as a mapped control would say it does — but a reader resolves a
contradiction like that by distrusting one of the two, and cannot tell which.
The cell names them instead: *"1 mapped control applies at this point, plus 2
strategic designations"*, and the none-at-point wording gains the same tail
(*"returned no mapped control, plus 1 strategic designation, listed below"*),
because that is the form in which the contradiction is sharpest — nothing
controls the lot, and the table still has rows in it.

**The method, not just the findings.** All three came from rendering the
section from verbatim production responses and reading it as a client would,
which no unit test does. And the empty-string fallthrough in the Victorian
overlay classifier (`(scheme && MAP[scheme]) ?? …`, where `??` does not catch
the `''` that `&&` carries through) came from `deno check` over the pure
planning modules: `tsc` covers `src` only, so these modules are type-checked
by nothing in a local run and by the ratcheted edge gate in CI.

---

## 9. An absence may not be rated (17 Sep 2026)

§8 closed the invented control. This closes the opposite failure, which the
same document then committed: not a fact the record could not back, but a
*conclusion* drawn from the record having nothing to say.

### 9.1 The row

From the Compass generated for **262 Pallas Street, Maryborough**, in
`## Risk Dashboard` → `### Consolidated Risk Register`:

| Risk Category | Level | Why It Matters | Required Check | Evidence Chip |
|---|---|---|---|---|
| Infrastructure timing and pipeline | **Low** | The absence of a named infrastructure pipeline in the registers searched means this property's performance is tied to broader Maryborough fundamentals rather than specific projects. | Note that no state development area or priority project was retrieved for this coordinate… | **Verified** — Queensland StatePlanning layers checked at the coordinate show no declared priority development area, state development area, coordinated project or infrastructure designation. |

Every fact in it is true. The conclusion is unsupported three separate times.

**The rating.** `Low` is a statement about this property's exposure, and the
only thing behind it is a register having returned nothing. Three paragraphs
higher on the same page, this report says those registers do **not** reach
council capital works programmes, state and federal budget infrastructure
programmes, or transport, water, energy and health agency announcements —
which is where a regional centre's infrastructure is actually recorded. The
search measured the search.

It is an asymmetry this repository has already written down twice and had not
applied here. `TRANSPORT_SOURCES.md`: *a stop found is a fact about the area;
no stop found is a fact about the FEEDS.* `PEP_DETERMINATION_EVIDENCE.md`: a
hit is surfaced as a signal while a miss says nothing. `planningFactBlocks`
rule 4 says the same thing one level down — *an absence in the table is a
statement about what was retrieved, never a finding about the land* — and the
model **obeyed** it: the flood and bushfire rows read `Moderate`, chipped
`Unverified — no council flood overlay … was retrieved`. Rule 4 closed the
sentence and left the rating open, and one row below the model wrote
`Environmental nuisance | **Low** | … | Unverified — no acoustic or
industrial-use overlay was retrieved, streetscape character is **inferred**
from Maryborough's low-density residential pattern.`

**The chip.** `Verified` is true of the layer reading and was written against
the *rating*, which the reading does not verify. A chip that vouches for a
retrieval and a chip that vouches for a conclusion look identical in the cell.

**"the registers searched".** Queensland's development-application register
was never searched and cannot be: no state-wide feed is published for the
jurisdiction, which is exactly what `developmentActivity` said
(`status: not_served`). `buildInfrastructureEvidence` carried both absences as
plain strings in one `absences: string[]`, and rendered both under one heading
reading `**Not retrieved.**` — so nothing downstream could tell a register
that answered *nothing here* from one nobody could ask.

### 9.2 The rules

1. **An absence may not be rated.** Where a risk register, a scorecard, a SWOT
   table, a heat map or any other rating has a row whose evidence is something
   the report did not retrieve, the rating cell reads **"Not assessed"** and
   the row states which registers were asked and which publish nothing. Never
   Low, Minimal, Limited, Negligible or Favourable; never filed as a strength
   or an opportunity. An inference from the area's general character is not a
   retrieval either.
2. **An evidence note describes the retrieval, never the conclusion beside
   it.** "Verified" may vouch for a layer reading — checked at this coordinate,
   answered nothing — and may not vouch for the rating, outlook or
   recommendation drawn from it.
3. **The two absences are different sentences.** `none_at_point` is a register
   asked here that holds nothing here; `not_served`, `not_integrated`,
   `licence_restricted` and `unavailable` are four ways of never having asked.
   `RegisterReading` carries the distinction and the page prints
   **"Checked — nothing recorded."** or **"Not covered by this report."**
   accordingly — and the rules name the register in each sentence, so the
   model cannot describe an unsearchable register as one it searched. (They
   read "Searched, nothing found." and "Not searched." until 26 Sep 2026: the
   same distinction in the machine room's words. The pair is defined once in
   `adviserVoice.pure.ts`, because the supply block prints it too — see
   [`ADVISER_VOICE.md`](./ADVISER_VOICE.md).)

### 9.3 Where it lives

| File | What changed |
|---|---|
| `_shared/planning/infrastructureEvidence.pure.ts` | `RegisterReading` and `evidence.readings`; per-kind absence headings; rules 4–5 (empty branch) and 7–8 (evidenced branch), from one `NO_RATING_FROM_AN_ABSENCE` so the two branches cannot drift; `registerSentences()` names each register and which sentence is true of it. |
| `_shared/planning/planningFacts.pure.ts` | Rules 7–8 on `planningFactBlocks`, closing the rating where rule 4 closed only the statement. |
| `_shared/compassSectionRegistry.ts` + `src/lib/reports/compassSectionRegistry.ts` | The risk dashboard's level vocabulary gains `Not assessed`, with the reason, and the chip rule is stated as "never against the LEVEL". |
| `src/lib/reports/__tests__/absenceIsNeverRated.spec.ts` | 22 assertions. |

`evidence.absences` keeps the same strings in the same order — it is on the
persisted location record and three readers take it — and `readings` is added
beside it, derived from the same push so the two cannot disagree.

### 9.4 The three things that had to be checked, not assumed

A rule telling a model to write a word is worthless if something downstream
deletes it, or if another prompt block forbids it. All three were verified by
executing the module, not by reading it:

1. **The section registry offered no such level.** It declared
   *"A level (Low/Moderate/High) describes exposure"*. Shipping a rule that
   says "write Not assessed" against a prompt block that offers three other
   words is the two-contradicting-blocks defect this programme already traced
   on the bedroom/bathroom counts. The registry now names it, in both mirrors
   (`compassRegistryParity.spec.ts` compares them field by field).
2. **`stripPlaceholderRows` deletes a table row whose first value cell is a
   placeholder** — and the rule puts a new word in exactly that cell. Its
   pattern is `n/a|tbd|to be determined|not available|not provided|unknown|—|-|–`,
   so "Not assessed" survives; pinned by execution, because this scrub runs on
   four read paths and a silent deletion looks exactly like a model that never
   wrote the row.
3. **`riskDashboardContract`'s `ASSESSED_ENTRY` does not match `| Not assessed |`**,
   deliberately — it means "carries a rating", and this is the absence of one.
   The classification is unaffected because it is reached only for a body of
   bullets, and the spec pins that rather than leaving it to be rederived.

### 9.5 What this does not do

It governs what the report may **conclude** from an absence. It does not
retrieve a council capital works programme, a state budget line or an agency
announcement — those remain outside every register this platform reads, named
on the page as such. A `Not assessed` row is an honest statement of the gap,
not a closure of it.

---

## 10. An amendment is not a project, and a determination is not a horizon (17 Sep 2026)

§9 closed a conclusion drawn from nothing. This closes two claims drawn from
something real and read wrongly — the "superseded Norwest project claims".

### 10.1 One data centre, counted three times, in three sections

The Kellyville Compass said, in its Infrastructure and Development Pipeline
section:

> Three separate **data centre and high‑technology industry projects in
> Norwest**, each with stated costs of **$93.18 million**, point to continuing
> investment in employment‑rich, technology and services infrastructure…

and drew

> `{{timeline: 0-2y "Major mixed-use redevelopment Castle Hill ($181.9m)",
> 0-2y "High‑tech data centres Norwest (three approvals at $93.18m)",
> 0-2y "Terrace housing project Gables ($29.75m)"}}`

and, in the risk register,

> …three determined Norwest applications each at $93,180,778…

There is **one** data centre. Measured against the register fixture:
PAN-619414, PAN-643600 and PAN-638082 carry the same coordinate
(150.968022088, −33.73252699), the same lot (2021/DP831173), the same address
(3 Brookhollow Avenue, Norwest 2153), the same $93,180,778 and the same three
development types; their council numbers are 1382/2025/JP/**A**, /**B** and
/**C**. The document overstated that one development by about **$186 million**,
three times over.

`summariseDaRows` already resolves an amendment to the development it amends —
that was the S4-1 fix, and the table is correct: one row, `Approved development
· amended 3 times in this window`, `$93,180,778`. **The correction is what now
invites the error**: a cell reading "amended 3 times in this window" is a
reasonable thing to read as three approvals, and nothing on the page or in the
rules said otherwise.

So the count is stated **on the page**, where a reader can check it:

> **How to count these.** 5 developments from the application register are
> listed above, resolved from 8 register rows. An amendment restates the
> development it amends — the register carries the WHOLE cost and the whole
> dwelling count on the amendment row rather than the change — so a development
> amended three times is one development, its stated cost is counted once, and
> the amendment count is not a number of projects.

The amendment clause is drawn only where something was amended; the count is
always drawn. The prose above was wrong by $186 million and a reader had
nothing on the page to check it against — which is why this is a rendered
sentence and not only a rule.

### 10.2 "0-2y" is a completion nobody published

Every date in that table is a determination or a lodgement, and the Delivery
timing column prints **"Not published by this register"** on every row, because
neither register publishes a delivery date for anything. `0-2y` is a horizon
the report has no source for.

Rule 5 said "draw a timeline only from items in the table, using the dates the
table carries", which the model obeyed — it used the table's items — while
putting them in buckets the table does not carry. Rule 5 now says what a
bucket IS and what a stop may be labelled with (`"Determined Jul 2026"`,
`"Gazetted 2023"`), and rule 5a says an amendment is not a project. One
timeline rule, not two: a spec asserts exactly one rule line mentions
`{{timeline`.

### 10.3 And it is caught on the produced document

A prompt rule cannot be proven without a model run. **Rule 12** of
`compassQAValidator` — `unpublished-delivery-horizon` — reads the finished
markdown and reports a `{{timeline:}}` stop in a future horizon bucket. Run
against the two stored reports as they were generated on 17 Sep 2026:

| Report | Findings |
|---|---|
| 18 Annabelle Crescent | **2 errors** — 3 items at `0-2y` in the infrastructure timeline, and 1 more at `0-2y` in a transport timeline (`"Local bus-reliant commuting remains dominant"`, a horizon applied to a commuting pattern) |
| 262 Pallas Street | 0 — nothing was retrieved, so rule 2 forbade a timeline and none was drawn |

It judges the prose, because the evidence table is appended *after* the
validator runs (so no word cap can trim a row of evidence) — and the prose is
the right thing to judge, since the claim is the model's. It is deliberately
narrow: it matches a duration range (`0-2y`, `3-5y`, `5y+`, with or without the
`r`/`ear`/`ears` suffix) or a relative term (`short/medium/near/long term`,
`next N years`), and leaves alone a stop labelled `Existing`, a calendar year,
or what its date IS. It looks only inside the directive, so ordinary prose
about a three-to-five-year hold is untouched.

### 10.4 Where it lives

| File | What changed |
|---|---|
| `_shared/planning/infrastructureEvidence.pure.ts` | The "How to count these" paragraph under the table; rule 5 rewritten to define a bucket; rule 5a on amendments. |
| `_shared/compassQAValidator.ts` + `src/lib/reports/compassQAValidator.ts` | Rule 12, `unpublished-delivery-horizon`. |
| `src/lib/reports/__tests__/amendmentIsNotAProject.spec.ts` | 8 assertions. |
| `src/lib/reports/__tests__/unpublishedDeliveryHorizon.spec.ts` | 9, including the two copies' byte-identity but for imports. |

---

## 11. The one absence the prose may repeat (17 Sep 2026)

§9 and §10 both narrowed what a report may say. This one *widens* it, and the
reason is the same rule read in the other direction.

### 11.1 What rule 4 cost

`planningFactBlocks` rule 4 read: *never write that no overlay applies, that
the property is not heritage listed, or that it is not flood or bushfire
affected.* Full stop. It was right when it was written — §8 records the
measurement behind it: `layers=all` on the NSW Hazard service answers
`{"results":[]}` because ArcGIS reads `all` as all VISIBLE and that group is
hidden, so an empty answer to a question nobody asked read as a property with
no bushfire and no flood.

§8 also **fixed** that, and this module's own header had already written down
what follows: *"we asked about bushfire and flood and neither applies" is a
finding, and "nobody asked" is not.* `constraintsAsked` names what the
answering registers could answer; `constraintRegisters.unavailable` names what
could not be reached. The two are distinguishable in the data now, and a
blanket prohibition forbids the one statement the register actually supports.

For 18 Annabelle Crescent: **21 layers asked**, **three NSW registers
answered**, **none unavailable**, and bushfire, flood and landslip matched
nothing. The page said so exactly —

> **Checked and not mapped at this coordinate:** floor space ratio, heritage,
> … bushfire, flood, landslip, … Each of these was asked of a register that
> answered, and no feature covers this point. A mapped layer is indicative at
> the scale it is published; it is not a survey of the lot.

— and the prose, forbidden to say it, said it anyway and said it worse:

> `✓ No bushfire or flood overlays mapped at this coordinate (verification
> still required)`

A tick, no register named, no currency date, no scale caveat. **A prohibition
with no demonstration of the permitted form is one a model routes around** —
the Compass document contract's own lesson, and the third time this programme
has met it.

### 11.2 The split

**Rule 4** keeps the prohibition it was written for, narrowed to what it was
about: *a layer this report did not reach supports nothing* — not a listing
portal, not a property data site, not a live web search, not a register that
was not asked; not in prose, not in a risk register row, not in a checklist.

**Rule 4a** gives the permitted form, and the list is **closed and generated**:

> Exactly these layers were asked of a register that answered and matched
> nothing at this coordinate: *heritage, bushfire, flood, landslip, …*. You may
> report ONE of those as not mapped, and only in a sentence that names the
> register (*NSW Planning Portal — Principal Planning Layers; … — Hazard; …
> — Protection*), says it is indicative at the scale it is published rather
> than a survey of the lot, and keeps the certificate as what settles it. Do
> NOT draw it as a tick, a clearance, a reassurance or a strength, do not rate
> a risk from it, and do not name a layer outside that list — anything else
> falls under rule 4.

Where nothing came back clear, 4a says so and hands over no list at all:
*"No layer was asked of an answering register and found clear at this
coordinate… Rule 4 governs every one of them."* That is 262 Pallas Street,
whose enrichment carries no constraint reading.

### 11.3 One implementation

`checkedAndNotMapped(facts)` is exported and used twice: by
`renderConstraintRegister` for the page, and by `planningFactBlocks` for the
rule. **Two copies of "which layers came back clear" is how a rule comes to
permit a sentence the evidence does not support**, and a spec asserts the rule
names exactly what the page prints.

It is deliberately not the complement of `constraints` alone: a family is in
the list only because it is in `constraintsAsked`, which the service populates
from the registers that answered. A layer nobody asked and a layer whose
register was unreachable are both absent from it.

| File | What changed |
|---|---|
| `_shared/planning/planningFacts.pure.ts` | `checkedAndNotMapped` extracted and exported; rule 4 narrowed; rule 4a generated from it. |
| `src/lib/reports/__tests__/checkedAndNotMapped.spec.ts` | 10 assertions. |

---

## 12. One designation, one row — and identity is proven (18 Sep 2026)

S5/S6 §3. Not a new register and not a redesign: the overlap is between two
reads of **the same MapServer** and it is exact rather than incidental.

### 12.1 The overlap

`PlanningCadastre/StatePlanning/MapServer` is read two ways by this platform:

- `QLD_INSTRUMENT_LAYERS` asks layers **25 / 30 / 35 / 40** one at a time —
  coordinated projects, infrastructure designations, priority development
  areas, state development areas — and `parseQldInstrument` reads each layer's
  own fields (`pda_name`, `pda_status`, `gazetted_date`).
- `buildQldStatePlanningIdentify` calls `identify` with `layers: all` on the
  same service, and `classify()` files what comes back as a constraint
  reading; a priority development area lands under `growthArea` / `context`.

So the four instrument layers answer **both**, and §5's strategic-designation
block draws the second copy. Executed 18 Sep 2026 against
`buildInfrastructureEvidence`, one designation produced two rows disagreeing
on every cell but the name:

| Name | Kind | Status | Reference |
|---|---|---|---|
| Maryborough Priority Living Area | Priority development area | Declared | — |
| Maryborough Priority Living Area | Growth / priority area | Statutory | Wide Bay Burnett Regional Plan |

That is the legacy report's own failure — three copies of one zoning section
on one lot, disagreeing on every control — reproduced by this platform.

No retained fixture carries `planningData` at all: all seven predate the
planning wiring, so this class cannot be found by replaying them and was found
by execution.

### 12.2 Three things prove the register; a fourth can refuse the record

**Publisher + name was the first version of this rule and it is a candidate
match, not proof.** Two designations can share a name across registers, and —
worse — the context source was read as `?? 'state planning layers'`, so two
readings that named **no** source both wore the fallback and looked identical
to each other. A missing source must never establish identity.

Identity now needs all three of:

1. the context reading **names its own publisher** — no fallback;
2. it carries the publisher's own `sourceLayer`, and that layer is one of the
   four in `INSTRUMENT_LAYER_KIND`, mapped to the `kind` the instruments probe
   would have returned for it. This is the **documented equivalence**: written
   from `QLD_INSTRUMENT_LAYERS`, with a spec asserting the two agree — a layer
   added there and not here stops merging rather than starts merging the wrong
   thing, which is the safe direction;
3. the two publishers' own names match exactly after trim, case-fold and
   whitespace collapse. Never token overlap, never edit distance, never a
   shared word, and never across sources.

**And a layer identifies a COLLECTION, not an individual designation.** Two
priority development areas are both layer 35 and a name can be reused, so
those three are a *candidate* and the publisher's own identifiers settle it.
There are two of them and they identify **different things**:

| Channel | What it identifies | Example |
|---|---|---|
| `feature` | this designation's own reference or code | `PDA-MBH`, `DDO1`, `HO544` |
| `instrument` | the planning instrument it sits **under** | `Wide Bay Burnett Regional Plan` |

Each is judged against its own channel only. Comparing a feature reference
against an instrument name is the publisher-plus-name mistake one level down —
two identifiers of different things disagree on every honest pair, and a rule
built on that comparison would refuse every real merge and restore the
two-contradicting-rows defect this section exists to close.

Where a channel **both sides published** disagrees, the match is refused
however well publisher, layer and name line up: these are two records, both
stand, and each keeps its own reference, source, licence and currency, so a
reader can see the disagreement and look either up. A channel one side left
unpublished says nothing and does not refuse.

### 12.3 What the parsers actually publish

Measured against the two reading types on 18 Sep 2026:

| | `feature` | `instrument` |
|---|---|---|
| `DevelopmentInstrumentReading` (`parseQldInstrument`, all four kinds) | not emitted | not emitted |
| `PlanningConstraintReading` | `code` | `instrument` |

So **every real match today is "one side published none", which merges** — the
negative case cannot arise from production data yet. The guard is written now
because the change that would otherwise start merging two designations
silently is either parser growing an identifier, and at that point the guard
has to already be in place.

### 12.4 A merge has to earn the suppression

Dropping the identify-all row used to drop its facts with it. It now fills the
surviving layer-specific row wherever that row held **nothing** — reference,
region, currency date, licence. Nothing already stated is overwritten, and
**no status word travels**: a designation's standing is not an instrument's,
and borrowing one would put a plan's `Statutory` in a project's Status column,
which is the defect §5 already records in the other direction.

Suppression and refusal are both **silent**. A client document does not
narrate its own production, and a duplicate that was never printed is not
something a reader lost.

### 12.5 Where it lives

| File | What changed |
|---|---|
| `_shared/planning/planningConstraints.pure.ts` | `sourceLayer` added to `PlanningConstraintReading`, populated at all three constructors (`null` on the Victorian WFS path, whose features carry no layer id). |
| `_shared/planning/infrastructureEvidence.pure.ts` | Rule 10: `INSTRUMENT_LAYER_KIND`, `identityOf`, `identifiersOf` / `identifiersContradict`, and the gap-fill on an accepted match. |
| `src/lib/reports/__tests__/infrastructureProjectIdentity.spec.ts` | 23 assertions, 12 of them negative. |

---

## 13. The ten-year outlook beyond the DA register (18 Sep 2026)

S5/S6 §4 asks for a ten-year outlook built from *"official programmes, budgets
and planning publications"* rather than from development applications alone.

§5's coverage limitation has always been stated on a full list as well as an
empty one — *council capital works, budget programmes, agency announcements* —
and until now it had never been **measured**. It is now, and the answer is
narrower and more useful than the disclosure.

### 13.1 Correcting a wrong reading first

A two-URL probe earlier the same day reported `data.gov.au` answering **404**
and was cited as evidence that the catalogues refuse this egress. That was a
**path error of mine**, not a publisher's refusal: the CKAN API is under
`/data/api/3/…`, not `/api/3/…`. Re-probed correctly, all three catalogues
answer **HTTP 200**:

| catalogue | endpoint | result |
| --- | --- | --- |
| data.gov.au | `/data/api/3/action/package_search` | 200 — 16,722 infrastructure packages, 1,602 for "infrastructure priority list" |
| data.nsw.gov.au | `/data/api/3/action/package_search` | 200 — 24 for "infrastructure pipeline" |
| www.data.qld.gov.au | `/api/3/action/package_search` | 200 — 29 for "transport roads investment program" |

The rule this repeats: **a probe that fails is a statement about the probe
until the probe itself is checked.** The same class as `layers=all` answering
`{"results":[]}` in §8.

### 13.2 Queensland publishes a funded forward programme, and it is reachable

**Queensland Transport and Roads Investment Program (QTRIP) — 2024-25 to
2027-28**, Department of Transport and Main Roads, **CC BY 4.0**, last updated
2024-09-25.

The **file** does not come: the resource download endpoint answers **HTTP 202
with zero bytes** on three attempts, `tmr.qld.gov.au` answers **403** to a
scripted client, and the Wayback Machine holds **no snapshot** of the file and
no CDX entry for the path. That is the fault that would have been recorded as
"unreachable" by a probe that stopped there.

**The CKAN DataStore API answers**: `/api/3/action/datastore_search` on that
resource returns **903 records**, with

| field | what it gives an outlook |
| --- | --- |
| `Local Government` | the join key the DA register already uses |
| `Investment Name` | the publisher's own project name |
| `Network` | National / State / Local |
| `2024-25` … `2027-28`, **`Beyond`** | a funded forward profile, year by year |
| Australian / Queensland / Local Government contributions | who is paying — the thing §5 rule 4 says no register this platform reads publishes |
| `Estimated expenditure to 30 June 2024` | progress against the programme |
| `Endnotes` | the publisher's own qualifications, per row |

First record, verbatim: *Pacific Motorway, Exit 45 (North) Ormeau, business
case* — South Coast district, Gold Coast City, National network, $1.5bn total,
split $750m Commonwealth / $750m Queensland, nothing spent to 30 June 2024.

**NSW has no equivalent structured dataset** by the same search: 14 packages,
the only one with live DataStore resources being *NSW Budget Paper 2* from
2019.

### 13.3 The 2024 reading was two editions stale, and the schema had changed

**It is built, and the reconciliation above had to be done first.** The
catalogue holds three recent editions and the one §13.2 read is the oldest of
them. Measured 18 Sep 2026:

| edition | rows in the DataStore | what it carries |
| --- | ---: | --- |
| 2024-25 → 2027-28 (what §13.2 read) | 903 | `Local Government`, `Network`, `Investment Name`, per-year budgets, `Beyond`, `Endnotes` — **no status, no stage dates** |
| **2025-26 → 2028-29** | **639** | `Investment status (as at 1 July 2025)`, `Planning`, `Procurement`, `Construction Start`, `Range`, `Midpoint Latitude/Longitude` — **no `Local Government`, no `Network`** |
| 2026-27 → 2029-30 | **0** | `datastore_active: true`, `total: 0`; its CSV answers HTTP 202 with zero bytes |

Three things follow, and each is a rule in
`_shared/planning/investmentProgramme.pure.ts`.

**The current edition is the one that ANSWERS.** The 2026-27 package is
published, newer, and empty. `QTRIP_EDITIONS` lists the editions newest first
and the reader takes the first that returns rows, naming which it used — the
repository's standing rule in another costume: *asserted by effect, never by
configuration*, the same rule the retention purge and the verification
self-test answer to.

**The join key is a COORDINATE, not a local government area.** §13.2 planned
an LGA join and the current edition dropped that column, which is strictly
better for the question a report asks. §4's own words: *"an LGA project is not
automatically near the property."* A 25 km box around the subject, then a
measured haversine, answers geographic relevance directly. The box is drawn
**2% wider than the radius**, because `1/111.32` is a MEAN degree and at
-25.54° a 25 km box reached 24.974 km — an investment at 24.98 km due north
would have been dropped before the distance test ever saw it. 508 of the
edition's 639 rows carry a coordinate; the rest are counted as `unplaced`
rather than dropped or placed.

**Relying on the 2024 funding or status would have been wrong.** Its columns
are appropriations for years since spent, and it publishes no status at all —
so a report drawing "funded" from it would have asserted a state of affairs
the register never stated, from a document two editions out of date. §4 asked
for this reconciliation before the data was relied on; that is what it found.

### 13.4 What it needed, and what it did not

**It needed no migration.** `datastore_search_sql` with a bounding box
answered this egress in **0.59 s — 14 rows, HTTP 200, CC BY 4.0** — so it is a
live read at report time through the mechanism every other register in
`planning-data-service` already uses. §4 asked to *"prefer existing
acquisition, evidence-storage and composition mechanisms"*, and a table, an
ingest function and a pg_cron schedule would have been three new failure modes
for a query that takes half a second. `planningAnswerVersion` goes to **`c3`**
instead, because a `c2` row was cached before any programme was read and
serving one would report a property as having no funded investment near it
when the programme was never asked — exactly the fault `c2` exists for.

Five rules carry a row onto the page.

1. **A project is named only where a register named it** — `Project Title`
   verbatim.
2. **A status is the publisher's own word**, mapped narrowly:
   `Contractually Committed` is **funded** and is never read as approved or as
   under construction; `Planned` is **proposed**. The one row that earns
   `under_construction` is one whose `Construction Start` the publisher itself
   writes as `Underway`.
3. **A construction start is not a delivery date.** The stage cell reads
   *"Construction expected to start 2026-27 — a start, not a completion"*, and
   the programme publishes no completion date for anything.
4. **A four-year programme is not a ten-year outlook.** The page states the
   window and that nothing in it establishes delivery beyond it.
5. **A cost band is not a committed budget**, and **funding names contributors
   and never a split** — the three contribution columns hold a marker (`•`),
   not an amount, so reading one as a number would print a funding split the
   programme never published.

### 13.5 New South Wales has a programme, and the report says so

§4: *"'No equivalent structured dataset found' must not become 'NSW has no
relevant programme.'"* `PROGRAMME_PUBLISHERS` names the publisher, the
programme and the form it takes for **every state and territory**, and
`programmeCoverageNote` composes the sentence. On a Kellyville report it reads:

> **Not searched.** NSW Treasury, Transport for NSW and the local council
> publishes the NSW Budget Infrastructure Statement, Transport for NSW project
> announcements, and the council's own Delivery Program and capital works
> programme. It is an official, current programme, and it is issued as budget
> papers and agency publications rather than as a structured feed, so this
> report does not read it. Nothing about the area follows from its absence here
> — the programme exists and can be read at https://www.budget.nsw.gov.au/.

A test asserts no note can be spelled as a jurisdiction publishing nothing.
The two catalogue searches that produced §13.2's "NSW has no equivalent
structured dataset" were correct about the CATALOGUE — data.nsw's CKAN is
largely a library of PDFs, and the Planning Portal's major-projects backend
answers 404 on every route probed — and that is a statement about a feed, not
about a programme.

**And the coverage statement is true of THIS reading.** Once the state's own
forward programme has been read at this coordinate, listing "state and federal
budget infrastructure programmes" among what is not covered is false, and a
false limitation teaches a reader to discount the true ones. `coverageLimitsFor`
narrows it to *"federal budget programmes, and state programmes outside
transport and roads"*, and keeps council capital works and agency
announcements, which a transport programme does not close.

---

## 14. A detected error is not a corrected report (18 Sep 2026)

`compassQAValidator` has reported and never scrubbed since Phase 7, and the
comment beside its call in the generator states the reasoning plainly:

> QA is recorded, never thrown. A report that exists and is over its band is
> more use to everyone than no report.

That is right for almost everything it measures. A page band, a duplicate
heading, a section over its word cap, a sub-heading density — each is a fact
about a document's SHAPE, and discarding a finished report over one would cost
more than the finding is worth.

It is not right for two of its findings, and those two are the ones this
section closes.

| rule | what it says about the document |
| --- | --- |
| `portal-sourced-hazard-clearance` | a hazard or planning control **does not apply to this property**, on the authority of a listing portal or of a neighbouring parcel |
| `unpublished-delivery-horizon` | a named project **will be delivered inside a horizon** no register here publishes |

Neither is a statement about shape. Each is a **material claim about somebody's
property that nothing in this report supports** — the first about a parcel the
report is not describing, the second about a date no publisher has issued. Both
were detected, written into `validation_flags`, and printed. The finding went to
a table nobody reads and the claim went to the client.

### The correction half

`_shared/reports/investment/evidenceClaims.pure.ts` is the corrector, and it
answers to four rules.

**One declaration, two readers.** The patterns and the finders live in that
module; `compassQAValidator` imports them. A corrector holding its own copy of
the detector's regex is two ends that drift — the failure this repository has
recorded under `AML_COMMAND_REFRESH_EVENT`, under `DEFAULT_REVIEW_INTERVALS`
and under the two copies of "what is still owed" — and here the drift would be
silent and specific: a finding reported and not removed. A test asserts the
validator declares no `PORTALS`, `HAZARD_ABSENCE` or `HORIZON` of its own, and
another asserts that a document the validator calls an error is a document the
corrector leaves clean.

**The unit of the correction is the unit of the assertion.** A sentence for a
prose claim; one stop for a timeline stop. Never a paragraph, never a section,
never a sweep across the document — the owner's rule is that *prose is never
regex-scrubbed*, and the point of removing a clearance sentence is that the
sentence IS the claim. A timeline mixing `Determined Jul 2026` with `0-2y`
keeps the determination and loses the horizon; one left with no stops at all is
dropped, because an empty directive draws nothing anyway.

**Nothing is concealed.** Every removal comes back with the rule that took it,
the text that went and why, and the generator files each as an `info`
`validation_flags` entry of type `correction`; the fork returns
`claim_corrections` and the condensation records `unsupported_claims` in its
hygiene block. A correction that leaves no trace is indistinguishable from a
document that never carried the claim.

**It removes and never rewrites.** Nothing here invents a replacement — no
relabelling `0-2y` as a date the model did not have, no downgrading
`Confidence: High` to `Unverified`. Those are judgements, and a judgement
written by a corrector is the fabrication this whole programme exists to
remove. `risk-confidence-overstated` therefore stays a **warning** and stays
uncorrected: the honest word is one a person picks.

### It runs on all three generation paths

A fork routes the parent's prose and a condensation summarises it, so a parent
generated before this existed hands its clearance sentence to both children
every time somebody forks it. Nothing rewrites the parent — its stored row is
untouched, and a historical document is a record — but the **new** document
each call produces is corrected before it is stored:

| path | where | order |
| --- | --- | --- |
| `generate-investment-report` | above the Compass overlay branch, beside the three score guards | correct → post-process → validate |
| `fork-investment-report` | on each composed child, before `runQAValidation` | correct → validate → store |
| `condenseCompose.pure.ts` | last hygiene pass, after the score guard | correct → return |

Correcting before validating is what makes a surviving finding a real one
rather than one the corrector had already discharged.

### What the tests found on the way

Two defects, neither of which was the one being fixed.

**`sentencesOf` was not total.** It was
`text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)`, which requires every part to end
at a terminator *followed by whitespace*. The generator's prose puts its
citation immediately after the stop with no space —
`…last updated.[Property.com.au, 119, 120, …]` — so that stop satisfied neither
alternative, the engine walked the start position forward, and the text between
was silently **dropped**: the real Redfern Street paragraph came back as two
parts whose second began mid-domain, at `au, 119, …`. Every caller rebuilds the
line with `kept.join(' ')`, so on a paragraph that happened to carry an
unrecorded score claim, `suppressUnrecordedScores` would have deleted a sentence
and a half nothing had decided to remove — a blanket removal wearing a
sentence-level rule's clothes. It now walks the terminators and slices between
them, which is total by construction, and a terminator may be followed by one
bracketed citation, so **the citation travels with the claim it supports**: a
source left standing over a deleted sentence reads as the source of the sentence
after it.

**The detector and the corrector split sentences two different ways.** The
validator used `markdown.split(/(?<=[.!?])\s+/)` while the corrector used
`sentencesOf`, and on the measured prose the two disagreed about where the
sentence ended — so the finding survived its own correction, which is exactly
the drift the one-declaration rule exists to prevent. `findPortalSourcedClearances`
now reads `sentencesOf`, line by line, skipping anything `isProseLine` rejects
so a table row or a directive cannot be mistaken for prose.

### 13.6 What each finding MEANS — the Lot 20427 treatment

§4: *"Complete the educational treatment inspired by Lot 20427: explain what
each material table or finding means, its limitations and the practical next
action."*

`planningControlGuide.pure.ts` has done this for planning controls since §8.
The outlook table had the other half of the problem. A reader handed

> `PAN-619414 · Development application · Determined Jul 2026 · $93,180,778`

has a retrieval and no way to act on it. The two paragraphs beside the table
explain the **vocabulary** (*an approval is not funding*) and the **coverage**
(*what these registers do not reach*) — both true, and neither of them what to
DO.

`infrastructureGuide.pure.ts` answers three questions per kind of entry:

| | |
| --- | --- |
| **what** | what this kind of entry IS, in one sentence |
| **limits** | what it does NOT tell a reader |
| **next** | the specific thing to obtain, and of whom |

Eight kinds are explained — development application, approved development,
committed and planned government investment, priority development area, state
development area, coordinated project, infrastructure designation — plus the
one that is not a kind at all: **a register that was not searched**. That last
one exists because §9's rule (*an absence may not be rated*) has an
educational counterpart. A reader told *"Not searched. No question was put to
this register"* has been told something true and given nothing to do, and
there is a real next action: the council's own DA tracker and adopted capital
works programme, and the state's budget infrastructure statement, are public
and cover most of what the table does not.

Three rules carry it, and a spec asserts each rather than trusting it.

**Everything is true of the KIND, never of the property.** It says what a
development application obliges a reader to check; it never says this property
is affected by one, never quantifies an effect on value and never rates
anything. That is what lets every word be written in advance and still be true
on every property in the country — `planningControlGuide`'s own rule, and the
separation the legacy report did not have (its zoning section was fluent,
specific, and contradicted itself three times in one document).

**No number reaches it.** The spec refuses any currency amount, percentage,
measurement, year, or bare digit in any of the three fields, on all nine
entries. A number in a guide is a number about a property.

**Only the kinds the table drew.** A guide to an entry the reader is not
looking at is noise, and the page budget is real; `guidesForKinds` reads the
kind through `kindCell`'s amendment suffix and de-duplicates. A separate
assertion reads every `kind:` literal the evidence builder writes — and every
value of its `INSTRUMENT_LABEL` map — and fails if one has no guide, so a new
finding kind cannot ship unexplained.

## 15. Where the registers were asked (24 Sep 2026)

Every rule above is about what a register ANSWERED. None of them could catch a
register asked at the wrong place. On 24 Sep 2026 the public geocoder refused
the production egress (see `GEOCODING_WITHOUT_GOOGLE.md` §17) and the chain
placed `1408/5 SECOND AVE, Blacktown NSW 2148` at the ABS centroid of the whole
suburb. The NSW zoning layer answered correctly for that point, and the page
printed:

- **"R2 — Low Density Residential"**, which was the answer for that point;
- for a fourteenth-floor apartment in the town centre;
- under the sentence "retrieved automatically at the property's verified
  coordinate".

Every cell carried its provenance, and every cell was about somebody else's
lot.

The fault was one stamp. `enrichmentCoordinate` called every enrichment point
`address`, the only precision `planningCoordinate.pure.ts` says may select a
parcel control. The geocoder had said `locality`, and the location service
dropped it.

Three rules now hold.

1. **A register is asked only at the property or on its street.** The
   enrichment records the precision it was placed at
   (`enrichmentPoint.pure.ts`), and one rule judges it for both the enrichment
   and a recovery: `address` and `street` are asked; a suburb or postal-area
   centre is `too_coarse`. Then the page says, in the rules the prose must
   follow, that the registers were not asked and why (`pointNotPlaced`), rather
   than printing no reason, or a zone that belongs to another lot.
2. **A street reading says it is one.** The owner's decision of 24 Sep 2026 is
   that a street point reads the registers, because OpenStreetMap holds address
   points for a fraction of Australian houses, and refusing streets would
   withhold the zone on most reports until G-NAF is loaded. The price is
   disclosure:
   - the answer carries `pointBasis`;
   - "What this is" reads "at a point on the property's street — the address
     could be placed on its street but not on its lot";
   - rule 6a tells the prose never to call it the lot's confirmed zoning.
3. **A planning answer is reused only where it records its point**
   (`planningPointIsRecorded`). Every answer stored before this rule records
   none and is asked again. That is what keeps the Blacktown zone from being
   served for the thirty days a `cadastral` answer otherwise lives.

The sentence "the property's verified coordinate" is gone from the page.
Whichever point was asked, the page now says what that point was.
