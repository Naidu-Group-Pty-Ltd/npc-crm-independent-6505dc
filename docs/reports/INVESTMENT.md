# Investment Location & Property Fit — the contract

> **Structure changed in v3.0.** Seventeen sections became eleven plus back
> matter, and the four-block commentary style this document's examples still
> show — *Key takeaway / Why this matters / What to watch / NPC view* — was
> removed outright. Read
> [`INVESTMENT_STRUCTURE.md`](./INVESTMENT_STRUCTURE.md) first. Everything
> below about the chart vocabulary, the tables, page economy and the
> WeasyPrint defects still holds; the section *names* and counts in it are
> v2.0's.

The largest format in the programme, the highest-volume one by an order of
magnitude — **1,182 rows in `investment_reports`, 5–18 a week, continuously** —
and the last to be read against production rather than against a fixture.

Everything below was measured against the live `investment_reports` table. Every
number is a count, not an estimate, and each one names something that was
silently wrong on every current report until this change.

---

## 1. The model draws, and nobody was listening

`generate-investment-report`'s prompt asks the model for a visual vocabulary and
enforces it hard — *"Every chapter MUST open with a `{{glance: …}}` strip"*,
*"Any list of 3+ ranked metrics MUST be rendered as `{{bars: …}}`"*. It obliges:

| kind | in the corpus | | kind | in the corpus |
| --- | ---: | --- | --- | ---: |
| `bars` | 718 | | `timeline` | 188 |
| `glance` | 660 | | `tiles` | 174 |
| `gauge` | 527 | | `margin` | 164 |
| `donut` | 431 | | `quadrant` | 105 |
| `wheel` | 346 | | `waterfall` | 8 |
| `heatmap` | 227 | | | |
| `pictograph` | 205 | | **total** | **3,753** |

**107 figures a report**, across 35 reports. `3,748` of the `3,761` lines that
carry a directive carry nothing else, so a whole-line rule covers 99.65% of them
and the 13 exceptions are a "how to read this report" legend where the model
*names* the kinds in prose.

The design system's Markdown renderer did not know the grammar, so every one of
them set as body copy. A client's page printed

```
{{bars: Bed/bath/car match to family demand 82, Layout flexibility 75 | title=Property fit | max=100}}
```

in the middle of a paragraph, about a hundred times a document.

The striking part is that **eleven of the twelve kinds already had a finished,
tested chart primitive** in `reportDesign/charts.pure.ts` — `renderBars`,
`renderGauge`, `renderDonut`, `renderScoreWheel`, `renderHeatmap`,
`renderPictograph`, `renderQuadrant`, `renderTiles`, `renderTimelineRibbon`,
`renderWaterfall`, `renderMarginSpark`. The vocabulary the model writes and the
vocabulary the design system draws are the same vocabulary. Nobody had connected
them.

Two modules do that now, and the split is deliberate:

- **`_shared/reports/vizDirectives.pure.ts`** parses to typed data and stops. It
  has no idea what a palette is.
- **`_shared/reports/vizFigures.pure.ts`** takes a parsed directive and a
  `ChartContext` and returns HTML.

`markdown.pure.ts` gains a `'figure'` block kind and one option,
`MarkdownOptions.renderDirective`, so it acquires no dependency on the chart
module — which needs a resolved palette and a column width that a Markdown
renderer has no business holding.

**A directive is never printed as source.** Omitting `renderDirective` removes
them anyway; a shortcode is an instruction to the renderer either way.
`MarkdownNotices.figuresDrawn` / `figuresDropped` count both outcomes, because a
silent drop looks exactly like a report the model chose not to illustrate.

### What the parser refuses, and why

98.7% of the corpus's directives parse. The residue is refused on purpose:

- `{{waterfall: Offer accepted +Contract, Settlement =Risk-managed}}` — a
  rhetorical waterfall whose "values" are words. There is nothing to plot and a
  chart primitive would draw a lie.
