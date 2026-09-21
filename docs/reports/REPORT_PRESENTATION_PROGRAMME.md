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

**W1.1 · Close the directive vocabulary.**
No unrecognised directive may reach paper. `{{stat …}}` must either parse or be
stripped.
*Accept:* a spec renders every directive kind the generator's prompt can emit,
through the real read path, and asserts no `{{` survives in the output; plus a
scan of the delivered corpus for `{{`.

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

**W1.4 · One chart standard.**
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

**A growth heatmap printed `0` for Victoria's ten-year CAGR.** Absent is never
zero, and the grid grammar has no null. The `0` is in the directive the model
wrote, so nothing at presentation can tell it from a real zero; closing it is a
producer change.

### W2 · Structure and placement

**W2.1 · Section placement by declared order** — **done**
(`documentPlacement.pure.ts`, 11 specs). Composed blocks land at their registry
order; the document closes on its disclaimer.

**W2.2 · Un-merge `infrastructure` and `supplyPipeline` for the Compass.**
Give each a declared section, order and word budget. **This is the precondition
for W3**: a national register with nowhere to be explained is a paragraph inside
Location.
*Accept:* `sectionsForTier('compass')` returns both; the contents page lists
them; `documentPlacement` seats them at their declared order.

**W2.3 · Rebuild page 5 and page 37.**
p5 either carries a real risk register or is removed and its dashboard given the
room; p37's five-column, one-row table is restructured.
*Accept:* no content page below a declared fill floor (see W2.4).

**W2.4 · A page-fill floor.**
No content page below ~45% fill; short tails fold back under the existing
`NARRATIVE_PACKING` rules, which already cut a paragraph at a sentence, repeat a
table head, float a figure and refuse a stub last page.
*Accept:* the fill probe over a regenerated document reports no content page
under the floor, with front matter and deliberate dividers excluded by name.

### W3 · Evidence — national by construction

The rule: **every property in Australia gets a development reading; the grain is
the publisher's; the scorer prices the grain; coverage travels with the answer.**
This is `openDataSalesEvidence`'s existing rule — an LGA point scores 55, a
postcode 80, a suburb 100 — applied to development evidence.

**W3.1 · The national floor: ABS Building Approvals by LGA.**
Monthly, free, authoritative, **every local government area in Australia**;
dwelling counts and dollar value. One source, national coverage, no key. It is
the direct analogue of the Queensland DA walk that produced 1,410 dwellings and
$1.18bn, and `registerWalk` / `summariseDaRows` already exist to consume it.
*Accept:* a development reading for a property in each of the eight
jurisdictions, each naming its grain and period.

**W3.2 · National named projects: Infrastructure Australia Priority List.**
Nationally significant projects carrying the publisher's own status word — an
approval never read as funding, funding never as a start on site.
*Accept:* page 22's sentence is replaced by named, dated, sourced entries, or by
a coverage statement that names the register asked.

**W3.3 · National forward demand: ABS population projections by SA2.**
Replaces "no forward projection" everywhere rather than in one state.

**W3.4 · Per-jurisdiction refinement behind a declared order.**
`DEVELOPMENT_PROVIDERS` / `PLANNING_PROVIDERS`, mirroring `AMENITY_PROVIDERS`
and `GEOCODER_PROVIDERS`. Extend the existing NSW/VIC/QLD/TAS constraint layers
to **SA, WA, NT and ACT**, and add each jurisdiction's amendments and
major-project registers as refinements *above* the floor — never as the only
answer.

**W3.5 · Close the Demand scoring gap.**
Sales counts for ACT, NT, TAS and WA, so Demand can score nationally rather than
in four states. Today `scoreTransactionVolume` is the only primary demand
measure this deployment is entitled to, and it needs four counted periods.

**W3.6 · Coverage travels, with a jurisdiction dimension.**
A Western Australian property must read *"no state planning register is loaded
for Western Australia"*, never *"no overlays"*. The five absences already
exist — `not_served`, `not_integrated`, `licence_restricted`, `none_at_point`,
`unavailable` — and must be stated on every reading, full or empty.
*Accept:* a test asserting that for each of the eight jurisdictions the planning
and development readings carry an explicit coverage statement, and that no
absence is rated.

### W4 · Typography, brand and copy hygiene

**W4.1 · Running head fitting.** A marker that does not fit gets a short form
that is a **prefix of the full label** (the existing `shortLabel` rule). Tested
against the longest chapter label across **all ten formats**, not the Compass's.

**W4.2 · Contrast audit under REPORT_RULES §2.** Eyebrows, running heads and
page numbers render at 6–6.5pt in this document, where the floor is 7:1 and no
saturated accent. `--brand` on ivory is ≈2.3:1. Derive one darkened gold; the
codebase already contains eight because this was solved ad hoc.

**W4.3 · Page 4** — drop the "Noted" placeholder term; draw all opportunities,
not index 0.

**W4.4 · Page 3** — one strength on a half-empty page.

**W4.5 · Cover** — the verdict block at 11pt against a 41pt address.

**W4.6 · Debris** — four empty bullets and a stray "1" on page 16.

**W4.7 · No database vocabulary in a client document.** `osm_amenity_register`
is printed in prose on page 34. The AML module already forbids underscore-cased
identifiers in rendered fields and has a test for it; port the rule.

**W4.8 · Glyph coverage.** U+2011 falls back to a substituted face on three
pages. Either supply the glyph in the primary face or normalise it at the write
boundary.

**W4.9 · Correct the stale skill note.** `REPORT_RULES.md` §4 states "Cinzel is
not installed yet". The delivered PDF embeds `FWDZFX+Cinzel`. Left uncorrected,
designers will keep avoiding a face that is available.

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

## 6 · Decisions this plan does not take

- Whether the 21 `market_sources` rows should be seeded — a decision about live
  rows, recorded in `20260921060000`'s header.
- Whether the nine pre-19-Sep reports are regenerated. They are scored on three
  dimensions and would each gain 5–9 points; the owner has said no.
- Whether Risk can ever score. It needs a construction year, held on 0 of 1,230
  stored reports, and `propertyRiskSchema.pure.ts` forbids manufacturing it. Four
  of five remains the honest ceiling.
