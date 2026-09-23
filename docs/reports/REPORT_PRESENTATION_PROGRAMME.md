# The report presentation programme

Finalised 21 September 2026. Every number in this document was measured from
**one delivered PDF** — the Investment Compass issued for 9 Hollow Street,
Golden Square VIC 3555 on 21 Sep 2026, 39 pages, 529,181 bytes — by reading the
FILE with `pdfjs-dist` rather than the source that made it. That is the same
method `A_PREMIUM_DOCUMENT.md` used, and for the same reason: it is what turns
"the reports don't look right" into a number, and it is the only way to find a
defect the source cannot show you.

Where a finding is a count, the extraction is: 2,154 text items carrying
position, size and font; per-page operator lists counting path, fill, stroke and
image operations; the PDF's own embedded font table.

---

## 0 · The two rules this programme is built on

**Every property in Australia gets the same document.** Not the same *quality of
evidence* — that varies by what a jurisdiction publishes — but the same
structure, the same visual language, and an honest statement of its own
coverage. A Darwin property and a Sydney property come out of one machine.

**A fix lands at the layer that cascades.** The catalogue is 500 masters —
10 design families × 5 structural variants × 10 colourways — sharing ONE shell
(`investmentCompass/master.ts`), and those designs carry no subject matter, so
they serve all ten migrated report formats: Investment Compass, Borrowing
Capacity Snapshot, Portfolio Performance Review, Property Comparison Analysis,
10 Year Cash Flow, Client Details Form, Cash Flow Comparison, Report Q&A,
Commercial & Industrial Capacity and Market Intelligence. Beneath them sit one
Markdown implementation (`_shared/reports/markdown.pure.ts`), one directive
parser and router (`vizDirectives.pure.ts`, `vizFigures.pure.ts`) and one
geometry module (`narrativeGeometry.pure.ts`). **A change in any of those
reaches every format and every colourway.** A change inside one composer reaches
one composer. The programme is sequenced so that the cascading layers go first.

---

## 1 · What the delivered document actually does

### 1.1 The clean bills, stated first

These classes have been measured and are **not** defects, and they should not be
re-opened without new evidence:

- **No text falls outside the page box.** 0 of 2,154 items.
- **No overlapping baselines.** 0 collisions. The class that once printed the
  verdict heading through the KPI band is closed.
- **Page 4's assessment table is correct** — "SHARE OF GRADE" over four rows,
  Growth 64/47%, Location 89/30%, Yield 96/18%, Demand 68/5%, matching the
  stored record exactly and footing to the published composite of 77.
- **The display faces render.** The PDF embeds Cinzel, Playfair Display (4
  weights), Inter (5 weights), IBM Plex Mono (3 weights). Tabular/monospaced
  figures are available to financial tables, which REPORT_RULES §4 requires.

### 1.2 The finding that reframes the rest: the charts draw, and half of them are not measurements

**A correction to the first version of this plan, kept rather than quietly
rewritten.** It stated that the delivered PDF contains *zero charts*, on the
evidence of a per-page operator list showing no image XObject in the body. That
reading was wrong and the probe was counting the wrong thing:
`chartFigure()` emits an SVG, and **WeasyPrint draws a data-URI SVG as native
vector paths** — there is no image to count. Re-measured by FILL COLOUR, the
brand gold `rgb(142,108,21)` appears in the path fills of the chart pages and
in none of the text-only ones. The figures are on the page. The rule this cost
is the one §7 of `INVESTMENT_REPORT_RESUME.md` already charges for: *an
instrument that can fail the way its subject fails is not an instrument*.

What is true, and is worse, is what those figures SAY. Driven through the real
parser, the twelve quantitative directives in `report_content` divide like
this:

| | |
| --- | --- |
| Measure something and draw correctly | **4** (two price-vs-median pairs, two growth heatmaps) |
| Plot nothing but flags | **5** |
| Have no series the parser can read | **1** |
| Draw the wrong numbers, convincingly | **2** |

**Five plot nothing but 0 and 1.** `{{bars: Zone GRZ … 1, Overlays checked &
none mapped at coordinate 1, Land use table & certificate not yet read 1 |
unit=index}}` draws three identical full-length bars.
`{{bars: GRZ zoning verified 1, Overlays mapped 0, Overlays checked list 1}}`
draws `Overlays mapped` at zero height beside two full ones — which a reader
takes as *no overlays*, when the register says overlays were CHECKED and none
were mapped at the coordinate. That is a retrieval result stated as a count of
zero: `rentalEvidence`'s rule — **absent is never zero** — committed in ink.
`{{margin: Overlay check basis | spark=1,0}}` is the same thing at the smallest
size the document draws.

**And two draw the wrong numbers while looking entirely correct**, which is the
finding that reframes the rest:

```
{{bars: Healthcare 10 within 5 km, Shopping centres 10 within 5 km,
       Parks & recreation 9 within 5 km, Restaurants & cafés 10 within 5 km
       | title=Local amenity counts within 5 km | unit=facilities}}
```

The grammar is `Label Value` and the model wrote a sentence. The parser takes
the last number, so every item plots **5** — the RADIUS — and the counts 10,
10, 9 and 10 are stranded in the labels, which are left reading
`Healthcare 10 within`. Four identical bars, under a title promising amenity
counts, on a record whose own enrichment measured four different ones. The
climate chart is the same cut: `Annual rainfall vs local normal 683.1mm vs
511.3mm` plots **511.3**, the long-run normal, and discards the 683.1 the title
exists to compare it against.

Three of the document's `{{` sequences also printed **raw template markup to
the client**:

```
p25   {{stat label="Crime data coverage" unit="" sub="Recorded-crime register …"
p26   {{stat label="Registered major public projects" unit="" sub="Within ~15 km …"
p30   {{stat label="Golden Square house median" unit="$" sub="Vic Valuer-General, 2025" 567500
```

`stat` is a FENCE kind opened with the DIRECTIVE delimiter, so it matches
neither parser, nothing strips it, and it reaches paper verbatim. Closed by
W1.1.

### 1.3 Structure and placement

**The document closes and then runs on for eight more pages.** Its own contents
page prints the defect:

```
16. Final Recommendation ......................... p.29
17. Appendix, Source Notes & Disclaimer .......... p.29
18. Planning controls and development registers .. p.30
19. Resale Liquidity & Exit Outlook .............. p.33
20. SWOT Analysis ................................ p.33
21. Monitoring & Review Plan ..................... p.36
```

A fifth of the document sits after the disclaimer, and two of those sections are
substantive analysis the recommendation eight pages earlier should have rested
on. **Cause:** two blind `reportContent += …` concatenations at the end of
assembly. The registry was never wrong — it declares `exitOutlook` 13, `swot`
15, `monitoring` 18, `recommendation` 19 and `provenance` **90**, last and
deliberately; every model-authored section is in its declared position.
**Closed this session** by `documentPlacement.pure.ts`; takes effect on the next
generation of each report.

**Two sections have nowhere to exist.** In the Compass registry:

```
infrastructure  ("Infrastructure and Growth Context")        → merged('locationCase')
supplyPipeline  ("Competitive Landscape and Supply Pipeline") → merged('marketPosition')
```

This is precisely the fault v4.0 fixed for Zoning, which had been a
`sourceHeading` of the Risk Dashboard so "a retrieved planning control had
nowhere to be explained and the reader got a row". The registry's own rule is
*a section with nothing behind it should be merged; a section with a register
behind it should not.*

### 1.4 Page-level defects, with measurements

| # | Page | Finding | Measurement |
|---|---|---|---|
| a | 25, 26, 30 | Raw `{{stat …}}` markup printed to the client | 3 occurrences |
| b | all | No chart drawn anywhere | 20 directives → 0 figures; 14/39 pages at the furniture floor |
| c | 5 | Titled "RISK REGISTER", contains no register — a restatement of the grade and a pointer back to p4 | **18% fill**, 20 items, 381 chars |
| d | 37 | Monitoring table: 5 columns crushed to 5–6 lines per cell, **one data row**, on a page four-fifths empty | **21% fill** |
| e | 3 | The Verdict page lists **one** strength and stops | 53% fill, ~260pt white below |
| f | 4 | `definitions('Opportunities', [{ term: 'Noted' … }])` — a placeholder word occupies the term column; only `{{opportunities.0}}` is ever drawn | 14pt "Opportunities" over 10pt "Noted" |
| g | 16 | Four bullet glyphs with no text beside them, plus a stray "1" | y=639, 623, 606, 575 at x=61 |
| h | 17–19 | Running head wraps: "Zoning, Planning and Development Considerations" (46 chars) exceeds the ~124pt right-aligned marker, orphaning **"Considerations" alone at 6.2pt on three pages** | every other chapter fits one line |
| i | 34 | `osm_amenity_register` — a snake_case table name printed in client prose | 1 occurrence |
| j | 19, 21, 26 | U+2011 non-breaking hyphen falls back to a substituted face mid-word | 3 characters, 3 pages |
| k | 1 | Cover verdict block `BUY · A · 77` set at **11pt** against a 41pt address | — |
| l | 4 | "Priced below suburb median — potential for value appreciation" under *Opportunities Noted* | **Closed this session** |

### 1.5 The Zoning, Planning and Development section

Three pages (16–18) say, in substance: it is GRZ; no overlays are mapped; we
cannot tell you minimum lot size, maximum building height or floor space ratio;
obtain a planning certificate. The "At a glance" **Strength is an absence** —
*"No mapped overlays at the property coordinate"* — and the Verdict is
*"Desktop planning check only."*

Page 22 carries the sentence that costs the most:

> "No infrastructure project or development instrument was retrieved for this
> location from the registers this platform reads."