- `{{bars: Drive to Melton Station 8–12 min}}` — a range. 8 is not the figure
  and 10 is not in the source.
- `{{bars: Logistics & warehousing, Construction, Retail trade}}` — a list with
  no values at all.

`~` **is** accepted: `Tin Can Bay ~15 min, Rainbow Beach ~35 min` is how travel
times are written throughout, and refusing it loses the whole comparison.

### Tiles, and the one genuine ambiguity

The prompt asks for `{{tiles: Label value sub="…" int=0.7}}` and neither half is
delimited. `splitTileLabelValue` resolves it in three passes: a quoted tail
(`Cooloola Cove "Family coastal"`), a numeric tail (`Schools 4`, `Hawthorn
$1.42M`), and otherwise **the value starts at the last capitalised word**. That
last rule is right on every sampled string — `Economic & Mining Cycle` /
`Moderate–High`, `Tin Can Bay` / `Coastal leisure` — where "split at the last
word" gets three of seven wrong. With no capital after the first word there is
no signal, and the whole run becomes the label with no value: a thinner tile,
not a wrong one.

---

## 2. The generator stopped numbering its sections

| | reports | with numbered headings |
| --- | ---: | ---: |
| without `{{…}}` figures | 1,147 | 733 |
| **with them — every current report** | **35** | **0** |

`SECTION_CHARTS` keys the fourteen named infographics on the section number.
`PROSE_GROUPS` folds 36 numbered sections into four chapters by advancing on the
number. With no numbers:

- not one of the fourteen charts drawn from the structured jsonb columns reached
  the page, and
- the group index never advanced, so **all sixteen sections landed in "Location
  & Market"** — one chapter, three empty ones, and a contents page that named
  none of the model's own sections.

Both are fixed without touching the numbered path, which still serves
two-thirds of the archive:

- **`attachChartsByTitle`** maps the section titles the current generator writes
  — `Executive Verdict`, `Risk Dashboard`, `Population & Housing Demand`,
  `Financial Input Snapshot` — onto the named charts, each claimed at most once.
  `chartHasData` still gates every one, so a generous pattern costs a counted
  skip and nothing else.
- **A section becomes a chapter** when nothing is numbered. A report whose
  sections are already named and already in a deliberate order *is* its own
  chapter list. A keyword classifier was tried first and rejected: the financial
  variant opens with `Client Investment Decision Summary` and closes with
  `Financial Recommendation & Portfolio Fit`, so any monotonic keyword scan puts
  the entire document in the last chapter.

**The model's own figure wins.** `Executive Verdict` carries
`{{gauge: 61 | Location & Property Fit}}` *and* earns `score-gauge`, which draws
61 out of 100 from the score column — the same needle at the same value on two
consecutive pages, seen on the first render. `score-gauge` and `score-wheel` are
suppressed when the section already carries a `{{gauge}}` or `{{wheel}}`, and
only those two, because only those two plot numbers the model was handed.

---

## 3. The tables

### The score breakdown had never been read

Every one of the 985 scored reports stores a dimension as an **object**:

```json
"locationScore": {
  "score": 58, "weight": 56, "hasData": true, "excluded": false,
  "details": "Excellent walkability (90+). Limited CBD access (>60 min)."
}
```

`toScore` called `num()` on that, got `null` five times out of five, and
`chartHasData('score-wheel')` — which needs three — was false on every report
ever generated. The score wheel is the one drawing in this document that comes
from the scoring engine rather than the model's prose, and it had never been on
a page.

It now reads the object, and `weight`, `details` and `excluded` come with it. An
**excluded** dimension is `null`, never a zero: the engine is saying it had no
data, and plotting it would put a fabricated point on the wheel.
`scoreBreakdownTable` prints the five dimensions with their weights and the
engine's own one-line reason, and keeps an excluded row saying "Not scored" —
four rows where the wheel has five reads as a table cut for space.

### The spec table printed neither dimension

