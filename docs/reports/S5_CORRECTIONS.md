# The S5 corrections

> Resuming in a new session? [`S5_HANDOFF.md`](./S5_HANDOFF.md) is the entry
> point; this document is the detail behind its § 5 and § 6.

*Modules: [`_shared/reports/investment/strategyPositions.pure.ts`](../../supabase/functions/_shared/reports/investment/strategyPositions.pure.ts),
[`market/marketFactBlocks.pure.ts`](../../supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts),
[`market/scoreAssessmentReading.pure.ts`](../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure.ts)
and [`risk/propertyRiskSchema.pure.ts`](../../supabase/functions/_shared/reports/risk/propertyRiskSchema.pure.ts).
Specs: `src/lib/reports/__tests__/s5Corrections.spec.ts` — one `describe` per
correction, each test named after the sentence it retires — and
`riskModelD.spec.ts` for § 3a.*

---

## 1 · The accepted CGR is not market evidence

**What was wrong.** The composer said *"The projection runs on the measured
rate rather than an assumed one: 6.2% a year"* whenever the accepted CGR and
the register's own figure agreed to within 0.05 points. They agree on **both**
subject properties. Agreement is not derivation: the accepted CGR is an input
recorded through the override workflow **before** the report is generated, and
the register figure is a measurement of what the market did. Nothing on either
record says the first was taken from the second, so the sentence invented a
provenance. The holding strategy compounded the error with *"Taken from …the
measured rate for this market"*.

**What it says now.** The two labels the owner set, side by side, always:

> **Accepted CGR assumption used by the financial model:** 6.2% a year, set
> as an assumption for this analysis before the report was prepared, and
> carried unchanged into the loan, the cash flow and the ten-year projection.
> **Historical market growth observed in the approved register:** 6.2% a year
> — NSW Department of Communities and Justice … They are separate facts from
> separate sources; nothing in this analysis shows that the assumption was
> derived from the measurement, and the two agreeing does not make it so.

(The two bold labels are the owner's and are unchanged. The sentence around
them was reworded on 25 Sep 2026 for the adviser's voice — "the override
workflow" and "before this report was generated" describe how the platform
works, not the purchase — see [`ADVISER_VOICE.md`](./ADVISER_VOICE.md).)

**The regression test.** `MARKET EVIDENCE CANNOT OVERWRITE THE ACCEPTED CGR,
THE CASH FLOW OR THE PROJECTIONS` sets the register to 6.2% and the accepted
assumption to 3.0%, then asserts the exit table compounds at **3.0%**
($1,727,318 at year five, $2,002,435 at year ten) and that the figures 6.2%
would have produced appear nowhere. Two more tests assert no composer mutates
the finance record, and that neither `generate-investment-report` nor
`fork-investment-report` assigns `capitalGrowth` from anything market-shaped.

---

## 2 · Transport — the radius, traced end to end

**What was wrong.** The composer printed *"117 public transport stops within
one kilometre"*. It read `location_intelligence.transport.stopsWithin1km`
directly, and that field's own documentation, in `transportReading.pure.ts`,
says:

> DEPRECATED NAME, KEPT FOR COMPATIBILITY. The value is the count within
> `radiusMetres`, which is 1,600 — not within one kilometre. … Nothing new
> should read it: ask `transportCountReading()`.

**The trace.** Provider → persistence → scoring → rendering, re-measured
against `transport_stops` at the verified coordinate (−33.7115485, 150.9586199)
on 18 September 2026:

| stage | value |
| --- | --- |
| provider | Transport for NSW Open Data (CC BY 4.0), GTFS `stops.txt`, feed `nsw_sydney` |
| feed loaded | 2026-09-07 05:22:15 UTC, 171,061 stops written |
| configured radius | `NEARBY_RADIUS_M = 1_600` |
| raw stop rows within 1,600 m | **239** |
| boarding **places** within 1,600 m (station + platforms = one) | **116** (the row stores **117**) |
| boarding **places** within **1,000 m** | **51** |
| nearest boardable stop | **105.9 m** (the row stores `distanceToStation: 0.1` km) |
| stored key | `stopsWithin1km: 117` — the 1,600 m count under a 1 km name |