The report already proves the material exists: page 22 quotes the **Golden
Square Structure Plan** ("substantially dominated by detached / separated
dwellings, with 88.6 percent…"). The model found that by search. No register
retrieved it, so nothing can be tabulated, dated, sourced or scored from it —
and under the standing rule *a web search is not a retrieval*, it should not be
relied on at all.

---

## 2 · National coverage, measured

| Register | Jurisdictions | Verdict |
|---|---|---|
| `amenity_register` | ACT, NSW, NT, QLD, SA, TAS, VIC, WA | ✅ national |
| `urban_centre_register` | ACT, NSW, NT, QLD, SA, TAS, VIC, WA (102 SUAs) | ✅ national |
| `market_sales_medians` — medians | all 8 + an `AU` floor | ✅ national |
| `market_sales_medians` — **sales counts** | NSW, QLD, SA, VIC | ❌ **Demand cannot score in ACT, NT, TAS, WA** |
| Planning constraint layers | NSW, VIC, QLD, TAS | ❌ **nothing in SA, WA, NT, ACT** |
| Recorded crime | NSW, QLD, SA, NT | ❌ 4 of 8 |
| GTFS transport | 4 networks, 185,177 stops; VIC declared-but-unloaded | ❌ partial |

The platform already solves "national" correctly five times — geocoding,
sales medians, amenities, commute and street imagery all run **a national floor
refined by per-jurisdiction providers, with coverage travelling with the
answer**. Planning and development is the one area that does not, which is why a
Bendigo property gets three pages of absence and a Perth property would get
worse.

---

## 3 · The workstreams

Each item states its acceptance test, because an item without one is an
intention.

### W1 · The visual layer — cascades to all ten formats

**W1.1 · Close the directive vocabulary.** ✅ **DONE** — and the repair was
worth more than the strip.

`braceHygiene.pure.ts`, on the read path in `presentStoredMarkdown`. The three
lines that reached page 25, 26 and 30 of the 9 Hollow Street document were the
FENCE kind `stat` written with the DIRECTIVE delimiter `{{`, then closed
correctly with `:::` — so `VIZ_DIRECTIVE_RE` (which needs a colon) matched
nothing, `VIZ_DIRECTIVE_EMPTY_RE` (letters and spaces only) matched nothing,
nothing claimed the line and it fell through as body copy. The stored source
counts 26 `{{` against 23 `}}`, and the difference is exactly those three.

Only the delimiter was wrong, so the scrub REWRITES `{{stat …` to
`::: stat …` and hands a well-formed fence to the renderer that already draws
it — which keeps three figures the model composed, one of them the
`$567,500` Golden Square house median. What cannot be repaired is stripped and
never printed. A legitimate multi-line `{{bars: …}}` is left alone.

*Accept:* met for the spec half — `unresolvedBraces` is asserted over every
directive kind and every fence kind through the real read path. **The corpus
scan is NOT done**: it needs a read of `investment_reports.report_content`
across 1,199 stored rows, and direct SQL is out of scope for this programme.

**W1.2 · ~~Make the template path draw figures.~~ WITHDRAWN — the premise was
wrong.** The figures already draw. Measured by fill colour rather than by image
count, the chart pages carry brand-gold path fills and the text pages carry
none; of the twelve quantitative directives, eleven reach the page and one is
dropped by the renderer for having no series. Nothing here needs building. The
finding it was standing in front of is W1.3.

**W1.3 · A chart is a measurement, or it is not drawn as one.** ✅ **DONE**
Two rules, in `chartQuantity.pure.ts`, on the read path beside
`withholdRatedAbsenceCharts`. **A flag set is not a quantity** — withheld
whole, with nothing worded in its place, and only where the directive itself
confesses: every plotted value a flag AND either a unit that is not a unit
(`index`, `Zone code`, `Descriptor`) or a retrieval state on an axis
(`Checked`, `Not in layer`). A genuine count that happens to read 1 and 0 under
`unit=facilities` is drawn exactly as it is today. **A value cut out of a
sentence is not this item's value** — the label and the display are re-joined
into the phrase the model wrote and set as the table it always was, split at
its first number, so `| Healthcare | 10 within 5 km |`. The tell is exact: a
label ending in a connective is a sentence the parser cut, and it must also
still carry a number, so `3-bedroom houses` and `Minimum lot size 450 m²` are
untouched.
*Accepted:* 29 specs, every fixture verbatim from the delivered document.
Measured over its twelve quantitative directives — **withheld 6 · tabulated 2 ·
kept 4**, the four kept being the two price comparisons and the two growth
heatmaps, byte-identical.

**W1.4 · One chart standard — the contrast half is DONE (W4.2, W4.10); the
SATURATION half is measured and deliberately NOT implemented.**

§2's `< 10pt` band has **two** clauses — *"7:1 **and** never a chromatic accent
at full saturation"* — and only the first was implemented. Measuring the
second over the catalogue's hundred approved accents, resolved through
`brandResolve` at the micro roles:

```
TOP: sm-inverse 100%  ir-research-blue 98%  mf-amber-signal 93%
     sm-signal-orange 89%  sm-ultramarine-inverse 87%  sm-red-accent 85% …
HIST (saturation): 100+:1  90-99:2  80-89:7  70-79:15  60-69:12  50-59:15
                   40-49:11  30-39:11  20-29:9  10-19:11  0-9:6
```

**There is no natural break.** The spread is continuous from 0 to 100, so
unlike the eight-word emphasis ceiling — where the survivors split into two
populations with 80% at eight words or fewer and **not one at nine** — no
threshold can be derived from this evidence. Any number picked would be
invented, and it would reclassify approved designs.

And the decisive reading is §2's own: its stated remedy for small type is
*"Keep hue and saturation, clamp lightness into the 30–36% band"*, which is
exactly what `ensureContrast` does. So the saturation clause is guidance about
**choosing** an accent, not an instruction to desaturate a derived ink — and
desaturating would contradict the sentence two lines below it in the same
section.

Recorded rather than built: a validator here would be a rule invented to
enforce a threshold the design system does not state, against a method the
design system explicitly prescribes.

The other two acceptance criteria are met: `auditPaletteContrast` judges every
role against its declared floor at each size band (and W4.10 corrected the one
role whose declared floor was wrong), and a catalogue spec already asserts
every block's geometry is byte-identical across a family's ten palettes.

**W1.4 · Original statement, for the record.**
Apply the `dataviz` method through the colourway tokens, honouring REPORT_RULES
§2 (7:1 under 10pt; never a saturated chromatic accent at that size) and §3 (no
shadow, no gradient text, no glass — hierarchy by rule, weight, ground and
space).
*Accept:* a contrast validator over the rendered palette at each size band; a
golden render per family showing charts are byte-identical across a family's ten
colourways except for token values, which is the catalogue's existing guarantee
for geometry.

### W1.5 · Vocabulary, and what a drawing may say — **done**

Four more read off the same PDF, each closed where it is produced.

**A heading written twice around its own content is one heading.** Five
sub-headings printed twice — every risk in the register — each announced,
summed up, and announced again before its detail list.
`mergeAdjacentDuplicateHeadings` merges rather than choosing, because the two
bodies differ and keeping either alone deletes half the section.

**A database key is never the name of a publisher.** `vic_vpsr_suburb` in the
column headed *Where it is published*, beside a row that names Vicmap Planning
correctly. `PROVIDER_LABEL[p] ?? p` under a comment reading "never the enum";
the two archived suburb series were never added, and they are the readings
that answer for **Victoria and South Australia**. The map is total now, so the
compiler refuses the next one.

**`transactionVolume` is a field name.** The same defect one module over, on
the page that explains what each dimension rested on. Named, and the fallback
drops a label it cannot supply rather than printing the key.

**A paragraph is never a column.** The Monitoring & Review Plan's fifth column
runs to 190 characters against 16–65 for the other four, so in a fifth of the
measure the header set as `What to re-Where it isHow often itAs read for this`.
It is one block per dependency now.

**A heatmap's title fits the grid it belongs to.** `House price growth · Golden
Square vs Victoria (Valuer-Genera` — cut mid-word, because `w` is computed from
the labels and the title was never measured. Fitted, with the header band
growing rather than the type shrinking.

### W1.6 · Where a figure may come FROM — **done**

The page read reached pages 19–22 and stopped being about presentation.

**The document contradicts itself on crime.** Page 20 states a per-100,000
violent-crime rate compared against the Greater Bendigo benchmark, attributes
property-crime rates to **Crime Statistics Agency Victoria**, quotes a
"moderate" exposure reading and a count of **522 crimes**. Pages 24, 25 and 26
say four times that no recorded-crime register is integrated and that *no crime
counts, rates or safety scores are held for the Golden Square area in this
report*. The register section says the figures on page 20 do not exist.

**And on rainfall.** Pages 8 and 28 state **511.3 mm** from the SILO grid cell
with its 1991–2020 window named; page 19 states *"about 420–430 mm"* and names
no source. Twenty per cent apart, one property, one document.

Both have one cause. The crime and climate instructions are scoped to the
TABLE and the OUTPUT — *"do NOT print a crime table, a safety score, a rating
or an estimated rate"*, *"discuss only the measured figures above"* — and a
model that searches obeys both and still writes the paragraph, because neither
says where a figure may come **from**. `planningFactBlocks` closed this for
planning in one clause, which is why the planning section of the same document
is sound. The clause is now stated once in `registerAuthority.pure.ts` and
imported by both blocks, on the held branch as well as the absent one, because
page 20 mixed an unheld rate into a comparison rather than inventing a table.

**And the same document restates one fact forty-five times.** Counted over its
29 body pages: `GRZ` / *General Residential Zone* **45**, *Vicmap Planning*
**26**, *a planning certificate / Section 32* **24**, *no mapped control*
**15**, the layer's currency date **5**. The cause is structural and correct —
the planning block is pinned into every section call, because trimming it once
made the model invent controls — so `planningFactBlocks` gains rule 9, the one
rule there about PLACEMENT rather than content, scoped to the provenance
apparatus and never to the caveat.

Also closed on the same pages: `[Market Evidence table]` and
`[Zoning & Planning table, 6]` printed raw (the literal list missed both — the
first is a fifth heading, the second carries `, 6` inside the bracket), and a
tile reading `HEALTHCARE 10 FACILITIES` over nothing at all.

### Still open from the page-by-page read

**Page 5 — WITHDRAWN, it was already closed.** I read the delivered page as a
live defect: the *Risk Register* divider carries the verdict headline and the
graded line verbatim from the Executive Verdict two pages earlier and nothing
else, 558 characters stopping 600pt from the foot. The master pairs a risk
register with a `!(risks && risks[0] && risks[0].risk)` callout that renders
the absence, and `evalConditional` used to REJECT an expression naming an
unbound name — so on a record carrying no score object the author's positive
and negated conditionals were both false and the fallback was dead. That was
found and fixed on `main` on 19 Sep under a comment naming this exact page on
three delivered reports; the 21 Sep document predates the deploy. Verified by
executing the pair against `{}`, `{risks: []}`, `{risks: [{}]}` and a real
risk: the callout draws on all three absences and the register draws on the
one presence.

This is §5's lesson paid again — **a document is evidence about the build that
made it, not about the tree you are reading** — and it is why every other
finding in this programme was traced to the line that produces it before
anything was changed.

### W1.8 · The chart guard could read three forms in twelve — **partly done**

**A growth heatmap printed `0` for Victoria's ten-year CAGR.** I recorded this
as needing a producer change, on the reasoning that *"the `0` is in the
directive the model wrote, so nothing at presentation can tell it from a real
zero"*. **That was wrong, and a guard for exactly this already existed.**

`suppressUnevidencedMarketSeries` removes a market-worded directive carrying
any figure the market evidence table does not state — the guarantee behind
`CHART_IS_A_CLAIM`'s *"a series … may contain only values from the table
above"*. It re-parses the directive grammar privately: a `spark=` / `values=` /
`data=` / `series=` option, or a bare head that is entirely numeric. Measured
by execution over all twelve production forms, one real figure beside one the
table does not hold:

| form | judged |
| --- | --- |
| `bars` (`spark=`) | yes |
| `wheel` (numeric head) | yes |
| `margin` (`spark=`) | yes |
| `heatmap` (grid head) | **no** — now yes |
| `bars` (head pairs), `donut`, `tiles`, `waterfall` | no |
| `gauge`, `pictograph`, `quadrant`, `timeline` | no |

**Nine of twelve were unread**, including `bars` with head pairs — the first
example in the grammar's own documentation and the commonest form in the
corpus. The guard was written against the 18 Annabelle Crescent defect, which
used `spark=`, and it catches precisely that shape.

A grid head is `8.6,3.9 / 2.0,1.0`; the head-is-a-series test is
`/^[\s\d.,-]+$/`, the `/` fails it, so the head is taken for a **title** and no
value is read at all. That is closed, and `describingWords` now recognises a
grid head as a series for the same reason — one string read as a value list in
one place and a title in another is how two readings of one grammar come to
disagree.

**Four more are judged now — eight of twelve — and the block dissolved once
two questions were separated.** I had said the corpus in `report_content` was
needed before extending a destructive rule. The corpus says how OFTEN the rule
fires; it cannot say whether the rule is RIGHT. Correctness on the ambiguous
classes is testable here, and that is what the extension rests on.

The root cause was the private re-parse itself. `plottedMagnitudes` asks
`parseVizDirective` — the one implementation of the grammar every renderer
already uses — instead of reading the payload a second way, which is what let
nine of twelve forms go unread in the first place.

**`bars` (head pairs), `donut`, `tiles` and `waterfall`** join the four already
judged: their plotted values are magnitudes in the table's own units, the same
class as a grid. **`gauge`, `pictograph`, `quadrant` and `timeline` stay out,
and that is a KIND rather than a backlog** — a gauge's `max`, a pictograph's
`total` and a quadrant's axis are a POSITION on a declared scale, and a
timeline's digits live in label text. A scale is never judged either: a `max=`
is the axis, not a claim.

The false-positive classes that can be named are pinned as tests rather than
argued: a gauge rating, a pictograph total, a quadrant placement, a timeline
label carrying a number, a `max=` scale, a qualitative tile, a chart with no
market word, and a chart drawn honestly from the table. All are kept
byte-identical.

**And writing it re-committed a trap this repository has already paid for.**
The first tiles reader stripped non-numerics and tested `Number.isFinite` —
but stripping `"Moderate"` leaves `""`, and **`Number('') is 0`**, which is
finite. A qualitative tile therefore reported a magnitude of zero and a
market-worded tile grid was removed for a figure nobody plotted. That is the
same trap `urban-centre-register-ingest` records, where a feature with no point
parsed as `(0, 0)`. The digit test is the guard, and the spec is what caught
it.

The lesson is §5's again, from the other direction: **the absence of the shape
you expected is not the absence of the thing.** Twice in one sitting — the
amenity blocks that existed inline, and the chart guard that existed and could
not see.

**The document cites listing sites and third-party tools as evidence.** Page 21
attributes a suburb zoning breakdown to **Landchecker** and a "5-minute drive
from Bendigo CBD" to **Ray White Bendigo and Domain**; page 19 attributes flood
behaviour to an **SES Local Flood Guide** and "excellent air quality" to
unnamed "suburb-level environmental profiling". W1.6 closes crime and climate,
and then census, regional and macro — every prompt block that had no clause at
all.

**A correction to what that first pass claimed.** Market positioning was listed
as lacking the clause and it does not: `marketFactBlocks` already carries it in
both branches in its own voice, and `planningFactBlocks` states it as part of
the sentence giving its rules precedence over the prompt. Both are deliberately
left alone and a spec asserts it — rewriting a rule that works, to make it look
like its neighbours, is a change with no reader behind it. What page 21 cites
Landchecker and Ray White/Domain for is a suburb zoning breakdown and a drive
time: **locality** claims, not market figures, which is why the market block's
rule never reached them.

**Amenity and transport are what remain.** Closed in W1.7 below — and the
scoping sentence that stood here was wrong, which is worth keeping rather than
overwriting. It read: *"neither has a prompt-block module of its own — the
amenity counts and the single recorded stop reach the prompt through the
location enrichment rather than through a composed block with rules attached
… it needs a block, not a clause."* Both blocks existed, inline in
`propertyPrompt`, with rules attached to each. I had grepped for a `*Blocks`
module and concluded from its absence that there was no block, which is the
same mistake as judging a column against `types.ts`: **the absence of the shape
you expected is not the absence of the thing.** What was actually wrong was
worse than a missing block and invisible from the outside.

### W1.7 · Four of six field names were written by nothing — **done**

Read against what `location-intelligence-service` publishes rather than against
what the blocks asked for:

| the block read | published as | what fired |
| --- | --- | --- |
| `transport.stationDistance` | `transport.distanceToStation` | never |
| `transport.transportTypes` | *nothing publishes it* | never |
| `transport.commuteToCbd` | `commute.durationMinutes` + destination | never |
| `lifestyle.supermarkets` | *no supermarket lookup is taken* | never |
| `lifestyle.nearestSupermarket` | *the same* | never |
| `lifestyle.nearestShoppingCenter` | `lifestyle.nearestShopping` | rendered `—` |

`commuteToCbd` had **exactly one occurrence in the repository**: the line that
reads it. So the commute — measured, with a named destination and the
`ownCentre` flag that `A_PREMIUM_DOCUMENT.md` §20 exists for — has never
reached the prose on any report. `PLACES_CATEGORIES` holds six and no
supermarket lookup is among them, so that row was a labelled promise of a
figure the platform cannot produce — law 2, committed in the fix for law 2.

**And one is worse than a silent field.**
`projectTransportForLocationIntelligence` returned `nearestStation: 'N/A'`
where no stop was found, and the block guarded on `if (t.nearestStation)`.
`'N/A'` is truthy. So every property outside a loaded GTFS network — every
Victorian, Western Australian, South Australian, Tasmanian and ACT property,
which is most of this deployment — printed `Nearest public transport stop on
record: **N/A**`, and because `parts.length` was then 1 the block's own
fallback **suppressed** its prohibition on naming a station, stating a distance
or calling the area car-dependent. The prohibition was skipped in exactly the
case it was written for. `placesAvailability.pure.ts` established that rule and
corrected the sibling branch; this is the branch that actually runs.

That is the mechanism behind page 21 citing **Landchecker** and **Ray White
Bendigo and Domain**. The readings were measured, stored and stamped with their
own provenance; the blocks in front of them read almost none of it and named no
publisher at all, so a model asked to evidence a count supplied a source.

`amenityFactBlocks.pure.ts` composes both from the fields the record publishes,
under six rules: a count **names the register that produced it** from
`stages.amenitySources`; a publisher common to every row is **stated once below
the table** rather than as a column repeating one value; **no stop found is a
fact about the FEEDS**, in the register's own terms with the loaded networks
named; **a commute names where it was measured to** and says plainly when that
is not this property's own centre; **absent is never zero and never `'N/A'`**;
and both carry `webSearchIsNotARetrieval`.

Three things the gates caught, each worth recording:

- `oneDateFormatter.spec.ts` failed the first draft for carrying its own month
  table and its own ISO regex. Correct — that is the defect `AU_LOCALE` and
  `auDate.pure.ts` were each written to close, committed a third time.
  `stampDate` delegates to `formatIsoDate`.
- The first `TRANSPORT_VERDICT_SENTENCE` carried a `sourceUnavailable` key the
  projection never produces and had **no sentence for `stops_nearby`**, the
  ordinary case. An entry that can never fire and a case that has none are the
  same mistake read from two ends; the map is `Record<TransportVerdict, string>`
  and therefore total.
- `transportGtfs.spec.ts` held a test named *"reports no distance rather than
  zero when nothing was found"* which pinned `distanceToStation` to null and
  `nearestStation` to the sentinel **one line below**. The test asserted the
  violation of its own name.

`compassDocumentContract.spec.ts` asserted these absences by grepping the
prompt's source. They move to `amenityFactBlocks.spec.ts`, where they are
executed against the shape the service publishes — which is precisely why the
old inline blocks could carry four dead field names while that file passed.

### W2 · Structure and placement

**W2.1 · Section placement by declared order** — **done**
(`documentPlacement.pure.ts`, 11 specs). Composed blocks land at their registry
order; the document closes on its disclaimer.

**W2.2 · Un-merge `infrastructure` and `supplyPipeline` for the Compass** —
**done** (22 Sep 2026, `compassUnmergedSections.spec.ts`, 11 specs).
`Infrastructure and Growth Context` is ordinal 5 at 2 pages / 500 words,
directly after the location case; `Competitive Landscape and Supply Pipeline`
is ordinal 12 at 2 pages / 500 words, directly after Market Positioning. The
two carriers gave back what they had been writing for them (900→650 and
600→450), so the document goes from 8,410 words across 35 pages to 9,010
across 37 — inside the declared 30–38 band.

**The stated acceptance was satisfiable without the generator writing a
word**, and that is the finding worth keeping. All three criteria — 
`sectionsForTier('compass')`, the contents page, `documentPlacement` — are
statements about `sectionRegistry.pure.ts`. The generator does not read that
file: `generate-investment-report` builds its section list, its per-section
prompt and its `total_sections` from `compassSectionRegistry.ts`. The only
thing holding the two together was `sectionRegistry.spec.ts`'s *every Compass
section is a registry placement on the compass tier*, which asserts
`compassSections() ⊆ sectionsForTier('compass')` and says nothing about the
other direction. A one-file W2.2 would have turned every suite green, listed
two sections on the contents page, and authored neither. The converse pin is
the half that was missing; it is asserted on the SET and on the ORDER, because
two registries that agree on which sections exist and disagree on where they
go produce a document whose contents page is a different document.

Four things the move then found, each pre-existing:

- **`Supply & Development Pipeline` was claimed twice** — a sourceHeading of
  the Compass's DEMAND DRIVERS and an alias of `infrastructure` at the same
  time. `buildRoutingTable` upserts, so the last writer wins and the first
  claim disappears with nothing said. It belongs to `supplyPipeline`.
- **Four sections declared `sectionPriority: 'Protected'` and were missing
  from `PROTECTED_SECTION_IDS`**, which is the list `compassPostProcessor`
  actually reads — among them `compass.planningConstraints`, the largest
  section in the document and the one the owner's 17 Sep review named, whose
  eleven-row overlay register `capListsToTop5` was free to cut to five
  bullets. The set is DERIVED from the field now: *a rule written at both ends
  is how the two ends drift*.
- **`theCountThatDecidesCompletion.spec.ts` restated a number the product
  derives** (`compassSections().length < 15`, where 15 was the array's length
  when it was written) — in the file named for exactly that defect. It is a
  relation now.
- **The fork's *merges each one exactly where the Compass merges it*** was a
  stronger claim than its own rationale needed. The rule is that the Due
  Diligence document cannot carry a section NOTHING can fill, and a merge
  never declares a heading. The strategic tier keeps both merges, because its
  carriers are routed headings that NAME them — `Position Within the Locality
  & Infrastructure Context` and `Market Position, Competitive Landscape &
  Supply Pipeline` — and that is now what is asserted, which the equality
  never checked.

**W2.3 · ~~Rebuild page 5 and page 37.~~ ANSWERED ON MEASUREMENT — both
halves were closed by other work, and its acceptance pointed at an item that
was itself withdrawn.**

As written: *p5 either carries a real risk register or is removed and its
dashboard given the room; p37's five-column, one-row table is restructured.
Accept: no content page below a declared fill floor (see W2.4).*

Three things about that, all of them below in W2.4's own measurement rather
than asserted here. **The acceptance criterion cites W2.4, which is
withdrawn** — a floor that does not exist cannot be cleared, so the entry
could never have been closed on its own terms. **Page 5's 28% is the Risk
Register divider** whose withheld-register callout was fixed on `main` on
19 Sep. And the five-column table is page **36**, not 37, closed by the
Monitoring rewrite; pages 4, 37 and the cover are master-fixed and correctly
sparse, which the ink-extent instrument shows and the character-count one
could not.

So the pages named here were a SYMPTOM of content defects that are now fixed,
and rebuilding them would have been work aimed at an instrument's error. What
survives is W2.4's instrument — ink extent rather than character count — for
the next regeneration to be measured with.

**W2.4 · ~~A page-fill floor.~~ WITHDRAWN — there is no packing defect, and
the two measurements that said otherwise were both mine.**

The first fill probe counted CHARACTERS and reported 14 of 39 pages under
45%. That measures text, not ink: a page carrying a chart is not under-filled,
and the metric topped out near 59% on a full page, so the "floor" was a
property of the instrument. **It is §7's rule again — an instrument that can
fail the way its subject fails is not an instrument** — and it is the second
time in this programme that a probe counted the wrong thing.

The second was a grep. `PackOptions` has nine page-filling switches —
`keepWithNext`, `splitTables`, `splitAtBoundary`, `floatFigures`,
`absorbTail`, `balanceTail`, `splitParagraphs`, `splitLists`, `reserveLines` —
and searching for them outside `markdownPaging.pure.ts` returns nothing, which
reads exactly like the unmounted-component defect this repository has found
three times. **They are all passed**, inside `packNarrativeGeometry`, in the
file the search excluded, and `markdownBlockContent.ts` is the renderer's call
site. Every filling behaviour is on.

Measured properly — the vertical extent of every glyph AND every path
construction, banded at 6pt, over the content box — the body pages (6–35) sit
at **58–80% inked, reaching 69–89% of the box**, which is what typeset prose
looks like. Three body pages stop short:

| Page | Reaches | Why |
| --- | --- | --- |
| 16 | 69% | the `General Residential Zone (GRZ) 1` single bar, and a sidenote that floated past it |
| 25 | 64% | the `{{stat …` markup and the doubled `Crime & personal safety` heading |
| 36 | 69% | the five-column Monitoring table |

**All three are already closed by W1.1, W1.3, the duplicate-heading merge and
the Monitoring rewrite.** Page 5's 28% is the Risk Register divider whose
withheld-register callout was fixed on `main` on 19 Sep; pages 4, 37 and the
cover are master-fixed and correctly sparse.

So the under-filled pages were a SYMPTOM of the content defects, not an
independent packing failure, and a fill floor would have been a rule invented
to fix something that was not broken. What is worth keeping is the
instrument — ink extent rather than character count — for the next
regeneration.

### W3 · Evidence — national by construction

The rule: **every property in Australia gets a development reading; the grain is
the publisher's; the scorer prices the grain; coverage travels with the answer.**
This is `openDataSalesEvidence`'s existing rule — an LGA point scores 55, a
postcode 80, a suburb 100 — applied to development evidence.

**W3.1 · The national floor: ABS Building Approvals by LGA.** — **DONE, AND
THE REGISTER IS WALKING.** This heading read "the register itself awaits
approval" until 22 Sep 2026; approval was given, the table was applied, and
the register is loaded, corrected and deepening itself on an hourly schedule.

**The walk is confirmed by effect, not by configuration.** At 08:59 UTC the
register held `total=4934`, `periods = 2026-07..2026-07` — one month, which is
all the ABS publishes ahead of its own two-month arrears. At 09:20 the cron
fired and `function_logs` recorded the planner's choice before it acted:

```
[market-sales-ingest] approvals: ABS,BA_SA2,2.0.0 key=1+2.9.TOT.110+150+100...M
                      page=0 2026-04→2026-06 frontier=2026-07
```

— the window immediately BELOW `oldest`, which is the thing the old code never
did once: every run before this asked forward from today, upserted the same
three months and printed `pagesToCover` into a void. At 09:24 the read-back
answered `total=19736`, `periods = 2026-04..2026-07`: `oldest` moved by exactly
`APPROVALS_PAGE_MONTHS`, grains still correct (sa2 codes 9 digits, 2,458
distinct SA2s, no `lga` bucket), `dwelling_units` null=0 with zero and positive
both present.

**And the section it feeds is not an empty one**, measured by rendering the
block against the register as it actually stands rather than against a
fixture: 46 dwellings and $23,550,000 for the SA2 across Aug 2025 – Jul 2026,
stated as a **FLOOR** with "4 of the 12 months" named, and the year-on-year
change explicitly withheld because one of the two windows is short. That
render is also what found `$NaN` in the money column — see the commit *"A
supply figure that is not a figure never reaches the page"*.

Monthly, free, authoritative, **every local government area in Australia**;
dwelling counts and dollar value. One source, national coverage, no key.

Two corrections to this entry as it was written. **`registerWalk` /
`summariseDaRows` cannot consume it.** `DaSummary` is a
development-application shape — applications, statuses, application types, a
per-application dwelling count — and ABS Building Approvals is a monthly
aggregate by area. Pushing an aggregate through a register walk would file a
count as a set of applications, which is `absResDwell`'s *"a mean is filed as
a mean"* committed in the other direction. And **the dataflow identifier is
not knowable from this repository**: `absResDwell.pure.ts` hardcodes
`ABS,RES_DWELL_ST,1.0.0`, the version is part of the identifier, the ABS
reissues it, and neither `data.api.abs.gov.au` nor `www.abs.gov.au` answers
this development egress. An identifier typed from memory is the mistyped
Airtable column again — an absent flow and an empty flow fail the same way.

So `absBuildingApprovals.pure.ts` **discovers** it: it reads the ABS's own
dataflow catalogue, selects by name, prefers the finest grain published
(because the scorer prices the grain), and refuses — naming what it saw — on a
catalogue it cannot parse, a catalogue in which nothing matches, and a tie
inside the chosen grain. An operator override is checked against the catalogue
rather than trusted, so a typo cannot present as an outage. That is strictly
better than the constant it was modelled on, and it self-heals across a
version bump.

**What shipped, and why in this order.** The register needs a table, a
schedule and a first ingest — new infrastructure, which is held for separate
approval (the DDL is below). What shipped without any of that is the half
that protects the document: `approvalsFactBlocks.pure.ts`, pinned into
`generate-investment-report` beside the planning and infrastructure
registers, so every report now STATES that no approved-supply reading was
retrieved and is forbidden from describing the pipeline. That matters
independently of the register, because the statewide prompt carries
`**Supply Pipeline Risk:** [New housing supply vs demand balance]` — a
bracketed slot with nothing behind it, which is the exact shape that put
`450 m²`, `8.5 m` and `0.5:1` into a Queensland property's document under New
South Wales instrument names. `CLONE_PROVISIONING_GAPS.md`'s rule — a feature
the migrations have not reached degrades rather than failing — applied before
the gap exists rather than after.

Five rules carry the prose. **An approval is not a completion** (approved,
commenced and completed are three different things and the ABS counts the
first). **A total summed from part of a register is a FLOOR and says so** —
`DA_REGISTER_RECONCILIATION.md`'s rule, so a window states how many of its
twelve months carried a figure. **A change is computed only between two
COMPLETE windows**, because comparing a floor with a floor describes the gaps
and arrives looking like a measurement. **The grain is the publisher's and is
never renamed** — an LGA reading describes a council area, not this suburb.
And **an absence may not be rated**: not tight, not constrained, not limited,
and not strong either.

*Accept:* unchanged — a development reading for a property in each of the
eight jurisdictions, each naming its grain and period. **Not met**, and
cannot be until the register loads.

**What needs approval, exactly.** One table, one sync table, one `pg_cron`
job, and one stage in `market-sales-ingest`. It is additive and non-
destructive: nothing existing is altered or dropped.

```sql
-- The national supply register. Additive; drops and alters nothing.
create table if not exists public.market_building_approvals (
  area_kind      text        not null check (area_kind in ('sa2','lga','state','national')),
  area_code      text        not null,             -- the publisher's own code
  area           text        not null,             -- the publisher's own label
  area_token     text        not null,             -- salesAreaToken, as the sales register
  state          text            null check (state is null or state in
                   ('NSW','VIC','QLD','SA','WA','TAS','NT','ACT','AU')),
  period         text        not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  building_type  text        not null check (building_type in
                   ('house','other_residential','total_residential')),
  dwelling_units integer         null check (dwelling_units is null or dwelling_units >= 0),
  value_aud      numeric         null check (value_aud is null or value_aud >= 0),
  source         text        not null,
  source_url     text        not null,
  licence        text        not null,
  loaded_at      timestamptz not null default now(),
  primary key (area_kind, area_code, period, building_type)
);

create index if not exists market_building_approvals_token_idx
  on public.market_building_approvals (area_kind, area_token, period);

comment on table public.market_building_approvals is
  'ABS Building Approvals by area and month, loaded by market-sales-ingest '
  '(stage "approvals"). An approval is a council decision, not a building: '
  'approved dwellings are not commenced and commenced dwellings are not '
  'completed. A suppressed month is NULL, never zero.';

alter table public.market_building_approvals enable row level security;

-- One more job on the existing daily schedule, using the function that is
-- already deployed. 17:40 UTC keeps the loader's one-heavy-download-per-
-- invocation rule (546 WORKER_RESOURCE_LIMIT on five at once).
select cron.schedule(
  'market-sales-refresh-approvals',
  '40 17 * * *',
  $job$select public.market_sales_refresh('{"stage": "approvals"}'::jsonb);$job$
);
```

The edge-function stage is ~40 lines in `market-sales-ingest/index.ts`: fetch
the catalogue, `resolveBuildingApprovalsFlow`, fetch the data URL,
`parseAbsBuildingApprovals` (throws → nothing written), upsert, and write one
`market_sales_sync` row carrying the flow chosen, every candidate rejected,
the resolved column names, the area and period counts, and whether a
series-type column was there to filter on. It is held with the migration
because a stage that writes to a table which does not exist answers 500
rather than refusing.

**Asserted by effect, never by configuration**, as the retention purge and
the verification self-test are: the first run's `market_sales_sync` row is
the evidence, and the `probe` stage answers whether the ABS catalogue is
reachable from the production egress before anything is scheduled — which
this session cannot answer, because its egress reaches neither host.

### Answering "is it live" before approving anything

The probe is shipped and needs no approval, because it writes nothing, needs
no table and touches no schedule. It is a branch of `market-sales-ingest`'s
existing read-only `probe` stage:

```
POST /functions/v1/market-sales-ingest   { "stage": "probe" }
```

Its `answers.abs_building_approvals` reports, in one call from production:

| field | what it settles |
| --- | --- |
| `status`, `bytes`, `content_type` | whether the ABS answers this egress at all |
| `catalogued_flows` | how many flows the catalogue held |
| `flow`, `flow_name` | the identifier that would be read, **discovered not guessed** |
| `area_kind`, `geography_score` | the grain it works at, and what the scorer prices it at |
| `candidates` | every flow whose name matched, finest grain first — what was rejected and why it lost |
| `data_url` | the exact query the loader would issue |
| `refused` | the named refusal, where nothing was selected |
| `construction_survey` | **every** catalogue flow whose name matches a construction term, finest grain first |

A refusal is a finding rather than a crash: it states what the catalogue held
and why nothing in it was chosen. `{ "stage": "probe", "dataflow": "ABS,X,1.0.0" }`
tests an explicit identifier against the same checks.

### Scheduled infrastructure, and why the survey exists

Residential approvals are dwelling SUPPLY. They say nothing about a hospital,
a school, a distribution centre or a road — and those are exactly what
`INFRASTRUCTURE_COVERAGE_LIMITS` tells every reader this platform does not
reach: *"council capital works programmes and their budgets"* and *"state and
federal budget infrastructure programmes"*.

The ABS collection carries more than dwellings — non-residential approvals by
value and purpose, engineering construction, building activity — and some of
it is published at sub-state grain. **Which of it, at what grain, is not
knowable from this repository**, so `surveyConstructionFlows` reports rather
than decides: it lists every catalogue flow matching `building approvals`,
`non-residential`, `engineering construction`, `building activity` or
`infrastructure / public works / capital works`, with the grain each name
declares, finest first.

It is read by the `probe` stage alone and changes no selection.
`resolveBuildingApprovalsFlow` stays exactly as narrow as it was, because a
survey that widened the selection would be a loader choosing a series because
its name sounded relevant — and a spec asserts the selection still refuses an
ambiguous catalogue that the survey happily lists in full.

**Where the rest of it lives.** Three tiers sit above the ABS floor and none
is closed by it:

| tier | what it is | state |
| --- | --- | --- |
| Development-application registers | private applications, including large ones — the QLD walk that produced 1,410 dwellings and $1.18bn | **built for QLD**; W3.4 extends it per jurisdiction |
| State major-project registers | NSW Planning Portal's major projects, VIC's Big Build, and the equivalents | not built |
| Council capital works programmes | each council's own scheduled works, in its annual budget | **not built, and the hardest** — roughly 537 councils, each publishing a PDF, no common schema and no API. A per-council scraper is unmaintainable and a model reading budget PDFs is exactly what "a web search is not a retrieval" forbids. This one needs a decision about SOURCE before any code. |

**Why this matters more than it looks.** Every test behind
`absBuildingApprovals.pure.ts` runs on synthetic SDMX-CSV written to the
published standard's shape, because neither `data.api.abs.gov.au` nor
`www.abs.gov.au` answers a development egress. The reader is therefore
verified against the FORMAT and not against the ABS's own bytes, and this
probe is the only thing that closes that gap. It is also why the dataflow is
discovered rather than hardcoded: an identifier nobody here could verify is
the mistyped Airtable column again, and an absent flow fails exactly like an
empty one.

**W3.2 · National named projects: Infrastructure Australia Priority List.**
Nationally significant projects carrying the publisher's own status word — an
approval never read as funding, funding never as a start on site.
*Accept:* page 22's sentence is replaced by named, dated, sourced entries, or by
a coverage statement that names the register asked.

> **Closed 22 Sep 2026 on the second branch, by measurement.**
> `nationalPipeline.pure.ts` asks the Commonwealth's own open data catalogue
> and holds no identifier anybody typed. Measured from CI: Infrastructure
> Australia IS a publisher on data.gov.au and holds **50 packages, walked
> complete, of which 0 are the Priority List** — all fifty are Audit 2019 and
> Outer Urban PT accessibility layers, which carry no project and no status
> word. So the coverage statement is the honest branch, and it is now a
> measurement rather than a literal.
> `national-pipeline-liveness.ts` runs on every build as the instrument that
> flips the branch the day that changes. No per-report call is made: a live
> lookup would spend a round trip to learn a fact that changes on the scale of
> months. Full record: `NATIONAL_PIPELINE_EVIDENCE.md`.
>
> The asking took three attempts, and each failure was the same class one
> endpoint further along — a relevance query read as a filter (53 packages, 0
> survivors, reported as an absence), then `all_fields=true&limit=1000`
> answered with CKAN's default 25 and a page read as a list, inside the commit
> that fixed the first. The enumeration is corroborated from two endpoints
> that fail differently, and an absence needs both to answer and to agree.
> That corroboration changed the ANSWER, not just the method:
> `publisher_absent` and `not_in_catalogue` send a person to different
> remedies, so the truncation had produced the wrong one.

**W3.3 · National forward demand: ABS population projections by SA2.**
Replaces "no forward projection" everywhere rather than in one state.

> **The premise is wrong, measured 22 Sep 2026 — and the requirement is
> met anyway.** Four ABS projection flows, each carrying one `REGION`
> dimension of 23 codes: **8 states, 1 national, 14 unplaced, ZERO SA2**,
> including the flow titled *"Population Projections by Region"*. There is no
> ABS projection at SA2, so the national floor can only be a fact about a
> region the property sits IN; forward demand at its own area is a
> per-jurisdiction register and belongs to W3.4.
>
> What "everywhere" required is delivered without it.
> `FORWARD_DEMAND_PUBLISHERS` names the publishing body and product for all
> eight jurisdictions (`ingested: false`, truthfully) and one composed
> sentence replaces "no forward projection" for a property anywhere, naming a
> publisher a reader can reach. The Bureau's assumption set also turned out
> to be a **cross-product** — no series dimension, and instead
> `FERTILITY × MORTALITY × NOM × NIM` = 72 combinations — so a reading names
> every assumption it rests on and there is none to default to.
>
> The most consequential piece needed no register: the prompt block already
> FORBADE the model to state a population projection while the section
> validator REQUIRES it to write about population, and a prohibition with no
> permitted form is one a model routes around. Full record:
> `FORWARD_DEMAND_EVIDENCE.md`.

**W3.4 · Per-jurisdiction refinement behind a declared order.**
`DEVELOPMENT_PROVIDERS` / `PLANNING_PROVIDERS`, mirroring `AMENITY_PROVIDERS`
and `GEOCODER_PROVIDERS`. Extend the existing NSW/VIC/QLD/TAS constraint layers
to **SA, WA, NT and ACT**, and add each jurisdiction's amendments and
major-project registers as refinements *above* the floor — never as the only
answer.

> **Closed 22 Sep 2026** —
> [`JURISDICTION_PLANNING_COVERAGE.md`](./JURISDICTION_PLANNING_COVERAGE.md).
> Two halves, and the second one needed no new register at all.
>
> **The orders mirror `AMENITY_PROVIDERS`' shape and deliberately not its
> semantics.** Those chains are first-that-answers: a second provider is
> consulted because the first could not answer, and its answer REPLACES what
> the first would have given. A state overlay layer and a council amendment
> register are not two attempts at one answer — they are different facts
> about the same lot, and a draft amendment does not supersede the control in
> force. So these are **floor plus refinements**, with the floor PREPENDED
> wherever configuration omits it, because `PLANNING_PROVIDERS=amendment_register`
> would otherwise print a draft control as the control in force. The operator
> override is deliberately not a provider: a variable able to drop it would
> silently overrule a person who had recorded a correction. And the order is a
> configuration while **what a report may state turns on what ANSWERED**, so
> the answer publishes both and `refinementsThatAnswered` returns nothing
> where the floor did not.
>
> **The amendment was being read and thrown away.** `parseNswInstrument`
> reads the LEP's amendment number and commencement date off layer 8 of the
> *same* Identify the height and the minimum lot size come from, and handed
> both to `console.log` — while `parseNswZoning` publishes `EPI_NAME` and
> carries no amendment at all. So the register's Instrument column read *"The
> Hills Local Environmental Plan 2019"* over a record that knew it was
> Amendment 12, which is the first question a town planner asks. It is the
> `instrument_currency` provider now: a fact about the DOCUMENT, stating no
> control and admitting no use, with an absent amendment omitted rather than
> worded, drawn only beside a register that returned something.
>
> **Four premises were asked of the publishers and four came back wrong.**
> `SA_NT_NOTE` — *"every candidate host refused this platform's scripted
> egress"* — was measured on the DEVELOPMENT egress, the one that 403s
> CONNECT for `data.gov.au` and every ABS host. South Australia's state
> spatial service answers HTTP 200 with **131 services across 30 folders, two
> named `PlanSA` and `ePlanning`**. It is two notes now, and the old constant
> is DELETED rather than aliased, because an alias would have served SA's
> sentence to the NT. A **bot-protection challenge is not a refusal**: NTLIS
> answered 403 with Cloudflare's interstitial, and read as `refused` the note
> sent an operator to write to the Territory about a decision nobody there
> made — `challenged` is recognised by the PAGE and never the digit. **A
> catalogue outranks an unstated licence**: the ACT's verified organisation
> lists 391 services while its Territory Plan service answers a
> `copyrightText` of `"TP"`, so the reading said *"nothing from it is
> republished here"* about the jurisdiction whose zone this product publishes
> on every ACT report. And **a directory listing folders and no services has
> not answered** — WA's root lists five folders and zero services, and the
> note read *"lists 0 services"*, a sentence about our walk wearing the shape
> of a finding about Landgate.
>
> **Stage 2 is the mirror and the half that matters more.** Five
> jurisdictions' layers are already republished into commercial client PDFs
> under a licence typed into a source file, and **none had ever been read
> from the publisher**. A wrong restriction costs a report a row; a wrong
> permission puts somebody else's data in a document that has been emailed.
> The verdict is three-valued and `silent` is load-bearing — nothing rewrites
> a constant, because a three-character `copyrightText` is silence about
> terms rather than a denial of them. **All five came back `silent` and none
> contradicted** (NSW says nothing at all; Queensland says *"this is an open
> data map service"*, which describes a service rather than granting terms;
> Tasmania names the statute the mapping was made under; the ACT says `TP`).
> So nothing is wrong and nothing is fixed by editing a constant — but five
> silences together say that every one of those claims rests on something
> this repository does not record, and the remedy is a line beside each
> constant naming where the grant comes from. Deliberately not a build
> failure: a job that went red over somebody else's `copyrightText` is a job
> people learn to ignore.
>
> **Three of the four stage-1 readings changed between the first run and the
> second, on the same day** — WA from *"lists 0 services"* to a walked
> catalogue, NT from `refused_us` to `challenged`, ACT from
> `licence_unverified` to a catalogue of 391 — which is why the probe was run
> twice rather than shipped on its first answer. Two of those three are the
> difference between a sentence about a publisher and a sentence about us.
>
> **What is not claimed:** no SA/WA/NT/ACT overlay layer is read (reachable
> is not read, and `OVERLAY_COVERAGE` still says `not_read` for all four);
> `WA_LICENCE_NOTE` is unchanged and still unverified, because WA's root
> answered folders-only and softening a restriction on no evidence is the one
> direction that could breach a licence; `amendment_register` is integrated
> nowhere and says so rather than being omitted.

**W3.5 · Close the Demand scoring gap.**
Sales counts for ACT, NT, TAS and WA, so Demand can score nationally rather than
in four states. Today `scoreTransactionVolume` is the only primary demand
measure this deployment is entitled to, and it needs four counted periods.

> **Step one closed 22 Sep 2026** —
> [`SALES_VOLUME_COVERAGE.md`](./SALES_VOLUME_COVERAGE.md). Loading a series
> is a register WRITE and that boundary is not crossed without asking;
> asking the publishers is not, so the read-only discovery went first and it
> answered the question well enough that **there is nothing to ask for yet**.
>
> Measured from CI, and corroborated across each jurisdiction's own catalogue
> and the Commonwealth catalogue: **Western Australia's catalogue holds 2,911
> datasets, 434 match "property sales" and 2,883 match "land sales" — and not
> one of the 203 matched and attributed carries a number of sales.** The
> Northern Territory's index holds 1,075 and matched none of five phrasings;
> the **ACT's holds 378, read through Socrata**, and matched none. Only
> Tasmania is unresolved, and it is OURS — `data.tas.gov.au` does not
> resolve.
>
> **Three of the four are settled, and the answer is that no sub-state count
> of residential sales is published.** So W3.5's original shape — load counts
> for four jurisdictions — is answered for three of them by *there is nothing
> to load*, and blocked for the fourth by our own host rather than by an
> approval. **That is a better outcome than asking for a table to put nothing
> in.**
>
> The ACT reached that answer only because its CKAN 404 was **kept and
> printed** rather than swapped for another guess: the body
> (`{"code":"not_found"}` — a JSON API that does not speak CKAN) is what
> bought the Socrata reader, which projects onto the same `VolumeDataset`
> shape so one judgement serves both dialects. And **corroboration gates an
> absence, not a find** — the first cut gated both and discarded Tasmania's
> one attributed dataset because a second index had not answered.
>
> Three rules were each paid for again, and the first one caught its own
> author. **A harvest hit is not a statement about a jurisdiction**: the
> probe's first run read `countable` for the NT over "datasets examined 0"
> and named a VICTORIAN department, because the harvest's datasets were
> merged in and ranked — and the log exposed it only because it prints both
> numbers, so the output contradicted itself on one screen.
> **`200 · 0 declared` is not an answer** until the catalogue is asked its
> own size. And **an absence carries the size of the question that found
> it** — the sentence read "0 datasets examined" over a five-query search of
> a populated index.
>
> What reaches a client: `measuredVolumeNote` is the demand dimension's
> `reasonOverride` for those four jurisdictions and `null` for the other
> five, so a Western Australian report says no count is published, a
> Tasmanian one says this could not be established, and a New South Wales one
> says exactly what it said before. The demand remedy's jurisdiction clause
> was also **wrong about two states** and is composed from
> `VOLUME_COUNT_SOURCE` now, which a spec checks against the loaders.

**W3.6 · Coverage travels, with a jurisdiction dimension.**
A Western Australian property must read *"no state planning register is loaded
for Western Australia"*, never *"no overlays"*. The five absences already
exist — `not_served`, `not_integrated`, `licence_restricted`, `none_at_point`,
`unavailable` — and must be stated on every reading, full or empty.
*Accept:* a test asserting that for each of the eight jurisdictions the planning
and development readings carry an explicit coverage statement, and that no
absence is rated.

> **Closed 22 Sep 2026, and it found one.** The five absences and the
> per-jurisdiction sentences already existed; what did not exist was anything
> that could tell you a jurisdiction had been FORGOTTEN.
> `NO_STATE_LAYER_NOTE` is a `Partial` record — correctly, since a
> jurisdiction read in full needs no note — and a `Partial` record is exactly
> the shape that lets one go missing. The **Australian Capital Territory**
> did: its zone IS read, so it never looked unserved, while its overlay
> registers have no branch at all, so the page fell through to the generic
> sentence naming neither the territory nor the remedy.
>
> `OVERLAY_COVERAGE` declares all eight and the invariant is asserted both
> ways. It also DECIDES something — `overlayCoverage` rides `PlanningFacts` so
> the page separates a register never integrated (permanent, with a remedy)
> from one that is read and answered nothing (*unchecked rather than clear*,
> worth a retry), which the note map alone could not draw.
> `jurisdictionCoverage.spec.ts` drives the real composer over all eight.

### W4 · Typography, brand and copy hygiene

**W4.1 · Running head fitting — NOT A DEFECT, and the gate is honest now.**

Measured rather than assumed, which is the only reason I can say it. The
running head is two text blocks — `documentLabel` in 66% of the measure and
the part marker in the other 34% — with the rule struck beneath at a
**two-line** reserve. Neither is fitted or truncated, so a third line would
print through the rule.

The longest things that can land there, collected across all ten formats:

| slot | longest |
| --- | --- |
| part marker | **31** characters (`How each property is performing`) |
| document label, nine formats | **32** characters (`Commercial & Industrial Capacity`) |
| document label, the Compass | a BINDING — `{{report.documentTitle}} · {{property.address}}` |

That binding is the one that matters: `documentTitle` runs to 20 characters
(`Due Diligence Report`) and `property_address` to **84** across the 1,187
stored rows, so a client's running head can reach **~107 characters**.

**The fixture was measuring 63.** `SAMPLE_REPORT_DATA`'s address is 42
characters, so the geometric gate had never laid out a head longer than
`Investment Compass · 14 Marlborough Street, Leichhardt NSW 2040`. That is
`WHAT_THE_PAGE_ACTUALLY_DRAWS.md` §2 again: *a fixture shorter than the
product turns a real measurement into a statement about the fixture.*

Re-run with the worst case substituted — **all 710 renders clean**. So the
running head fits, on every family, at the longest address in the corpus. This
is a **closed blind spot rather than a repaired document**, and the honest
fixture stays, so the next change to the head, the type scale or the measure
is judged against the real thing.

Two rules follow. The substitution lives in the HARNESS, not in
`SAMPLE_REPORT_DATA` — that is the BINDING fixture the catalogue specs assert
rendered output against, and its job is to resolve every bound path, while the
geometric measure needs the worst case and composes one (the same split the
body-size composition above already makes). And `LONGEST_ADDRESS` is named
**once**: it was a bare `const … = 84` inside `cover()` AND again in
`investmentPropertyRows.spec.ts` — two copies of one measurement, which is how
the two disagree the next time the corpus is re-measured. The harness asserts
its sample address is exactly that long, which is what caught the first draft
of that string at 82.

**W4.2 · Contrast audit under REPORT_RULES §2.** Eyebrows, running heads and
page numbers render at 6–6.5pt in this document, where the floor is 7:1 and no
saturated accent. `--brand` on ivory is ≈2.3:1. Derive one darkened gold; the
codebase already contains eight because this was solved ad hoc.

**W4.3 · Page 4** — drop the "Noted" placeholder term; draw all opportunities,
not index 0.

**W4.4 · Page 3 — WITHDRAWN. One strength on the page is the RECORD, not a
binding.** I wrote it up as *"one strength on a half-empty page"*, implying the
binding should draw more. It should not, and the master already says so with a
measurement: across the 985 scored reports `investment_score.strengths` holds
at least one on **745** and at least two on **47**; `weaknesses` one on 874 and
two on **15**. A second row *"printed a marker with nothing beside it on 95%
and 98% of reports respectively"*, which is why `strengthsWatch` draws one
each. There is no second strength to draw. Whether the page should carry
something else is a design question rather than a defect — and §9's rule
applies: a fill floor invented for a page that is correctly sparse is a rule
with no reader behind it.

### W4.3 · Two placeholder words, and seed **v19** — **done**

`Noted` appeared in two slots that name things, on the 50 Investment Compass
masters, and a sweep of every literal `term:`, `rating:`, `confidence:`,
`value:` and `status:` across all eleven format files found no other — the
rest are real labels (`Location`, `Yield`, `Risk`, `Suburb`, `Value and
equity`, `Cash contributed`). These two were the class.

**The risk register's rating.** The record holds a bare risk STRING and no
severity, and the exposure vocabulary is `Low | Moderate | High | Not
assessed`. `Noted` was a fifth word in a four-word vocabulary, in the column
that states the EXPOSURE, and absent from `RATING_PALETTE` too. It reads
`Not assessed` now. `confidence: 'Indicative'` is deliberately KEPT — it is in
`CONFIDENCE_PALETTE` and is an honest qualifier for an unverified one-liner.

**The Opportunities list's term.** Every sibling definition list on that page
carries a real term naming what the row is about; the record gives an
opportunity as one unlabelled string, so any term there is invented. The
heading already said "Opportunities", so the 160pt term column carried a word
that repeated nothing. It is a `callout` now — the container that page already
uses for one unqualified statement.

**The release is a v19, and that was checked rather than assumed.** The
generator's own header says to check whether the previous release is applied
before editing: `20261209000000` and `20261209010000` are both in the applied
list (1,012 migrations, latest `20261211000000`), so this is a new release
rather than an edit. Editing an applied v18 in place is precisely the failure
the `@effect` probe exists to catch.

**Two masters GAIN a block, and the first draft of the header denied it.** I
wrote "no page gains or loses one", then measured: parsed both seed files,
compared all 2,172 schemas, and found `"type":"definition-list"` **−32**
against `"type":"callout"` **+34**. **Analyst Folio** and **Monograph** gain
one each (333→334, 320→321) while keeping all seven of their definition
lists. They never carried the Opportunities block — it is OPTIONAL, and
`ifItFits` keeps one only while `y + height + SLACK <= contentBottom`. The
definition list declared ~75pt, the callout declares 72, and on those two
variants three points are the difference. A block they had been dropping
silently now fits. `SLACK` is untouched at 36.

**What was verified, and how:**

| claim | evidence |
| --- | --- |
| only Compass masters move | 34 schemas changed, all Compass; changed lines are exactly 50 distinct family names plus 2 header lines |
| the other 493 are byte-identical | parsed and compared all 2,172 schemas in both files |
| `Noted` is gone | `"rating":"Noted"` 50→0, `"rating":"Not assessed"` 0→50, `"term":"Noted"` 32→0 |
| the geometry holds | `templates:compass:qa` — *"no block overflows its page, and none prints over another, in any of the 710 renders"* |
| the refresh is the same mechanism | the v19 refresh diffs **identical** to v18's once release identifiers are normalised |

**And a contract test was renegotiated, correctly.**
`investmentPropertyRows.spec.ts` counted `>Not assessed</td>` over the WHOLE
document and required zero — a document-wide selector for a scorecard-shaped
rule. The rule it protects is that a withheld scorecard dimension draws **no
row**, which its own third assertion already states
(`not.toMatch(/>Growth<\/td>|>Demand<\/td>/)`); a row that is not drawn has no
cell to hold a placeholder. The risk register is the opposite case — the row
cannot be omitted, because the risk is real — so it now asserts that every
"Not assessed" sits in the exposure column. Verified by probe: both
occurrences are the risk rating cell, muted `#ADA18E`, with an empty bar cell
beside them.

### W4.11 · An absence may not be rated — on a COLOUR either — **done**

The rule `PLANNING_CONTROLS_IN_THE_REPORT.md` §9 closed as a statement, and
`withholdRatedAbsenceCharts` closed for a chart, committed a third time in the
one place neither could look: the colour of a word.

`severityFromRating` returns `null` for a rating it does not recognise —
deliberately, under its own comment, *"so the bar is omitted rather than drawn
at a length that states a severity nobody assessed."* The colour derived from
that severity is used **twice**: for the bar, and for the rating WORD's own
text colour in the row's third cell. `severityColour(null, …)` returned
**`caution`**.

So the bar was correctly withheld and the word was printed in the caution
colour anyway — **`NOT ASSESSED` set in the same amber as `MODERATE`**, and
`Noted`, which is what the Compass master passes, in the same amber again. One
function guarded the absence and the next one below it undid the guard.

Two things make it certain rather than arguable. **The chip display already had
it right** — `ratingChipHtml` falls back to `Neutral` for an unknown rating —
so the two displays of one register disagreed, which is this programme's
recurring tell. And the fix needs no new colour: `mutedColor` was already
resolved eight lines above and simply not passed.

It is a renderer change, so it reaches every stored report on its next render
and needs no seed. The spec renders the bars display at each of
`RISK_EXPOSURE_LEVELS` and asserts `Not assessed` is the only level that scores
nothing, that it prints muted, that it still prints the WORD (an absence is a
reading), and that every other level keeps its bar. Its colours are the real
`resolveReportPalette({})` rather than four literals.

### Verified as INK, not only as a schema

Everything above this line was verified in the source, the seed and the
geometry gate. The rendered document was then read, and three things confirmed
on the page rather than inferred from it:

**The risk register now says the platform's own word.** From the PDF:

```
RISK                RATING          CONFIDENCE    WHY IT MATTERS
Interest rate       Not assessed    Indicative    High LVR (80%) increases ...
sensitivity
```

**The running head fits at the corpus maximum, using exactly its reserve.**

```
Investment Compass · Apartment 1204A, 'Waterline    Residences',    Why This Location Matters
145-149 Marine Parade, Kingscliff, NSW 2487
```

Two lines against a two-line reserve, nothing clipped, the whole 84-character
address present. The confirming run at that exact length: *"no block overflows
its page, and none prints over another, in any of the 710 renders."* Worth
recording that the reserve is **exactly consumed** at the maximum — there is no
headroom, so a longer address or a wider document label would be the first
thing to overflow it.

**And the Opportunities callout had never been rendered by anything.** The
geometry gate could not see it: its PDF is written once per family reference
and overwritten per tier, so the artefact on disk is whichever tier rendered
LAST, and that tier's page set excludes the page this block sits on. So a
block that CHANGED TYPE in v19 was verified in the seed (34 schemas carry
`"title":"Opportunity"`, 0 carry `"term":"Noted"`) and in the geometry, and
not once as ink. `opportunityCallout.spec.ts` closes that: it renders every
Compass master against a record that holds an opportunity and asserts the text
appears, against one that holds none and asserts nothing is drawn — the 98%
case, since `opportunities` is empty on all but **19 of the 985 scored
reports** — and that no master anywhere reintroduces `Noted` or any other word
outside the four-level exposure vocabulary.

### W4.10 · The field accent was judged at the wrong size — **done**

**And the `#D5A220` residual was wrong in the opposite direction.** It was
recorded as *"a raw hex at 8pt, from a master binding rather than the
palette"*. It is neither raw nor a defect: it is exactly
`ensureContrast('#AD831A', field, 7)` — the colourway path's own correctly
corrected value, at **7.00:1**. Chasing it found the real fault next door.

`accentOnField` is derived in **three** places, and the odd one out is the one
serving a tenant's own brand colour:

| path | floor |
| --- | --- |
| `templateColourways.pure.ts` — the 500 seeded masters | `PRINT_SMALL_TYPE_CONTRAST` = 7 |
| `designSystem.ts` — the 43 voice templates | `PRINT_SMALL_TYPE_CONTRAST` = 7 |
| `brandResolve.pure.ts` — a tenant brand hex, and every route that resolves a palette rather than reading a stored one | `CONTRAST_FLOOR.display` = **4.5** |

`roles.pure.ts` declared `display` for it too — **directly under a docstring
reading "the cover eyebrow and rule"**. §2 puts an eyebrow in the `< 10pt`
band at 7:1 and names this exact case: *"It fails at the 8.5pt eyebrow that is
the brand's own signature."* `.eyebrow` is set at `type.caption`, which is
**8.5pt**. The role's own comment described the case that made its floor
wrong — and it was the only FIELD role out of step, since `onFieldInk` is
`body` and `mutedInk` and `accentOnPaper` are `micro`.

Measured over the catalogue's hundred approved accents resolved through
`brandResolve`: **89 of 100 sat between 4.5 and 4.7:1** on the field, while the
identical element on paper sits at 7.83 through `accentOnPaper`. One element,
one size, two floors.

Three things bound it. **The 500 masters never changed** — they store a value
already derived at 7, which is why the delivered document's own eyebrow was
fine and why this reached no seeded report. **The default is byte-identical**:
`PRINT_BRAND.onField` is `#D9A520` at 7.26:1, so it already cleared the
stricter floor and passes through uncorrected, asserted as the pass-through
rather than as a literal. And **no accent changes hue** — `ensureContrast`
walks lightness only, asserted over all 100 at a stated 2.5° tolerance rather
than promised.

**W4.5 · Cover** — the verdict block at 11pt against a 41pt address.

> **Closed 22 Sep 2026, and the defect is not the one the statement names.**
>
> The 11pt is the cover's **facts strip value**, and it was drawn as
> `c.density === 'spacious' ? 14 : 11` — a hand-written two-way branch, and
> **the only element on the cover not routed through `scaleFor`**. Every
> sibling on that page (the title, the eyebrow, the standfirst, the locations
> line, even the facts LABEL) takes the family's own density factor from
> `DENSITY_FACTORS`. So the block carried a SECOND density behaviour, and the
> two disagreed.
>
> Measured over the 50 master/variant combinations the catalogue declares:
>
> | density | variants | drawn | the display factor gives |
> | --- | ---: | ---: | ---: |
> | compact | **14** | 11pt | **9pt** |
> | spacious | **8** | 14pt | **13pt** |
> | balanced | 28 | 11pt | 11pt — agree |
>
> **22 of 50 drew a size that disagreed with their own density.** The compact
> half is what showed on paper: every other element on a compact cover
> shrinks — the title by 18%, the standfirst by 18%, the KPI value by 18% —
> and the facts did not, so they *grew* against their surroundings. At its
> worst, Institutional Research's `Exhibit Dense` and `Coverage Note` drew an
> 11pt facts value against an **11.5pt** cover title: **96%**, which is no
> hierarchy at all. The statement's own case — Private Banking, 11pt against
> 41pt — is 27%, which is an ordinary title-page hierarchy and was never the
> problem.
>
> **The 21%-to-79% spread across the ten families is deliberately NOT
> "fixed".** One literal serving display sizes that span 3.7× produces that
> spread, and making it per-family would mean inventing ten numbers: the
> approved catalogue source carries **no point sizes at all**, only preset
> names (`typography_preset`, `spacing_scale`, `density`). That is W1.4's
> rule — *any number picked would be invented, and it would reclassify
> approved designs*. `BASE_SCALES` is each family's *measured* scale and this
> slot has no measurement, so `COVER_FACT_BASE` is named, uniform, and
> documented as not being one. `MeasuredTypeScale` is `Omit<TypeScale,
> 'coverFact'>` so the constant cannot be given the shape of a per-family
> reading.
>
> Routing it through `scaleFor` reproduces `balanced` exactly, so **28 of the
> 50 are byte-identical** and only the 22 that disagreed with themselves move.
> `coverFactScale.spec.ts` asserts the movement as a RATIO against the
> family's own title rather than against a typed number, because a typed
> number would be a second statement of the factor — the two-ends-drift fault
> the spec exists to close.

**W4.6 · Debris** — the four empty bullets are **done**; the stray "1" is
**unattributed and deliberately not fixed**.

A list marker is drawn from the list STYLE rather than from the item's
content, so an item holding nothing still prints its dot and still takes its
line — which reads as a list whose entries failed to load. Driven through the
real read path, every one survived to the end: `stripPlaceholderRows` judges
table rows, `stripEmptyStatCards` judges stat cards, `dropEmptySections` judges
headings, and an item inside a list is none of those. `stripEmptyListItems`
sits directly above `dropEmptySections`, so a section it empties is collected
by the rule that already exists for that.

It is not the prose scrub §8 forbids for a stronger reason than the footnote
rule could give: **there is no prose** — no word, no figure, no claim, no
source — so there is nothing for it to change. Three bounds: an empty parent
with indented children is KEPT (removing it would strand them), a task list has
content after its marker, and code is a quotation — the partition is
`printableGlyphs.pure.ts`'s, imported rather than re-implemented.

**The stray "1" I could not attribute.** The obvious candidate was residue from
a withheld chart, since page 16's `{{bars: General Residential Zone (GRZ) 1
…}}` is one of the flag charts W1.3 withholds. Executed against the real read
path, it is not: both flag bars are withheld whole with no residue at all, and
the `{{margin:}}` beside them loses its `spark=` and keeps its note. So the
digit comes from somewhere in the model's prose that I cannot name, and a rule
for a lone digit would be invented rather than derived — which is what the
footnote work took two attempts to learn. Recorded, not guessed at.

**W4.7 · No database vocabulary in a client document.** ✅ **DONE**, and the
distinction it turns on is the whole rule.

Three instances of one defect on that document: `osm_amenity_register` set in
code backticks mid-paragraph on page 34, `vic_vpsr_suburb` in the column headed
*Where it is published* on page 36, and `transactionVolume` where a measure's
name belongs. `transportSourceName` and `providerName` name each in the
reader's words, and anything shaped like an identifier that this build has no
name for is replaced rather than printed — `publisherNames.spec.ts` reads the
`EvidenceProvider` union out of the type itself rather than keeping a second
copy.

**`plan_zone` and `plan_overlay` are deliberately untouched.** They are Vicmap
Planning's own published layer names, and the register table cites them
correctly as "Vicmap Planning — plan_zone (opendata.maps.vic.gov.au WFS)". An
identifier the PUBLISHER uses is a name; an identifier WE invented is debris.
That is why this could not be a blanket regex over underscore-cased tokens, and
why the geometry gate's own debris scan carries the same allow-list.

**W4.8 · Glyph coverage.** ✅ **DONE** — and the premise is measured rather
than inferred from the PDF. `fontTools` over all nine faces
`weasyprint-service/fonts/` ships, 21 Sep 2026:

| code point | Cinzel (2) | Playfair (4) | IBM Plex Mono (3) |
| --- | --- | --- | --- |
| `U+2011` non-breaking hyphen | absent | absent | absent |
| `U+2010` hyphen | absent | **present** | absent |
| `U+2013` en dash | present | present | present |
| `U+2014` em dash | present | present | present |
| `U+002D` hyphen-minus | present | present | present |

**Nine of nine lack `U+2011`; five of nine lack `U+2010`.** So a non-breaking
hyphen anywhere in a heading, a display line or a figure run is drawn by
whatever fontconfig reaches for — one hyphen in a different typeface from the
words either side of it. The body face is Debian's `fonts-inter` rather than
this repository's, and does not need measuring: the three families above set
every heading, every display line and every figure in the document.

`printableGlyphs.pure.ts` sets five dashes as ones the faces hold, LAST in
`presentStoredMarkdown` because it is the only pass there that works on
characters — running it earlier would mean every other pass read a document
one character different from the one the generator wrote.

**It is not the prose scrub §8 forbids**, for two reasons that are checked
rather than argued. It **changes no word**: `U+2011` and `U+002D` are the same
character to a reader, and what differs is a line-breaking instruction already
lost, because a glyph the face does not hold is not set by that face. A spec
folds both sides onto the drawable dash and asserts they are identical, and a
second asserts the length is unchanged because every substitution is one
character for one. And it is a **closed set of five**, every one a dash,
listed in one module: nothing about meaning, claim, figure or source is
examined, so there is no sentence it can change and no rule it can be extended
into. The en dash and em dash are deliberately excluded — every face holds
both, this product's prose uses them constantly, and flattening them is what
`documentText.pure.ts`'s `asciiPunctuation` does for the different purpose of
extracting text out of somebody else's PDF.

**Code is a quotation and is never edited.** `IBMPlexMono` is exactly the
family missing `U+2010` as well, so the substitution would matter most inside
a code span — and a code span is somebody else's bytes. An undrawable dash
there is left as written and counted, so it can be reported rather than
repaired. The partition that decides this is asserted to reproduce its input
byte-for-byte over thirteen shapes, including an unclosed fence and a backtick
inside a fence.

**W4.9 · The stale skill note.** ✅ **DONE**, and it was stale three ways, not
one — in the file `CLAUDE.md` names as the thing to read before touching any
PDF generator, which a designer reads and specifies type from.

| §4 said | the image holds |
| --- | --- |
| *"**Cinzel is not installed yet**"* | Cinzel, with a Dockerfile that FAILS THE BUILD without it |
| ships *"Cormorant Garamond, Fraunces"* | neither — no Debian binary package exists, and both were removed from the type stacks entirely |
| *"**Cinzel Bold** and Playfair Display **Medium** are the display faces"* | Cinzel Regular/SemiBold and Playfair Regular/Italic/SemiBold/Bold — **neither of those two weights** |

The third is the one that would have cost something. Those two files are the
`public/fonts/` SCREEN copies; asking the print container for Cinzel 700 gets a
synthetic bold of an inscriptional roman that never had one, and
`typography.pure.ts`'s whole weight table exists to stop exactly that.

**And the file it documents had the same defect.** `PRINT_STACK.cover`'s own
comment read *"Cinzel is the brand's cover face and ships Bold only, which is
why it is confined to the two places set large and short"* — forty lines below
the table that had REMOVED Bold and shipped Regular and SemiBold in its place,
with the reasoning written out. Two statements of one fact, disagreeing, in one
file. The reason now given is the one that was always true and does not depend
on what the image happens to hold: at body sizes an all-caps roman is
unreadable.

Four statements of one fact, then — Dockerfile, weight table, stack comment,
skill file. `reportTypography.spec.ts` already read the first; it reads all
four now.

**Two of the four new gates were vacuous when first written, and running them
against the original text is the only reason I know.** The "not installed"
check matched `[^.\n]{0,40}` and the doc wraps prose, so
`**Cinzel is not\ninstalled yet.**` carries a newline in the middle of the
claim and the regex stepped over it. The (family, weight) check excused any
mention within 200 characters of `public/fonts` — and the offending sentence
was *"Cinzel Bold and Playfair Display Medium (`public/fonts/`) are the display
faces"*, so the excuse sat inside the defect. Both are fixed, both now name
`Cinzel Bold` and `Cormorant Garamond` when run against the original, and the
excuse is now scoped to the **sentence** rather than a window — which also
forced the doc to put its qualification beside its claim rather than in the
next sentence.

---

## 4 · Sequence, and why

```
W1.1 ──> W1.3 ──> W1.4                   the cascade foundation
      (W1.2 withdrawn: the figures already draw)
      │
W2.2 ─┴─> W3.1 ──> W3.2/3.3 ──> W3.4/3.5  evidence, national
      │
W2.3/2.4, W4.*                            presentation, parallel
```

**W1.1 first**, because raw template markup is reaching clients today and it is
the cheapest defect in the document to close. **W1.3 next** — W1.2 was
withdrawn on measurement — because a chart that draws the wrong number is worse
than one that does not draw at all, and both rules land in the read path, which
cascades to every stored report and all ten formats at once.

**W2.2 before any of W3**, because a national register with nowhere to be
explained produces a better paragraph inside Location, not a section.

**W3.1 before the rest of W3**, because the national floor is what makes the
section honest for all eight jurisdictions on day one; the per-jurisdiction
refinements then raise precision without changing the document's shape.

W2.3, W2.4 and W4 are independent and can run alongside.

### Where the order actually landed, 21 Sep 2026

W1.1 and W1.3 went first as written, and every W4 item ran alongside. **W2.2
did not**, and the ordering above is why it could not: it says a national
register with nowhere to be explained belongs inside Location rather than in a
section of its own, and `sectionRegistry`'s own declared rule is that *a
section with nothing behind it should be merged*. W3.1's reader is built and
its register is not loaded, so un-merging `infrastructure` now would create
exactly the empty section both rules forbid. It waits on the first ingest, not
on more code.

**Everything left in this programme that needs no new infrastructure is
closed.** W3.1's prohibition and W3.2's coverage statement shipped without
their registers because the guarantee is worth having before the evidence
exists. **Neither W3.1 nor W3.3 is waiting on an approval, and this sentence
used to say both were.**

W3.1's table, its refresh schedule and the `approvals` stage that fills it
were **approved 21 Sep 2026 and are committed** (`6ba3a5e`:
`20261213000000_market_building_approvals.sql`,
`20261213010000_market_building_approvals_refresh.sql`, plus 130 lines in
`market-sales-ingest`). Both migrations carry an `@effect:` probe — the table
must exist in `pg_class`, the job in `cron.job` — because this register is
asserted by effect and never by configuration.

**This paragraph used to end "what remains is APPLICATION and a first ingest …
`20261213000000` is absent from the applied ledger", and that is no longer
true.** It was applied on 22 Sep, the first ingest ran, three defects behind
green signals were found and closed (the page bound measured on the wire
rather than in the worker; an SA4 filed as `sa2` and an SA3 as `lga`; and a
walk with no walker), and the register now deepens itself hourly — measured
over two consecutive ticks at the head of this entry. Nothing here is waiting
on a deploy.

**And that last sentence stopped being true 87 minutes after it was written.**
From 12:20 UTC on 22 Sep every hourly tick asked the ABS for 2025-07 → 2025-09
and was refused on one cell — *"the ABS building-approvals count for Ulverstone
2025-08 reads -5 dwelling units … refused"* — seventeen consecutive ticks by
04:20 UTC on 23 Sep, one message every time, read from `function_logs`, with
`oldest` frozen at 2025-10. ABS approvals are net of AMENDMENTS, so the -5 is
the publisher's own figure. Two layers refused it — the parser's sign check
and the table's own `CHECK (dwelling_units >= 0)` — and a third fault waited
behind them: the loader commits a window in batches, so lifting the first
refusal without the second would have committed part of the window and let
the walk step past the rest of it for ever. The fix for all three, and for the
drift allowance the first attempt loosened, is on
`claude/adoring-hopper-g02tdt` and **is waiting on a deploy**: a merge (which
ships the parser and loader) and one hand-dispatched migration,
`20261217000000_approvals_admit_net_amendments.sql`, in either order.
`docs/operations/SESSION_HANDOFF_2026-09-23.md` carries the evidence, the
order-independence argument and what was executed on a real PostgreSQL to
check it. Until it ships, production's Supply section keeps its old wording —
it says *"The publisher has released 10 of the 12 months"* and calls the total
a floor, when the ABS released all twelve and two are simply not held yet —
and it states nothing year-on-year.

W3.3 needs no register at all, for the reason its own entry gives: there is no
ABS projection at SA2 to load. The Bureau publishes four projection flows over
one `REGION` dimension of 23 codes — 8 states, 1 national, 14 capital-city or
rest-of-state, **zero SA2** — so a national projection register would hold
nothing describing a property's own area, and `forwardDemand.pure.ts` already
forbids a projection from being an `EvidencePoint`. Forward demand at the
property's own area is a per-jurisdiction register, and
`FORWARD_DEMAND_PUBLISHERS` names all eight publishers with `ingested: false`
truthfully because nothing here can reach them to check one.

**W3.5 was on that list and is off it, because the probe answered first.**
It is struck from the sentence above rather than left in it, since a reader
who trusted that list would ask for a table with nothing to put in it. Its
discovery probe needed no approval and was the right first step: measured
22 Sep 2026 from CI, **three of the four jurisdictions publish no sub-state
count of residential sales at all** — WA's catalogue holds 2,911 datasets of
which 203 matched and attributed and none carries a count, the NT's 1,075
matched none of five phrasings, and the ACT's 378 (read through Socrata, after
its CKAN 404 was kept and printed rather than replaced with another guess)
matched none either. Only Tasmania is unresolved and the reason is OURS:
`data.tas.gov.au` does not resolve from this egress. So there is no register
to create, no schedule to run and no approval to seek, and Demand's national
gap is a fact about what Australian publishers publish rather than a fact
about this deployment. **That is a better outcome than the approval would have
bought** — asking for a table would have produced an empty one and a remedy
naming a source that does not exist.

**W3.2 needs none of that, and that is the finding.** Its register is not
published as a feed at all — measured, not assumed — so there is no table to
create and no schedule to run, and the acceptance criterion's second branch is
the true one. W3.6 needed no infrastructure either and is closed with it, since
both are about what a reading SAYS rather than about what it holds.

**W3.4 turned out to need none of it either, and for a reason worth
recording.** It was listed above as needing a table, a schedule and an ingest
because "extend the constraint layers to SA, WA, NT and ACT" reads like an
ingest. Two of its three halves needed neither. The declared orders are a
decision about which kinds of register are consulted, which is code. And the
refinement that reaches the client's page — which amendment of the instrument
the controls in force belong to — was **already being retrieved**, on the same
Identify the height and the minimum lot size come from, and handed to
`console.log`; publishing it took no register, no schedule and no request that
was not already being made. The third half, a verified parser for SA, WA or
NT, does still need the ingest, and §5 of its doc says so.

The general lesson, which is this programme's most repeated one wearing a new
hat: **a requirement phrased as an acquisition is not always an acquisition.**
Four premises in this area were wrong because nobody had asked the publisher;
one retrieval was wasted because nobody had asked what the answer already
carried.

---

## 5 · Already closed in this programme

- **Seed v18** applied and verified live: 50 library entries carry "Share of
  grade", 0 carry "Five dimensions, weighted"; 4 active masters refreshed.
- **Section placement** — `documentPlacement.pure.ts`, 11 specs.
- **The forbidden valuation** — "Priced below suburb median" removed from both
  call sites with a code-scanning spec, under `MARKET_FIGURES_IN_THE_REPORT.md`
  rule 6.
- **The migration-drift gate** — made to run, made to fire, and made to stop
  reporting phantoms (14 findings → 8, every removal verified as a phantom).

## 5b · W4.7 again, and this time it was repository paths

Found by asking a question about my own work and then asking it of everybody
else's: the absence sentence shipped an hour earlier read *"has not been loaded
on this deployment"*, which a model told to state the absence would have
restated to a client. Grepping the same vocabulary across every prompt-composing
module found the real one.

**`GradeGap` has two audiences and one field had none declared.** `reason` was
documented *"the client sentence, no codebase vocabulary"* and `detail` *"the
operator detail"* from the day it was written. `remedy` said only *"what would
close the gap"* — and the Compass's **What each dimension rested on** bullets
draw it, through `readScoreAssessment`'s `exclusionRemedy`.

Executed against a stored score on 21 Sep 2026, that renders to a client:

| dimension | what the bullet printed |
| --- | --- |
| Location | *"Regenerate the report: the location service re-acquires the enrichment with its acquisition stamp (RF-7.2B) … locationInputVerification.pure.ts"* |
| Demand | *"… the open sales register's own transaction counts for this market (market-sales-ingest; NSW and QLD carry one on every row, VIC and SA one per load)"* |
| Property risk | *"Evidence this deployment does not hold: condition and maintenance. … what is outstanding for them is a query against the parcel rather than the address point."* |
| Capital growth | `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md` and `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md` |

Repository paths, an internal release code, an edge-function name, a source
filename and a description of our own loaders, in a customer's investment
report. It is W4.7's rule at a far larger scale than the `osm_amenity_register`
that opened it.

**It survived because `remedy` is CORRECT for the audience it was written
for.** An operator reading the grade-gap card needs the function name, the doc
and the release code — that is the whole reason `riskRemedyFor` derives from
the schema, so a remedy cannot name as missing something the platform already
reads. Nothing was wrong with the string. What was wrong is that a second
reader was added to it silently, and the field had no stated audience to
contradict.

`publisherNames.spec.ts` could not have caught it either: it refuses an
underscore-cased IDENTIFIER in a rendered field, and *"Regenerate the report:
the location service re-acquires the enrichment"* is a well-formed English
sentence.

Three rules. **`READER_REMEDY` says what is missing, never how we would obtain
it** — a customer cannot act on "load market-sales-ingest", and a report that
asks them to is describing its own maintenance. **Each is a whole sentence that
repeats nothing its reason already said**, because it renders immediately after
`reason` in one bullet: a noun phrase lands as a fragment (*"Not recorded. A
recorded weekly rent and purchase price for this property."*) and a restated
qualification lands as a stammer — location's first draft closed "not a finding
about the area" three words after its reason closed "It is not a reading about
the area". And **the read fails CLOSED**: a legacy row, which is every row
written before this field existed, renders its reason alone rather than falling
back to `remedy`, because falling back to `remedy` is the defect.

`gradeGapAudience.spec.ts` scans every reader sentence for seven classes of
repository vocabulary, and one assertion in `scoreAssessmentReading.spec.ts`
was **renegotiated because it was pinning the defect** — it asserted
`exclusionRemedy` contained `'acquisition stamp'`.

**And one more, in a module nothing mounts yet.** `locationEvidenceV2.pure.ts`
declares `statement` as *"what a reader must know"*, and two of them read
*"this deployment holds no source for it"* and *"No public transport feed
loaded by this deployment covers this location"*. It is ME-5's replacement for
the quarantined Location object and has **zero production call sites**, which
is precisely why it was worth correcting now rather than later: the wording
reaches a client on the day it mounts, and a module written before the rule
existed is the likeliest place for the rule to be broken again. Both now
describe the retrieval — *"no source for it was searched for this report"* —
and the spec gates every statement and caveat the contract publishes.

**Two more carry the same words and were deliberately left.**
`transportCoverageMatrix.pure.ts` has no production consumer either and its
sentence cites *"the 164 Perth and 145 Melbourne properties in the corpus"* —
corpus-analysis vocabulary, which is a bigger rewrite than a wording fix and
belongs with whatever mounts it. And `public-transport-service`'s
`no_data_for_location` message is a SERVICE DIAGNOSTIC returned to the
generator, which lists the loaded networks precisely so an operator can see
them; nothing composes report prose from it — `amenityFactBlocks` builds the
transport block from the stored enrichment. Naming them here rather than
changing them is the point: the rule is about what a reader is SHOWN, and
applying it to every string that mentions a feed would be a regex over
sentences, which is what §8 of `RUNTIME_CONSOLIDATION.md` forbids.

**Two assertions were renegotiated, both pinning the defect.**
`scoreAssessmentReading.spec.ts` asserted `exclusionRemedy` contained
`'acquisition stamp'`; `s5Corrections.spec.ts` asserted the client table
contained *"Answered property-risk questions from the per-class schema"* — and
that literal is the one `riskRemedyFor`'s own header records as WRONG, naming
hazard and planning as outstanding where the planning programme retrieves both
and strata on a house that is never asked about one. The test was vouching for
a superseded operator string reaching a client. Its fixture is a genuine
legacy row, which makes it the exact case the fail-closed read exists for.

## 5a · Two defects in THIS programme's own new code, found by re-reading it

Both were found by reading the modules shipped earlier today the way this
programme reads everybody else's: looking for a rule that cannot fire, a
fallback that swallows a real case, and a comment the code does not obey.
Neither was caught by its own spec, and in both cases the reason is the same
one this programme keeps recording.

**`provenanceSentence` reported the NEWEST register slice as the oldest.** It
formatted each slice's load date and then sorted the RESULTS — and
`'1 Oct 2026' < '18 Sep 2026'` lexically, so with slices loaded on different
days the newest won. The comment directly above it says *"One date: the
OLDEST slice drawn, because that is the claim the whole table can carry"*, so
the code contradicted its own stated intent, in the one direction that
**overstates** how current a reading is. It sorts ISO and formats afterwards
now. The spec could not see it because its fixture carried a **single** date —
a fixture simpler than production, which is §2's rule at the smallest scale.

**`printableGlyphs`' partition fallback failed OPEN.** When reconciliation
cannot locate a part it returns the whole document as one region, and that
region was marked **prose** — so the substitution would have run inside every
fence and code span in it, silently breaking the one bound the module's header
states as a rule: *"Code is a quotation and is never edited."* It returns the
document as CODE now, so an unreconcilable partition costs the repair and
never the text. The branch is defensive and, from the partition's own
construction, unreachable — but **a defence that fails open is worse than no
defence**, because the header then promises something the code does not do.
It is exported so the branch is exercised directly rather than reasoned about.

Both are pinned by specs verified non-vacuous by reverting the fix.

## 5b · Found on the way, and deliberately NOT fixed here

**Three drift checks exist and nothing runs them, and one of them is
currently failing.** Found while looking for other generated artefacts that
seed v19 might have left stale — the migration object index was one, and
`security` caught it in 50 seconds.

The table below is **as found**, and every "no" in it has since been closed;
what each became is in the column beside it. It is kept in its original state
rather than rewritten, because the count of what was unwired is the finding.

| check | wired when found | state today |
| --- | --- | --- |
| `reportkit:tokens:check` | yes | pass |
| `reportkit:assets:check` | yes | pass |
| `market:registry:check` | yes | pass |
| `integrations:secrets:check` | yes | pass |
| `migrations:index:check` | yes | pass (after this branch regenerated it) |
| `brand:icons:check` | **no** | wired (`1ac0242`), pass |
| `mobile:tokens:check` | **no** | wired (`1ac0242`), pass |
| `mobile:api:check` | **no** — and FAILING | wired (`1ac0242`), pass after regeneration |
| `templates:compass:qa` | **no** | wired (`1ac0242`) as its own `template-geometry` job, pass |
| `templates:library:seed:check` | **did not exist** | wired (`4c973bd`) beside the render gate, pass |

**And the fourth is the most consequential.** No workflow runs ANY
`templates:*` script — checked across every file in `.github/workflows/`. The
catalogue SCHEMA is covered in CI by vitest (`seedCatalogue.spec.ts`,
`investmentCompassSource.spec.ts` and friends), but the rendered GEOMETRY is
not: `templates:compass:qa` is the Chromium measurement, and `CLAUDE.md` cites
it by name for the class it catches — *"a block that sets taller does not
overflow the page, it prints over the next one … `npm run templates:compass:qa`
fails on the class."*

That class has reached a client: the verdict heading printing through the KPI
band over `$1,975,000` and `$850`. The gate that catches it runs when somebody
remembers.

**All four are wired now**, on the owner's instruction.

`templates:compass:qa` is its OWN job (`template-geometry`), not a step in
`verify`: it is ~15 minutes of browser against that job's few, and jobs run in
parallel, so as a step it would put every other check behind it. It runs
**unconditionally** rather than behind a path filter — the surface it depends
on is the masters, the block builders, the resolvers, the HTML renderer, the
design tokens, the binding projection and the section registry, and this
repository has already paid for a guess at that kind of list once: the deploy
workflow built its changed-function set from `supabase/functions/**` alone, so
a config-only edit deployed nothing and a `verify_jwt` declaration and
production came to disagree. It uploads its renders on failure, because a
reviewer should be able to look at the page rather than read a coordinate.

**`mobile:api:check`'s failure turned out to be benign and fully verifiable**,
which resolves the caution recorded above. Regenerated: **five functions
added, zero removed** — `amenity-register-ingest`, `estimate-capital-growth`,
`market-sales-ingest`, `mission-control-announcements`,
`urban-centre-register-ingest` — every one a feature this repository added
recently, every entry DERIVED from the security registry rather than authored,
and no existing function's `exposure_class`, `mobileScope` or `verify_jwt`
changed. The only other lines that moved were the three counts. The artefact
was simply stale by five functions, with nothing to say so.

**What follows is the reasoning as it stood before the regeneration above,
kept because it is why the caution was right to take and what discharged it.**
It reported, in the present tense, that `mobile/api-surface.json` fails on the
PR base as well as on this branch, that `CLAUDE.md` plainly intends both
mobile artefacts to be checked while *"nothing checks them"*, that this was
"the unmounted-component class applied to a CI gate — a check that exists,
works, and is wired to nothing, the same shape as `DimensionRail`, `bd-chip`
and `verdict.pricingUrl`", and that **it was recorded rather than fixed**
because regenerating an artefact feeding the Flutter workspace, with no gate
covering it and this session never having read that subsystem, is the kind of
unverifiable change to an outside subsystem that this programme exists to
stop.

Every one of those sentences is now false, and each was closed by the
paragraph above: the artefact was regenerated (five functions added, zero
removed, every entry derived rather than authored), which made the change
verifiable and discharged the caution, and both mobile checks are wired —
`ci.yml` runs `mobile:tokens:check` and `mobile:api:check` in `verify`.

**Leaving them in the present tense cost something measurable, which is why
they are marked rather than left standing.** On 22 Sep 2026, with W3.1 and
W3.3 assessed and found to need nothing, the next move chosen was to wire the
two mobile gates — *because this section said nothing checked them*. Both were
already wired and both already passed. That is this document misleading its own
author inside one session, and it is the same defect the programme records
against `strategySectionRules` (a module naming five composed sections where
three exist), against the two contradicting prompt blocks, and against
`SA_NT_NOTE`: **a record that states two things resolves to whichever the
reader reaches first.** A superseded paragraph is kept for its reasoning and
must say that it is superseded.

### W3.1 applied — and the schema landed while the loader did not

Applied 22 Sep 2026 through `apply-migration.yml`, the reviewed workflow, in
dependency order and each verified by effect rather than by its own success:
`20261213000000` (the table) and `20261213010000` (the 17:45 UTC refresh job)
are absent from `migration-drift`'s NOT APPLIED list, which is that report
saying both `@effect` probes are satisfied — the table in `pg_class`, the job
in `cron.job` — and `list_tables` shows `market_building_approvals` present,
RLS on, **0 rows**, which is correct because nothing is seeded.

**Then the first ingest was fired deliberately rather than waiting for the
schedule, and it answered HTTP 400 in five milliseconds.** That was the point
of firing it: the loader had never executed in production, and three of its
steps can only fail against the real publisher.

The cause is not in any of the three. `function_logs` shows authentication
SUCCEEDING (`Valid INTERNAL_EDGE_SECRET`) and the function refusing at stage
dispatch before doing any work, because **the deployed `market-sales-ingest`
is `main`'s, and `main`'s copy contains zero occurrences of the word
`approvals`** — its refusal message enumerates the eight stages it does know
and that is not among them. The stage was added in `6ba3a5e`, on this branch,
unmerged and therefore undeployed.

**The rule, which neither migration stated:** a register's migration and the
function that fills it have a shipping ORDER, and it is not interchangeable.
`CONTAINER_RELEASE.md` already holds exactly this for the WeasyPrint image and
the render routes — *"the order the container and the render routes have to
ship in, which is not interchangeable"* — and this is its instance for an
ingest.

Applying the table early is harmless: an empty register reads `Not searched`
and every report is forbidden from stating a figure, which is the designed
degradation and the reason the prohibition shipped before the register.
Applying it early and ASSUMING it fills is not harmless, because the nightly
job takes this same 400 while pg_cron reports success — the trap
`SCREENING_EXECUTION.md` named once already: **a green cron run is not a
delivered request.** Had the first run been left to the schedule, the register
would have sat empty behind a green tick until somebody read the sync rows.

Two things follow. The trigger migration is **re-applied once
`market-sales-ingest` ships**, which it is written to survive. And the
distinction that makes this reportable rather than embarrassing is that the
failure was found by asking the database what happened rather than by trusting
that a migration's success meant a register's readiness — §7's rule, paid
again: read the production logs before modelling the production behaviour.

### The generated artefact nobody checked, and the 301 templates it cost

`mobile/api-surface.json` above is a check wired to nothing. The seeded
template catalogue is the case one step worse: a generated artefact with **no
check at all**.

`buildSeedCatalogue.ts` writes a 40 MB migration from the template
definitions, `CLAUDE.md` says never to hand-edit it, and nothing anywhere
compared the two — so the generator could be run or not run and the repository
looked identical either way. Measured on this branch, 22 Sep 2026: seed v19 was
written at `5d17954`, four commits landed after it, and two of them changed
what the definitions produce:

* `bcd1bf5` — a bound KPI note budgeted one line and setting two, growing the
  dashboard grid on page 2 of **142** masters by 8–21pt and moving every block
  below it down (76 callouts, 59 text blocks, 40 data tables, 31 decision
  boxes, 18 strengths-watch panels). Before it, the note set over the row
  beneath.
* `b842936` — W4.5's cover facts, off a density literal that disagreed with the
  family's own scale on 22 of 50: **140** masters 11pt → 9pt, **80** 14pt →
  13pt.

Neither had reached the migration, and **the migration is what a deployment
applies**. A fix that reaches only the definitions reaches no document at all,
which is exactly how seed v18 merged without landing — the failure
`20261212010000`'s `@effect` line catches one layer further down and this is
the layer above it.

**It is still a v19, not a v20.** The builder's own header conditions a new
version on the previous one being RECORDED, and the one-query check answers
that it is not: 1,012 migrations applied, latest `20261211000000`, v19's pair
unmerged on one branch. So it was regenerated in place rather than stacked on
top of an unapplied release.

Measured template by template across all 543: **301 differ**, every one a
design-family master, none of the 43 voice templates, **no page count and no
block count changed anywhere** — every difference is a size, a height or a
`y`, and the two changes never touch the same grid. That last part is checked
rather than asserted, because the first draft of the v19 comment claimed it
about the placeholder words and was false.

`npm run templates:library:seed:check` is the remedy, in `template-geometry`
beside the render gate under `always()` so a stale seed and a geometry failure
are both reported by one run. Three rules. **The comparison is the artefact,
never a count** — a count absorbs one change arriving as another leaves, which
is what `check-edge-functions.mjs` paid for when `TS2304` was frozen by number
and a live `ReferenceError` went with it. **A migration that was never written
is drift, not a pass.** And **a refusal names the templates**, because a 40 MB
diff sends nobody to a remedy. Measured both ways before it was trusted: exit
1 on the stale file with 301 named, exit 0 on the fresh one, and
`seedIsGenerated.spec.ts` fails when the CI step is taken back out — verified
by taking it out.

## 6 · Decisions this plan does not take

- Whether the 21 `market_sources` rows should be seeded — a decision about live
  rows, recorded in `20260921060000`'s header.
- Whether the nine pre-19-Sep reports are regenerated. They are scored on three
  dimensions and would each gain 5–9 points; the owner has said no.
- Whether Risk can ever score. It needs a construction year, held on 0 of 1,230
  stored reports, and `propertyRiskSchema.pure.ts` forbids manufacturing it. Four
  of five remains the honest ceiling.