| field | populated in `property_specs` | in `financial_calculations.propertySpecs` |
| --- | ---: | ---: |
| land size | **0** | 110 |
| building size | **0** | 109, as `buildSizeSqm` |
| bedrooms | 651 | 0 |
| property type | 1,054 | 34 |

`property_specs` exists on all 1,182 rows with exactly the snake_case keys
`toSpecs` reads, which is why nothing ever looked wrong — it is mostly nulls.
`toSpecs` now takes the finance run as a fallback. Note `buildSizeSqm`: not
`building_size_sqm`, not `buildingSizeSqm`, both of which were already accepted
and neither of which exists on any row.

The table also stopped repeating the tiles above it. `propertyTiles` draws
bedrooms, bathrooms, parking, land, building, year, zoning and type; the table
drew all eight again on the next page. It now carries the address and the
council — the two the tiles have no room for — and the whole opening chapter
fits one page.

### The KPI strip broke its own values

`table-layout: fixed` divides the strip evenly, so six cells across the 174mm
measure is about 28mm each. At `h2 + 2` and `line-height: 1` a value that wrapped
printed its second line's ascenders through the first line's descenders. Two
changes: the leading is 1.08, and a strip of five or more cells
(`KPI_DENSE_FROM`) sets its figures a step smaller. Read off a render before:
`3.74 / %` and `Hous / e`.

### The sources chapter counted its own headings

`sources_content` opens `## SOURCES & REFERENCES` / `### Citations:` on 1,114
rows and carries `### Additional Sources:` on 777. All three are longer than the
eight-character floor, so all three were counted and printed: a chapter of 19
URLs was captioned "21 cited" and its table's first two rows were the headings
above it. **Those three strings are the only non-URL lines in the column.**

---

## 4. Page economy, and the budget

A chart drawn at `CHART_WIDTH.compact` — a gauge, a donut, a score wheel, a
pictograph — is 460 units wide. Stretched across the measure at `width: 100%`
that is 113mm of a 253mm text block for a single number, and the corpus averages
fifteen gauges a report. `chartFigure` now takes a `ChartFigureWidth`; `compact`
prints at 60.5% (`CHART_WIDTH.compact / CHART_WIDTH.wide`) and **the caller must
narrow its `ChartContext.widthMm` by the same fraction**, or every label inside
the drawing is set at the wrong point size.

Figures are charged to the page budget for the first time. `proseLines` passes a
`planningChartContext` — grey, never printed — because a chart's height is a
function of its data and its column width and not at all of its colours, so the
planner measures the figure the render will actually draw rather than a per-kind
constant that goes stale.

`MAX_DOCUMENT_LINES` rose from 2,000 to 3,200 for that reason. 2,000 lines is 53
pages; the Compass document a client was sent last month is **61**, so the old
ceiling was already cutting sections off the end of the longest reports before a
single chart existed. 3,200 is 84 pages, under the archetype's own 92.

---

## 5. What the fixture had to change

`fixtures.ts` agreed with the normaliser and disagreed with the database, which
is the failure this whole document is about arriving one level down. Three
shapes were corrected to what production holds, and each correction turned a
passing test into a failing one:

- `breakdown` values are objects, not numbers;
- `property_specs` land and building size are `null`, and the real dimensions sit
  in `financial_calculations.propertySpecs`;
- `sources_content` opens with its three headings.

`currentFormat()` is new: the same structured columns, with prose in the shape
the generator writes **today** — sixteen named sections, no numbering, a
directive under each. It is what `render.spec.ts` writes to
`reports/html/investment-compass.html`, because the artefact anyone looks at
should be the document a client receives this week.

Its directives never repeat, for the reason the prose already didn't: cycling
seven of them over sixteen sections put the identical gauge on two pages and
fired `duplicate-block` — the critique rubric's only `high` finding — five times
on the fixture alone, which makes the strongest check in the harness useless for
the document it is checking.

---

## 6. Verification

```
npx vitest run src/lib/reports src/lib/reportDesign src/lib/brandDesign
npx tsx scripts/reports/renderAll.mts --only investment-compass
```

