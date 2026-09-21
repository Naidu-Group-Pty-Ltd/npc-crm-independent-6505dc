# The Cowra Compass visual register

One row per chart or image in the supplied Investment Compass for
**48 Redfern Street, Cowra NSW 2794** (report `09f8569e-21ca-48b9-a3b9-57f4793d0836`,
generated 2026-09-11, 35 pages). Each row records what the visual is FOR, which
producer would have to have answered for it, what evidence the record actually
holds, what arithmetic or transformation stands between the two, the defect, and
the treatment.

Nothing here was read off the page and believed. Every number was traced back
through `report_content` to the stored record, and every rendering claim was
produced by **executing** the parser (`parseVizDirectives`) and reading the
renderer (`charts.pure.ts`) rather than by inspecting the PDF and inferring.

---

## 1. The finding that orders the rest

The document draws **33 directives**: 13 `glance` (qualitative, no figures) and
**20 quantitative or semi-quantitative** — 7 `bars`, 3 `gauge`, 3 `donut`,
2 `tiles`, 2 `timeline`, 1 `margin`, 1 `pictograph`, 1 `wheel`.

Of those 20, the number that bind to a producer the record holds is **zero**.

The record, read directly:

| Record field | Value | What it means for the charts |
|---|---|---|
| `demographics_data` | `NULL` | Both occupier-mix donuts, the pictograph and the housing-type bars have no population behind them |
| `location_intelligence` | `NULL` | Every distance bar on pages 12 and 13 has no measured distance behind it |
| `data_sources.marketData` | `null` | The market-positioning bars have no market series behind them |
| `data_sources.demographics` | `null` | — as above |
| `data_sources.seifa` / `.employment` / `.climate` | `null` | — |
| *(no planning/infrastructure key exists at all)* | — | Both infrastructure timelines have no register behind them |
| `investment_score.grade` | `"N/A"`, `gradeIssued: false`, `totalScore: null` | The three gauges and the risk wheel assert ratings the engine declined to issue |
| `investment_score.coverage` | `coverageRatio: 0.2`, `dimensionsScored: 1` of 5 | *A different measure — see the correction below* |
| `market_fact_snapshot` `market.demographics` | `status: "absent"` — *"not client safe: its label does not describe what it measures"* | Population was **explicitly withheld at the gate**, and page 11 charts it anyway |

The one dataset the record genuinely holds — **crime**
(`data_sources.crimeStatistics`, confidence 0.8, and the real BOCSAR figures
1,144 offences / 10,891 per 100,000 against a NSW postal-area average of 7,598)
— appears in **no chart at all**. It is the only sourced quantitative evidence
in the document and it is the only material drawn purely as prose.

So the document **charts what it cannot source, and leaves unsourced what it can.**

Worse, nothing reported it. `data_sources._generationQuality` records
`averageScore: 97` with **every section scored 100 and `valid: true`**. The
document passed its own quality gate with twenty unsourced graphics in it.

---

## 2. The register

`Producer` is the module or service that would have to have answered for the
figure. "**model**" means the number exists only because the generating model
wrote it into a `{{…}}` directive; no producer was asked and none answered.