So the sentence overstated the density **within its own stated radius by 2.3
times**: 117 against the 51 that are actually within a kilometre. The 116/117
difference is one place between this re-count and `groupToPlaces`; the product
states the row's own 117 and this document records the independent re-count
rather than quietly replacing it.

**What it says now**, stating the exact source, radius, unit, date and
measurement definition:

> **117 boarding places within 1.6 km straight-line.** Transport for NSW Open
> Data (CC BY 4.0). Counted from the operator's own published stop file:
> straight-line distance from this property's verified coordinate, with a
> station and its platforms counted as one place. The feed was last loaded on
> 2026-09-07; the count is as at that date. Nearest boarding place: Windsor Rd
> Before President Rd, 0.1 km straight-line. It does not establish mode,
> service frequency, walking distance or travel time — …

**Two supporting changes.** `loaded_at` now travels: the column always existed
and nothing selected it, so a reading stated its source and its radius and
never said *when* the data behind it was current. `StoredStop.loaded_at`,
`TransportReading.feedLoadedAt` and `StoredTransportBlock.feedLoadedAt` carry
it, and a row without one prints *"When the feed behind this count was loaded
is not recorded on this reading."*

**A register count of stations is never public transport access.** On
262 Pallas Street the stored block is
`{ source: 'osm_amenity_register', stationsWithin2km: 0, nearestStation: null }`
— one amenity category from a community-edited register, not an operator's stop
file, and no loaded timetable feed reaches Queensland outside the south-east.
The page says exactly that and draws no conclusion either way.

---

## 3 · Score language — every statement fully qualified

**What was wrong.** The four free-text lists on `investment_score` —
*"Measured demand in this market is soft"*, *"Measured capital growth in this
suburb is strong"*, *"Below average rental yield may require owner
contribution"* — name no dimension, no score, no weight, no evidence, no
calculator and no grade treatment. A reader cannot tell whether "soft" is 13
out of 100 or 45, nor that two of five dimensions were not scored at all.

**Every one of those facts is in `investment_score`, and no surface read it.**

### The correction to the correction

The first replacement table read the stored `breakdown[].weight` values
**57 / 21 / 21** as the dimensions' NOMINAL points and `coverage.weightCovered`
as a share of them. Both are the same mistake — **reading a renormalised figure
as a nominal one** — and together they hid the fact that the grade was capped.
It also produced arithmetic that did not foot: 31.9 + 4.8 + 2.7 = 39.4 against
a stored total of 40.

The engine renormalises. `COMPOSITE_WEIGHTS` is growth .40, location .25, yield
.15, demand .15, risk .05; where a dimension is not scored its weight is
redistributed across the ones that are, and it is the ADJUSTED weight the
stored integer records. 18 Annabelle Crescent, report `9bd41c05`, read
18 September 2026:

| dimension | score | original weight | adjusted weight | contribution | points delivered |
| --- | ---: | ---: | ---: | ---: | ---: |
| Capital growth | 56/100 | 40% | 57% | 32.00 | 22.40 |
| Location | — | 25% | — (not scored) | — | — |
| Rental yield | 23/100 | 15% | 21% | 4.93 | 3.45 |
| Demand | 13/100 | 15% | 21% | 2.79 | 1.95 |
| Property risk | — | 5% | — (not scored) | — | — |

* **Composite 40.** 32.00 + 4.93 + 2.79 = **39.71**, rounded **once**, on the
  sum. The 39.4 above is what rounding each part first gives, and the adjusted
  weights printed as whole percentages are themselves rounded — the engine
  multiplies by the exact fractions. The same reconstruction gives Pallas
  44.00 + 11.36 + 7.50 = **62.86 → 63** against the stated 63.
* **Grade the composite alone gives: C.**
* **Points delivered 27.80 of 100** (22.40 + 3.45 + 1.95), which supports
  **F** at most. That is the ceiling `gradeEligibility.pure.ts` applies:
  unmeasured weight discloses and caps, and never lifts.