The render leaves page images under `reports/pages/investment-compass`. The
rubric is a floor; the pages are the evidence. As of this change the document
carries no `high` findings, and the following were confirmed by looking at them:

- every one of the twelve kinds draws (`vizFigures.spec.ts` asserts each);
- no `{{` survives into the HTML on any path, with or without a renderer;
- land 612 m² and building 198 m² print on the spec page for the first time;
- the score wheel prints with its five weighted dimensions and the engine's
  reasons beside it;
- the KPI strip sets `House`, `3.74%` and `−$6.7k` each on one line.

## 7. Page economy — and the fixture that was measuring the wrong document

The sentence that stood here said the remaining sparse pages were the
chapter-per-section page break. **That was mostly wrong, and the way it was
wrong is the same failure as the score breakdown one level up: the fixture
agreed with the code and disagreed with the database.**

| per section | fixture (before) | corpus | fixture (now) |
| --- | ---: | ---: | ---: |
| characters | 958 | **7,938** | 7,634 |
| paragraphs | 2 | 11.5 | 12 |
| `###` sub-headings | 0 | 4.3 | 4 |
| bullets | 0 | 6.7 | 7 |
| **chart directives** | **1** | **6.9** | **7** |
| bold-carrying lines | 0 | 14.7 | 13 |

Every page-economy number this format had ever produced was taken on a document
**8.3× thinner per section** than the one a client receives. Resizing the
fixture to the measured composition, and changing nothing else:

| | thin fixture | production-density fixture |
| --- | ---: | ---: |
| pages | 28 | 86 |
| median ink | 0.065 | **0.100** |
| pages in the 0.133–0.221 band | 4 of 26 | **27 of 84** |
| sparse pages | 17 (**61%**) | 21 (**24%**) |

### Where the 21 that remain actually are

Cross-referenced against the chapter openers rather than guessed:

- **11 are chapter tails** — the last page of a chapter, which is part-full by
  definition. A chaptered document pays a part-page per chapter; at 18 chapters
  that is about eight sheets. This is what a chapter costs, not a defect.
- **10 are mid-chapter**, and every one is a figure that did not fit in the
  space left and pushed whole to the next page. `.chart-figure` is
  `page-break-inside: avoid` and must be — a chart split across a fold is worse
  than a gap — so the hole is the price of an unbreakable figure at seven
  figures a section.
- **No chapter opener is sparse.** They are full pages.

### 86 pages reconciles with the 61-page delivered document

The Compass a client was sent last month is 61 pages and carries **zero**
figures — its directives printed as body text. This document draws 112 of them
at roughly eight lines each, which is about 24 sheets. 61 + 24 ≈ 86. The page
growth *is* the figures, which are the point of the format.

### What a thin section does now get

`THIN_CHAPTER_LINES` (half a page, 19 lines) moved from the converted-template
format into `markdown.pure.ts`, and the unnumbered path packs a section under it
into the chapter before it rather than opening a sheet. It fires rarely by
design: **27 of 546 real sections (4.9%)** are that short.

### Two defects the render showed, which no test could

- **Every timeline clipped its first label.** `renderTimelineRibbon` centred all
  four phase labels, so the first sat at x=44 in a 760-unit viewBox and a
  28-character label spanned −16 to 104. "Rail within 900m" printed as "ail
  within 900m", on all 188 timelines in the corpus. The end labels now anchor to
  the edge; only the interior ones centre.
- **Every glance strip printed two markers.** The model writes its own — a tick,
  a diamond, a warning sign, a star — and the stylesheet added a bullet in front
  of it. 660 glance strips in the corpus. `ul.marked` drops the sheet's marker
  and keeps the list semantics a tagged PDF needs.

### The measure to take before touching any other format's layout

Seven of eleven formats sit below the 0.133 ink floor, and the investment result
says a low number is not evidence of a layout fault until the fixture is checked
against production:

| format | fixture payload | production median | ratio |
| --- | ---: | ---: | ---: |
| investment-compass | 122,255 (was 15,292) | ~140,000 | **1.15×** (was 9.2×) |
| market-intelligence | 18,209 | 64,229 | **3.5× thin** |
| report-qa | inline in the spec | 2,193 per answer | not yet measured |
| the other eight | — | — | not yet measured |

Market Intelligence is the worst-measuring format in the programme at 0.060, and
it is **3.5× thin**. Nobody should change a page rule there until that is fixed
first. The method is the one used here: take the format's production table,
median the payload column, and compare it to what the fixture builds.

---

## 8. What a render against the stored row showed, and a fixture never could

Everything above was measured against production. This section is the same
method applied one level further out: the Compass masters rendered against
**one stored row** — `1be16c4a`, 93 Bimbadeen Avenue, Banora Point, generated
15 Aug 2026 — and the pages looked at. Five defects, four of them on every
report in the corpus rather than on that one.

### The property table printed eight labels and one value

Counted over all 1,187 rows on 2026-08-16:

| row | resolves on | where from |
| --- | ---: | --- |
| Address | 1,187 | `property_address`, never null |
| Property type | 1,059 | `property_specs`, + 34 from the finance run |
| Configuration | 656 | bedrooms 651, bathrooms 633, parking **0** |
| Land area | 114 | `financial_calculations.propertySpecs.landSizeSqm` |
| Building area | 114 | `…propertySpecs.buildSizeSqm` |
| Year built | **0** | key present on 1,059 rows, null on all of them |
| Zoning | **0** | as above |
| Council | **0** | as above |

Three of the eight could not print on any report ever generated, and the
comment in the master claiming `council_area` was populated on 1,054 rows was
simply wrong — the **key** is on 1,059 rows; the **value** is on none.

Two things came out of it.

**A row now carries its own conditional.** `ad99bc228` established the rule and
expressed it as `oneOf` variants — workable for the Client Details residence
(two optional fields, four variants) and impossible here, where six of eight
rows are optional and the same construction is 64 whole-table variants.
`visibleTableRows` (`blocks/_data.ts`) filters per row, carries the **authored**
index so `totalRows`/`sectionRows` still name the rows their author named, and
stripes on the **drawn** position. A table whose every row drops renders
nothing, because a column head is the same promise a label is. Dropping rows
can only make a table shorter than its declared height, so the failure
direction is white space, never an overlap.

**And `projectInvestmentReport` was reading one column of two.** `toSpecs` in
the flowing report's normaliser already took `financial_calculations.propertySpecs`
as a fallback; the templated path's own reader did not, so `property.landArea`
and `property.buildingArea` were unresolvable on all 1,187 rows while the record
held both on 114. Land and building area now print on a Compass page for the
first time. The spelling to keep in mind is still `buildSizeSqm`.

### The ten-year equity chart had no y axis at all

Three dashed gridlines at 25/50/75% of the plot, no label against any of them,
no axis, no value anywhere on the figure. Equity rose from $348,150 to
$1,116,298 and a reader could not tell $100k from $10m.

The fix is in `blocks/charts.html.ts` — **not** in `reportDesign/charts.pure.ts`,
which is where you would expect it. Those are two chart implementations: the
flowing render routes draw the projection with `renderSeriesFan`, which has
labelled its y axis from `formatAxisValue` all along, and the template blocks
are a separate family (`chart-line`, `chart-area`, `chart-bar`,
`chart-stacked-bar`, `sparkline`). That is why the defect survived — the
canonical module was right, and the masters do not use it. The tick wording is
now imported from it, so an axis figure has one spelling.

Three more the same render showed, each a figure a reader cannot read:

- **Both end x labels were clipped.** Every label was `text-anchor:middle` on a
  point at the edge of the viewBox: "Yr 1" printed as "1" and "Yr 10" as "Yr".
  This is `renderTimelineRibbon`'s recorded defect, reached independently in the
  second implementation.