| # | Page | Visual | Purpose | Producer | Evidence in the record | Calculation / transformation | Defect | Treatment |
|---|---|---|---|---|---|---|---|---|
| 1 | 5 | `gauge: 72` "Location–property alignment" | State how well the property suits its area | model | `locationScore: 32`, `hasData: false`, `excluded: true` | none — 72 is not 32, and 32 is itself unscored | A rating the engine declined to issue, drawn as a measurement. `suppressUnrecordedVerdictVisuals` catches it — but it shipped 2026-09-17, six days after this document | Remove the dial. The stage's finding is already in the prose beside it; where the grade is withheld the reason is the story |
| 2 | 6 | `gauge: 82` "Property–suburb fit" | Same claim, second number | model | none | none | Two different alignment scores, 10 points apart, one page apart, neither recorded | Remove |
| 3 | 8 | `donut: 45/35/20` "Likely occupier mix" — Family renters, Local owner-occupiers, Professionals & small households | Predict who will live here | model (would be `abs_census_poa`) | `demographics_data: NULL`; population **withheld at the client-safe gate** | none | Three categories on **three different classification axes** (tenure+household, tenure, occupation+size) summed to 100%. No denominator, no period, no geography. §3: *a suburb's demographic composition must not be presented as the predicted tenant mix of this particular property* | Replace with a qualitative statement of the target segment and the evidence it rests on. A share needs a census table, a POA and a period |
| 4 | 11 | `margin` sparkline `12759,12720,12690,12659,12680,12721` "Cowra Shire ERP trend, 2015–2024" | Show population stability | model (would be ABS ERP) | population **explicitly withheld**, status `absent` | six points captioned as nine years | Four faults at once — see §3 below. The chart contradicts its own caption | Remove until ABS ERP is loaded (task T). Then: labelled axis, real years, zero-anchored or explicitly ranged |
| 5 | 11 | `timeline` Existing / 0-2y / 3-5y / 5y+ | Show the infrastructure pipeline | model (no planning producer was asked) | no planning or infrastructure source in `data_sources` at all | none | §3 verbatim: *do not populate generic 0–2, 3–5 or 5+ year bands to complete a graphic*. Four bands, no dates, no publisher, no status. **And the "Existing" band was silently dropped** — 4 declared, 3 drawn (§6) | Status table: named project, publisher's own status word, the date something actually happened. Unknown timing stays unknown |
| 6 | 12 | `bars max=3 unit=km` — Core CBD 1.6, Primary school ~0.7, Hospital ~2.0 | Show how close daily needs are | model (would be Places/Distance Matrix) | `location_intelligence: NULL` | 1.6 ÷ 3 = **53% bar** | Scale chosen by the model. Colour inverted (see §4) | One distance scale across the document; direct labels; nearest-first; distance is not a score |
| 7 | 13 | `bars max=5 unit=km` — five amenities, **four silently dropped** | Same question, second chart | model | `location_intelligence: NULL` | 1.6 ÷ 5 = **32% bar** | **The same 1.6 km drawn 21 points shorter, one page later — the discrepancy §5 names.** And the parser drops any item whose value is a range: *Schools ~0.5–1.6 km*, *Supermarkets ~1.5–2.0 km*, *Hospital ~2.0–3.0 km*, *Major parks ~1.5–3.0 km* all vanished. A chart titled "Indicative reach" printed **one bar of five** | Fix the parser to carry a range; one shared scale; or an aligned distance table, which is what §5 prefers |
| 8 | 16 | `timeline` Existing / 0–2y / 3–5y | Amenity pipeline | model | none | none | **Three declared items, ONE drawn** — "Existing" and "0–2y" both silently dropped (§6) — under a fixed four-column axis, the one surviving cell ellipsised. A pipeline graphic that omits what already exists and what is next | As row 5, plus the parser fix |
| 9 | 16 | `bars max=10 unit=/10` — Subject 7.5, Cowra market 8.0, Central Tablelands 6.5 | Position the property against its market | model (would be `market_sales_medians`) | `data_sources.marketData: null` | none | Three scores out of ten, no scale definition, no direction, no method. The unit `/10` is not printed | Remove. The real market evidence in this section is the prose median range; publish that with its source |
| 10 | 17 | `gauge: 72` "Local market fit score" | Third alignment claim | model | none | none | The **same 72 as page 5** under a different name. §4: *avoid several unrelated gauges competing with the issued grade* — and no grade was issued | Remove |
| 11 | 18 | `bars max=100 unit=%` — Detached 80, Small units 10, Rural lots 10 | Show the local housing mix | model | `demographics_data: NULL` | none | Percentages with no denominator, no period, no geography. Unit `%` not printed | Census dwelling-structure table, or a qualitative statement |
| 12 | 18 | `pictograph 7/10` "seven in ten sales are traditional family houses" | Same claim as an icon row | model | no sales register was read | none | §3: percentages require a defined denominator. "Approximate share … in Cowra transactions" names a population nothing measured | Remove, or bind to `market_sales_medians` transaction counts once loaded |
| 13 | 19 | `donut: 50/30/20` "Likely occupier mix for this…" — Family households, Retirees/downsizers, Young singles/couples | Predict who will live here | model | `demographics_data: NULL` | none | A **second** occupier mix, different categories and different values from row 3, eleven pages later, neither reconciled. Title clipped to "for this…"; centre label clipped to "FAMILY HOUSEHOL…" | One occupier statement in the document, or none |
| 14 | 21 | `wheel 70,65,55,60,50,75` "Risk score breakdown (higher = more risk)" | Rate six risk categories | model | `riskScore: 60`, `hasData: false`, `excluded: true`; `riskRemedyFor` records Risk as unscoreable | none | Six ratings the engine cannot produce, on the one dimension the platform has formally recorded as **unscoreable**. §3: *incomplete evidence is not low risk* — and it is not a 55 either. Title printed BELOW the chart | Replace with the risk register's own three columns: exposure, evidence status, required action. Crime has real figures and belongs here |
| 15 | 26 | `bars max=100 unit=%` — Planning 90, Environmental 85, Building 80, Insurance 75, Market 70 | Rank the due-diligence actions | model | none | none | §5 verbatim: *do not invent numerical priority weights*. A descending 90→70 ladder with no method | Action matrix: what to verify, why it matters, what evidence exists |
| 16 | 30 | `donut: 40/35/25` "Evidence mix" | Say where the report's evidence came from | model | the record holds the real answer: 1 of 5 dimensions, `coverageRatio: 0.2` | none | Centre label clipped to "OFFICIAL STATISTI…". §3: evidence-coverage percentages require a reproducible counting method | Count the sources actually consulted, from `data_sources`. It is reproducible and it is already stored |
| 17 | 31 | `bars max=100 unit=%` — Address-specific 60, Suburb/postcode 30, General 10 | State the resolution of the evidence | model | *nothing in the record measures this* | none | The three shares have no counting method behind them, and the bullet directly beneath the chart reads *"Where population, SEIFA or detailed demographic figures are not measured … the report avoids quoting numbers"* — on the page after the one that charts population. **This row previously said the figures "contradict the record by a factor of three"; that comparison was wrong — see the correction below** | Derive from `data_sources` with a stated counting method, or state the resolution in words; keep it separate from any investment score, as §3 requires |
| 18 | — | `bars max=3` "Dwelling type alignment" (Subject dwelling · 3-bed house …) | Show configuration fit | model | `property_specs.bedrooms: NULL`, `bathrooms: NULL` | none | Asserts a 3-bed house on a record that holds no bedroom count — the contradiction already logged, reaching a chart. **And it never rendered at all**: no item carries a number, so `parseVizDirectives` returns `[]` and the visual disappears with no trace | Remove. The document already says, correctly, that the count is not recorded |
| 19–20 | 9, 10 | `tiles int=0.8 / int=0.5` ×2 | Compare the suburb to its neighbours | model | none | `int` drives a fill opacity | An intensity channel with **no scale and no legend** — colour carrying a value no reader can decode, which is §4's *colour must not be the only way to identify a series or status*. Page 10's fourth tile is clipped to "Agriculture-dominat…" | Keep the tiles, drop `int`, or give it a stated scale and a legend |
| 21–33 | 4, 6, 9, 13, 16, 18, 21, 26, 29, 31, 32 | `glance` ×13 (11 pages carry one) | Four-line orientation blocks | model | qualitative | none | No figures, so no accuracy defect. But **eleven identical "AT A GLANCE" panels in 35 pages** is §4's *repeated graphics that add no information* | Keep at section openings; drop where a section already opens with a lead sentence |