* **Grade issued: F** — capped, which is the reading S1 reported and the table
  had lost.

`scoreAssessmentReading.pure.ts` reconstructs all eight readings from the
stored score and `composeScoreDimensionTable` draws them, with the evidence as
a labelled list rather than a seventh column (the growth cell on this record is
600 characters, and a print column cannot carry it).

### What the record does not retain, and is therefore never guessed

Two figures the engine computes are not persisted:

* **`evidenceCoverage`** — Σ(nominal weight × that dimension's OWN methodology
  coverage). It is the **57%** S1 reported, and it is *not*
  `coverage.weightCovered` (0.70), which counts a dimension scored on 15% of
  its inputs as a whole dimension. The per-dimension coverage is not on the
  row, so the reading names it as not retained and states the coarser figure
  beside that admission rather than in place of it.
* **the growth eligibility ceiling** — the A/A+ gates read growth confidence
  and growth's own weight coverage, neither stored. The nominal ceiling is
  reconstructible and is what the table states; where the two differ the
  stricter binds, so the issued grade may be lower and never higher.

`PersistedAssessment` is the forward-only shape that closes both. No stored row
is rewritten.

### All five dimensions, always

The card reads **"Partial score: 3 of 5 dimensions"**. Two dimensions are
unscored and they are unscored for different reasons.

**Location is a defect, already fixed and not yet released.** The engine's own
sentence — *"No location inputs could be measured for this property"* — is
false about every record in this deployment. All nine stored reports that carry
an RF-7.2B acquisition stamp record `places: complete` and `commute: measured`,
six amenity categories answered by the register, a matched address and a
subject key; and all nine carry **no `walkScore`, no `commute` and no
`schools.schoolsWithin3km`**. The readings were taken. The Client-Safe Gate
removes exactly those three paths, the generator persisted the gated object,
the acquisition stamp survived the removal untouched, and `assessEnrichmentReuse`
then re-served the stripped copy on every resume — so Location scored on an
enrichment with nothing left in it to verify, and the remedy the report printed
("regenerate the report") reproduced the same result. Commit `c0c7575` closes
both halves: the generator keeps `measuredLocationIntelligence` back from the
gate, and the reuse guard refuses an object whose stages ran but whose readings
are gone. **It is on this branch and not on `main`**, which is why the
17 September records still read 3 of 5.

**Risk is a recorded platform position, not a defect.** See § 3a.

*One authorised exception.* The approved allocation permits the Compass "one
authorised gross-yield reference within the grade rationale, if required". The
yield row carries 15 of the 100 nominal points and dropping it would misstate
the score, so it stays — and a test asserts the Compass contains **exactly
one** gross-yield figure and that it falls inside the grade-rationale table.

---

## 3a · Why Risk is still not scored, and the one decision that is not ours

`propertyRiskSchema.pure.ts` declared every property-risk question `not_held`
on evidence measured 8 September 2026. Two of those declarations have since
gone stale, and correcting them does **not** make Risk scoreable — which is the
finding worth recording.

**What changed.** The planning programme closed the retrieval gap.
`planning-data-service` reads the jurisdiction's own layers at the verified
coordinate; NSW answers the LEP, the zone, heritage, bushfire, flood, landslide
and acid sulfate soils, each with the clause that creates it and its own
currency date. Report `9bd41c05` carries a real reading — `R2 — Low Density
Residential`, NSW Principal Planning Layers, CC BY 4.0, effective 2026-08-07,
retrieved 2026-09-17T08:58:23.845Z. So `site_hazard_exposure` and
`planning_constraints` **are** held at parcel grain.

**Why that is still not an answer — THE REASON GIVEN HERE WAS WRONG, corrected
18 September 2026.** This read: *"a 0-100 safety score is a rating, and no
publisher issues one … what is outstanding is a published scale rather than a
dataset."* **An internal methodology does not need a government publisher to
supply a ready-made score.** It needs a defensible, documented and versioned
basis, which this platform writes routinely — `OVERHEATING_ANCHORS` in the risk
engine itself, `SEVERITY_DEDUCTION` in `conditionRecord.pure.ts`. The claim put
a whole evidence class permanently out of reach on an untested premise, and it
is why this dimension was reported as a methodology limit when it is an
evidence gap.