- **The top tick sheared through the chart's own title** until the plot took a
  line of head room.
- **On the bar-drawing families the tallest bar had no value over it** — year
  ten's $1,116,298, the one figure the page exists to state, set three points
  above the viewBox.

`Math.max(1, …)` as a line chart's upper bound is also gone: on an all-negative
series it pinned the top of the plot to a value of 1 that is in no series. The
domain still includes zero, so no chart in the catalogue changes shape.

The axis unit is **declared by the caller** (`axis: 'money'`) and never guessed.
A chart that labels a ratio as currency is a misstated figure on a client's
page, which is this programme's top risk.

### The contents page listed sheets, not sections

`toc` drew a row per rendered page. The Compass sets aside 40 pages for the
report body, so a real document's contents read "The report", "The report (2)"
… "The report (40)" and filled two sheets. Report Q&A did the same with its
eight answer pages.

`PageSchema.tocContinues` is how a master says a page continues the one before
it. Declared, not inferred: a `Name (2)` convention reads intent out of a
display string, and a contents page is not a place to guess. Rendered against a
body long enough to fill the allowance, the list goes from ~50 rows to 11, and
the entry after the report still names the page the next section starts on.

### "Total acquisition cost / Sum of the above" was two false claims

`financials.totalCost` is `initialCosts.totalUpfront` — $340,287 — printed
under rows adding to $1,460,587, because the purchase price is in the same
column and is not a cash cost.

It is not the sum of anything, either. Over the 167 stored runs that carry the
block, `totalUpfront` equals deposit + duty + legal + inspection + LMI on
**29**; the average gap is $454 and the largest is $93,000. `totals` draws the
doubled rule that means "the numbers above add up to this", so the rule was
itself the claim.

The row says what the figure is (**Total upfront cash**), the basis says where
it comes from rather than how it was reached (**Cash required at settlement**),
the doubled rule is gone, and the deposit — the largest part of that cash,
published all along — is a visible row. The cash-flow table below keeps its
total, because its net position genuinely is one.

### An empty heading is the same defect as an empty row

`strengths-watch` dropped items that resolved to nothing and kept the heading
over the hole. `investment_score.weaknesses` is empty on **313** of the 1,187
reports and `strengths` on **439**, so a naked "CONSIDERATIONS" was the printed
outcome on a quarter and a third of them respectively.

### The check that finds this class

`investmentPropertyRows.spec.ts` renders the real masters against the real
stored shape and against a record that fills every field. `SAMPLE_REPORT_DATA`
fills all nine spec fields, which is exactly why it could not see any of this.

### The cover title had a fixed number of lines and a variable title

`titleHeight` was `coverTitle * 1.12 * 2` — two lines, on every family, for
`property_address`. Measured over all 1,187 rows that string is 19 characters
at the median, 44 at p90, 61 at p99 and **84** at its longest, and the cover
measure is 86% of the page width: four lines at Private Banking's 41pt, seven
at Objective's 61pt. The WeasyPrint render showed the third line struck through
by the gold rule and the fourth printed across the standfirst.

Reserving for the longest address is the same mistake pointing the other way —
it leaves the median address floating a hundred points above its own rule on
every cover in the archive. Two changes instead:

- **The block's foot is pinned** (`anchorBottom`, new in `absBoxStyle`) and it
  grows upward into the empty half of the cover. Every other block stays
  `top`-anchored, which is what `flow()`'s arithmetic describes; this is the one
  where the height belongs to the data and the baseline is the fixed thing. The
  overflow cannot happen rather than being budgeted for.
- **A long title is set smaller**, because that choice is data. The cover emits
  the title twice at the same position under complementary conditionals, and
  both the threshold and the smaller size are **derived per family** from the
  measure, the leading and the distance from the rule to the head — the same
  character-advance model `textHeight` uses. Four of the fifty masters need the
  second size (Grand Folio 47.25→43.3, Elevation 42.5→41.5, Objective
  61.25→46.3, Raster 52→51); the other 46 carry the longest address there is at
  full display size.