---

## 3. Page 11 in detail — four faults in one 38-pixel graphic

The population sparkline is the clearest single illustration of why §3 has to be
a contract rather than a prompt rule.

1. **The series is withheld evidence.** `market_fact_snapshot` records
   `market.demographics` as `status: "absent"` with the ruling *"This value is
   not client safe: its label does not describe what it measures."* The gate
   refused to publish population, and the model drew a population chart.
2. **The dates are not observations.** Six values are captioned
   *"Cowra Shire ERP trend, 2015–2024"* and *"over nine years"*. Six points
   cannot be nine or ten annual observations, and no point carries a year.
3. **The scale exaggerates.** `renderMarginSpark` sets `lo = min(values)` and
   `hi = max(values)`, so the drawing fills its full height whatever the range.
   Here the range is 12,659 → 12,759: **100 people, 0.8% of the base**, drawn as
   a full-height swing. §5: *line-chart ranges must be explicit and must not
   exaggerate minor movements.*
4. **The colour contradicts the caption.** The same function sets
   `trend = last >= first ? positive : negative`. The series ends 12,721 and
   starts 12,759, so `12721 >= 12759` is false and the chart is drawn in the
   **negative** palette — a red, full-height decline — directly beneath a caption
   reading *"broadly stable"*.

---

## 4. The colour rule, and why a distance chart is inverted

`renderBars` in `_shared/reportDesign/charts.pure.ts`, verbatim:

```ts
// Unspecified: magnitude reads as strength, which is the original behaviour.
return pct >= 0.66 ? ctx.palette.positive
  : pct >= 0.4 ? ctx.palette.accent
    : pct >= 0.2 ? ctx.palette.caution : ctx.palette.negative;
```

On page 12's proximity chart (`max=3`):

| Amenity | Distance | pct | Colour drawn |
|---|---|---|---|
| Primary school | 0.7 km — **the nearest** | 0.23 | **caution** (amber) |
| Core CBD & shops | 1.6 km | 0.53 | accent |
| Hospital & medical hub | 2.0 km — **the furthest** | 0.67 | **positive** (green) |

The nearest amenity is drawn as a warning and the furthest is drawn as a
success. §4 names this exactly: *do not automatically colour larger values
green; a longer distance is not inherently better, and a higher risk value has
a different meaning from a higher investment score.* The same default paints the
risk wheel, where 75 ("Transport reliance", the worst of the six) reads green.

It also explains the 1.6 km discrepancy's second half: at `max=3` the CBD bar is
accent, at `max=5` it is caution. The same distance is a different length **and
a different colour** on consecutive pages.

---

## 5. What the current guards do and do not reach

Executed over this document's real `report_content` with its real record:

- `recordedScoreValues(investment_score)` → `[]` (no grade issued)
- `suppressUnrecordedVerdictVisuals` → would remove **7 of 33**: the three
  gauges, the housing-type bars, the risk wheel, the due-diligence bars and the
  data-resolution bars.
- `suppressUnrecordedScores` → removes 0.

So the existing guard catches the *ratings* and reaches **none** of: the three
donuts, the pictograph, the distance bars, the market-positioning bars, the
population sparkline, the two timelines, the tiles, or the dwelling-alignment
bars — thirteen of the twenty.

And it runs in exactly one place:

| Function | Guard present |
|---|---|
| `generate-investment-report` | yes (1 module) |
| `fork-investment-report` | **no** |
| `condense-investment-report` | **no** |
| `render-investment-report-pdf` | **no** |
| `regenerate-report-qualitative` | **no** |

It also landed on **2026-09-17**, six days after this document was generated, so
it has never run on it — and because it is generation-only, every fork, every
condensation and every re-render of this stored report still prints all seven.

`presentStoredMarkdown` is the one read-path scrub every renderer already
applies (`InvestmentReportViewer`, `investmentReportAdapter`,
`investmentPdfSource`, `render-investment-report-pdf`). That is where the
read-path half of the contract belongs, for the same reason the placeholder
scrub went there.

---

## 6. Rendering losses found by execution, not by looking

Three of these are invisible in the PDF because what is missing leaves no mark.
Both drop rules were isolated by running `parseVizDirectives` on minimal pairs,
not inferred from the page:

| Probe | Items in | Items out |
|---|---|---|
| `timeline`, quoted label **without** a comma | 2 | 2 |
| `timeline`, quoted label **with** a comma | 2 | **1** |
| `timeline`, en-dash phase (`0–2y`) | 2 | 2 — *not* a cause |
| `bars`, plain values (`A 1.6 km`) | 2 | 2 |
| `bars`, one **range** value (`A ~0.5–1.6 km`) | 2 | **1** |
| `bars`, item with no number at all | 2 | **1** |

So there are exactly two rules, and both are silent:

- **A `timeline` item whose quoted label contains a comma is dropped.** The
  splitter divides the payload on commas before it looks at the quotes.
- **A `bars` item whose value is a range, or absent, is dropped.** The value is
  read as the trailing number of the item, and `~0.5–1.6 km` has none.

Measured against this one document:

| Visual | Declared | Drawn | Lost |
|---|---|---|---|
| Page 11 infrastructure timeline | 4 | 3 | "Existing" |
| Page 16 amenity timeline | 3 | **1** | "Existing", "0–2y" |
| Page 13 "Indicative reach" bars | 5 | **1** | Schools, Supermarkets, Hospital, Parks |
| "Dwelling type alignment" bars | 3 | **0** | the whole visual |

**Nine of fifteen items, and one entire chart, left the document without a
trace.** Every one of them is a label a reader was promised by the title above
it. §9 requires that *every plotted value and meaningful label survives
rendering*; today nothing checks, and nothing could — the loss leaves no mark on
the page, which is why four rounds of reading the PDF never found it.

Alongside those, five losses that *are* visible once looked for:

| Loss | Cause |
|---|---|
| "Likely occupier mix for this…" | title clipped to a fixed slot |
| "FAMILY HOUSEHOL…" (page 19 donut centre) | centre label clipped |
| "OFFICIAL STATISTI…" (page 30 donut centre) | centre label clipped |
| "Incremental civic and community facility…" (page 16) | timeline cell clipped |
| "RISK SCORE BREAKDOWN (HIGHER = MORE RISK)" printed *below* its own chart | `wheel` draws its title after the drawing, so it reads as a caption for the prose beneath |

## 7. What this register commits to

1. **Every quantitative visual carries a basis or is not drawn** — publisher or
   calculation owner, dataset, geography, period, units, denominator where one
   applies, and the transformation. Enforced at the four boundaries above, not
   only at generation.
2. **One scale per quantity per document.** The 1.6 km fix is not a number
   change; it is a shared scale.
3. **Colour never encodes magnitude by default**, and never carries meaning
   alone.
4. **An absence is stated, never rated and never filled** — no generic horizon
   bands, no invented priority weights, no manufactured intermediate points.
5. **A dropped item is a defect, never a silent shortening.** A chart that
   cannot draw what it was given says so.

Each is carried by a named module and a test in the sections that follow this
register.

---

## 7a. A correction to this register

The first version of this document compared the "Data resolution mix" graphic's
**60% address-specific** against `investment_score.coverage.coverageRatio`
(0.2) and called it a contradiction "by a factor of three".

**That comparison was wrong, and it is the same error the register exists to
catch.** The two percentages do not share a denominator:

| | what it counts | denominator |
|---|---|---|
| `coverageRatio: 0.2` | scoring DIMENSIONS the engine could measure | 5 (Growth, Demand, Yield, Location, Risk) |
| "Address-specific data 60%" | EVIDENCE held at address grain | undefined — the chart names no population of facts |

One is one of five dimensions scored. The other is a share of evidence by
geographic resolution. Setting them beside each other as though they measured
the same thing is exactly what §3 forbids — *"percentages require a defined
denominator"* — and doing it inside the register that enforces the rule is
worse than doing it in the report.

The finding that survives is simpler and is the one that mattered: **nothing in
the record measures the resolution of this report's evidence at all**, so all
three shares are unsupported. `coverageRatio` is not a smaller version of that
number; it is a different number about a different thing.

---

## 8. What was built against this register

Committed on `claude/reporting-engine-audit-4850hs`, each traceable to a row
above.

| Module | Rule | Register rows it closes |
|---|---|---|
| `vizDirectives.pure.ts` | a `timeline` label may contain a comma; a `bars` item that cannot be plotted is REPORTED, not skipped | 5, 7, 8, 18 |
| `vizFigures.pure.ts` | a chart that cannot plot everything it was given is set as a table of its own labels, in the model's own order | 7, 18 |
| `chartEvidence.pure.ts` | a rating the engine did not record, a share of a population the record does not hold, and a series the client-safe gate refused are withheld from the DRAWING | 1, 2, 3, 4, 10, 11, 12, 13, 14, 15, 17 |
| `chartScale.pure.ts` | one scale per quantity per document | 6, 7 |
| `charts.pure.ts` | colour is chosen, never derived from magnitude | 6, 7, 14 |
| `derivedHygiene.pure.ts` | all of the above run on the READ path, so a stored document and every child forked from it are reached | all |
| `fork-investment-report` | the contract runs on the child as it is written, and a QA error reaches `validation_flags` and `client_ready` | all |

Measured on this document, through `presentStoredMarkdown` with its own record:

| | before | after |
|---|---|---|
| gauges drawn | 3 | **0** |
| risk wheels drawn | 1 | **0** |
| rating bars drawn | 3 | **0** |
| population donuts drawn | 2 | **0** (tabulated, every label and figure kept) |
| population pictographs drawn | 1 | **0** (tabulated) |
| population sparklines drawn | 1 | **0** (the sidenote's prose stays) |
| distance charts on one scale | no — 3 and 5 | **yes — 5 and 5** |
| amenity rows reaching the page | 1 of 5 | **5 of 5** |
| timeline bands reaching the page | 3 of 4, 1 of 3 | **4 of 4, 3 of 3** |
| non-blank prose lines | 231 | **231, byte-identical** |
| headings | 44 | **44** |

The last two rows are the constraint that made the rest safe: **§2 asks for the
material finding and the next action to be preserved, and they live in the
prose.** Nothing this work does can reach a sentence.