The real obstacle is narrower and survives: the retrieval is an **identify at a
single coordinate**, and an address-point query is never clearance for a
parcel. A layer that misses the point may still cross the lot, and a hazard the
publisher has not mapped is not a hazard the parcel lacks — so scoring the
absence would still be `PLANNING_CONTROLS_IN_THE_REPORT.md` § 9's defect ("an
absence may not be RATED"). That is a defect of the QUERY rather than of the
evidence class, and it is closeable: measured 18 September 2026 from the
sandbox egress, Queensland's cadastre answers a parcel polygon (`2RP87802`,
HTTP 200, 1.6 s at the Pallas coordinate); NSW's `NSW_Cadastre/9 (Lot)`
declares `Query`, answers its metadata in 1.2 s, and returned nothing within
40 s on two attempts — **not tested from the production egress**.
*(Superseded later the same day: the fuller probe behind
`parcelGeometry.pure.ts` — `PARCEL_PROBE_2026-09-18.json` — pinned QLD
layer 4 at ~240 ms, showed FloodCheck accepting the parcel polygon, found
NSW's query answering in ~420 ms with NO lot at the stored coordinate, and
resolved a DIFFERENT lot, `3SP239114`, at a second geocode of the same
address — which is why a coordinate yields a parcel candidate, never an
identity. `RISK_METHOD_RECOMMENDATION.md` §6a is the current record.)*

The two questions therefore stay `held_but_unscoreable`: named on the page as
evidence, contributing nothing to a score. `unscoreableHoldings()` is that
second list, and `answerableCount()` stays **0** for all four asset classes — a
capability nothing delivers may not be declared. What is outstanding for them
is a **parcel-grain query**, not a published scale.

**And the parcel query alone would not be enough.** Hazard and planning are ONE
independent category (`site`) in `riskModelD.pure.ts`, and
`MINIMUM_INDEPENDENT_CATEGORIES` is 2. **The reason recorded for that grouping
was also wrong** — it read *"if the state's portal answers, both answer; if it
does not, neither does"*, and the probe disproves it: on 18 September 2026 NSW's
Principal Planning Layers answered with an intersection while its Hazard and
Protection services answered with none, from three endpoints that fail
independently. The grouping is right for a different reason and stays: both
readings describe **the same site**, so they are two facts about one thing
rather than two independent observations. Common subject is the test, not
common availability.

The only other category an established house's schema offers is `building`.
**The construction-year measurement recorded here was incomplete**: it checked
`yearBuilt`, `buildYear`, `constructionYear` and `yearOfConstruction` and never
checked **`year_built`**, the snake_case spelling the platform actually writes,
which is present on **1,102 of 1,230** rows. The conclusion survives — it is an
explicit JSON null on every one, so 0 carry a value — but *"construction years
are absent everywhere"* does not: **32 rows across 19 properties** carry
`manual_overrides.constructionYear`, **none** with a source or reason field, and
31 of them are a completion expectation (`2025`, `2026`, one `2031`) rather than
an observed build date. The single historical value, `1941`, is on 262 Pallas
Street and nothing else in the corpus.

**What the report says instead.** `riskRemedyFor()` derives the remedy from the
schema rather than restating it. The literal it replaces read *"Answered
property-risk questions from the per-class schema (hazard, planning, condition,
strata)"* on every record — naming hazard and planning as outstanding when both
are retrieved, and naming strata on a house that is never asked about an owners
corporation. A remedy that misdescribes the platform's own holdings sends
somebody to buy what it already reads.

**The decision — SUPERSEDED 18 September 2026 by
[`RISK_METHOD_RECOMMENDATION.md`](./RISK_METHOD_RECOMMENDATION.md).** This
offered a menu of three routes and closed *"the honest maximum is four of five
scored"*. **Four scored dimensions is not an accepted final outcome**, and a
menu is not a recommendation; both are replaced by ONE recommended method with
its implementation, validation evidence and limitations.