### And one thing that was never a rendering defect at all

"The cover verdict loses its spaces" — reported as
`HOLD - Aboveaverageinvestment withsome positiveindicators,monitor closely`.
Rasterised, the page reads correctly. WeasyPrint emits a wrapped,
letter-spaced line as several show-text operations with positioning
adjustments and **no space character between them**, so any text extractor —
`pypdf`, or copy-and-paste out of a viewer — reassembles the line without its
spaces. Worth knowing before chasing the next one: a defect read out of a
PDF's text layer needs confirming against the pixels.

The same cell did carry a real defect, which is how the report was right about
something being wrong: `investment_score.recommendation` averages 69
characters and a cover KPI cell is a quarter of the measure, so five lines ran
past the band's 78pt and the bottom rule struck through the last one. A KPI
cell holds a figure; it now holds the action (`HOLD`), split exactly — all 988
scored reports are `ACTION - sentence` or the bare action over a four-word
vocabulary, longest action eight characters — and the sentence stays on the
verdict page.

### Reproducing a WeasyPrint render without the container

Three of the defects above are invisible in Chromium and obvious in the engine
that actually prints the document — the cover title, the KPI band and the
extraction artefact all needed a real PDF. `weasyprint-service/` is a Cloud Run
image and needs Docker; for *looking at a page* the Python package is enough:

```
pip install weasyprint pypdf pypdfium2
```

```python
from weasyprint import HTML
import pypdfium2 as pdfium, re
html = open('page.html').read()
# The render boundary refuses a network fetch, so strip what the compiler
# would have inlined; see RENDER_BOUNDARY.md.
html = re.sub(r'<link[^>]*fonts.googleapis[^>]*>', '', html)
HTML(string=html, base_url='.').write_pdf('out.pdf')
pdfium.PdfDocument('out.pdf')[0].render(scale=1.3).to_pil().save('out.png')
```

Two caveats, both of which cost time here. The typefaces **substitute**, so
line breaks differ from production — the geometry is indicative, the wrapping
is not. And it is not the pinned engine: read
[`CONTAINER_RELEASE.md`](./CONTAINER_RELEASE.md) before drawing a conclusion
about a version-specific behaviour. What it is reliable for is the class of
defect this section is full of — a box that does not hold what is put in it.

### The scorecard printed a score the engine never gave

`breakdown.<dim>` carries `excluded: true`, `hasData: false` and `weight: 0`
when the engine had nothing to score with — and leaves a **placeholder `score`
of 50 in the field**. The table bound `score` and `weight` straight through:

```
Growth   50   0%
Demand   50   0%
```

A figure the assessment never produced, beside a weight saying it counted for
nothing. 9 of the 988 scored reports are in that state (growth and demand,
always together), and on every one the placeholder is exactly 50 and the
weight exactly 0.

`toScore` in the flowing normaliser already refuses to plot it. The projection
now refuses on the templated path too: the numeric `score`/`weight` are
withheld so nothing can plot them, and `scoreLabel`/`weightLabel` are composed
— "Not assessed" and "—". **The row stays**: four rows where the reader has
been told there are five reads as a table cut for space.

Worth recording why it survived a year of renders: **Yield genuinely scores 50
on many reports**, so a 50 in that column is unremarkable. The test asserts the
two withheld rows say so rather than asserting `50` never appears — the second
form passes on a report where nothing is withheld and fails on one where a
real dimension scores 50.

The standfirst above the table also stopped saying an unscored dimension "is
scored at the midpoint", which described the placeholder rather than the
report, and would now contradict the page beneath it.

### Three blocks, one heading

The reasoning under the scorecard is one block per dimension that carries
prose, and each was titled "Why" — so a report with all three printed the word
three times down the page with a single row under each. The first to render
carries the heading; the rest are headless continuations, expressed as `oneOf`
variants so the page reserves one position rather than two.