Recommended: a **recorded condition record** — a building inspection report,
strata report, building certificate or vendor's statement, with its issuer, its
date and what it examined. It is the one class of property-level condition
evidence whose *negative* is admissible, because a qualified person examined a
recorded scope and reported.

Route 1 was built and tested as a separately named candidate
(`constructionAgeCandidate.pure.ts`) and is **not recommended**: four of the six
required demonstrations are not met, and activating it would complete 262 Pallas
Street's fifth dimension and not 18 Annabelle Crescent's, on an unsourced typed
number that exists on exactly one property in 1,230. Route 3 stays refused.

What the owner is asked for is in § 7 of that document: **Approval A**, build
the evidence-submission path; **Approval B**, activate the conversion.
`CONDITION_METHOD_ACTIVATION` ships as `null`, asserted by a test. Until a
record exists **for a given property**, that property's Risk is not assessable
and four scored dimensions is correct *for that property* — a named, closeable,
per-property reason rather than a platform-wide limit.

---

## 4 · An evidence window is not a holding requirement

**What was wrong.** *"A horizon at least as long as the evidence: 5 years"*,
listed under *What holding this asset requires*. That turns the length of a
published series into an instruction to a person, and no report here holds the
circumstances that could support one.

**What it says now.** *"Awareness that the growth evidence covers 5 years, and
no longer"* — framed as a risk and monitoring consideration about the
**evidence**, closing with *"This report does not establish how long anybody
should hold the asset, and nothing here should be read as saying so."*

---

## 5 · A sales count is not liquidity, and an absence reassures nobody

**What was wrong.** Three things. The exit section called 162 settled sales
*"the depth of the buyer pool an exit would be tested against"* — a liquidity
claim a settled-sales count cannot support. The suitability profile raised a
requirement from it, *"Tolerance for however long an exit takes in a market of
this depth"*. And the heading was *"Resale liquidity — measured"* over a
figure that measures no such thing.

**What it says now.** The heading is *"What the market recorded"*; the section
opens by stating that neither half answers *how easily this sells*; and the
entry reads:

> **162 dwellings settled in the latest published quarter.** … a count of
> completed transactions at the geography and dwelling split named — not at
> this street, and not a measure of liquidity. **Days on market, time to sell
> and buyer depth were not measured for this market**: no publisher in the
> approved register issues them at this geography, and nothing here estimates
> them.

No requirement is raised from it. Where the register answers nothing at all,
the section says *"Nothing is estimated in their place, and their absence is
not evidence that the market is thin, deep, slow or fast."*

**A property fact is not a market record.** The lot size sat inside that list,
which also meant a record with no market rows still printed "What the market
recorded" over one line about the land. It is now stated separately as a
property fact, and the empty-register branch can actually fire.

**Engineering diagnostics leave the client document.** The market block printed:

> **Asked and could not answer.** Domain: Operation not permitted on project —
> no API package is attached to the Domain project this key belongs to

A vendor's internal refusal string, a statement about an API package and the
existence of a key — none of which means anything to a reader, and the last of
which should not be shown to one. The fact a reader needs is that a source was
asked and did not answer, so that is all the page states; the reason stays on
the structured evidence record, where an operator reads it, and a test asserts
both halves.

---

## What this does not close

Every correction above is **implemented and tested**, and the grade-rationale
block has been **read as rendered Markdown**. None is **released**: no report
has been generated with this code, so the interaction between these composed
sections and the model-authored prose around them is unverified, as is the page
flow through the template renderer. See
[`S5_EXECUTION_ROUTE.md`](./S5_EXECUTION_ROUTE.md) for why, and what unblocks
it.

Two further things stay open and are named rather than absorbed:

* **Location scores four of five only once this branch is released.** The cause
  is closed in `c0c7575` and `main` does not carry it, so every report
  generated today still stores a gated enrichment and still reads 3 of 5. The
  repair reaches a stored report when it is next generated; no migration
  touches a row.
* **The fifth dimension needs an acquisition or a decision** — § 3a states the
  three options and takes none of them.
