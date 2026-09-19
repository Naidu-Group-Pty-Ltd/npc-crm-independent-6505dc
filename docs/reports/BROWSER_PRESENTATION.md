# The Investment report: chosen in the browser, previewed in the browser, finalised by the print engine

Read this before touching `src/lib/reports/investment/deliverInvestmentPdf.ts`,
`investmentPdfDocument.ts`, `src/lib/reportTemplate/pdfRenderer.ts` or anything
that decides which presentation a client's Investment PDF comes out in.

One report truth, several approved presentations:

```
Report Engine        → generates and validates the report
Report Editing       → persists the operator's approved edits
Templates page       → selects the presentation
Browser preview      → the same template, drawn here, at no cost
FINALISE             → compileTemplateHtmlForPdf → render-template-pdf → WeasyPrint
Export / Delivery    → stored PDF → download / send / portal
```

`produceInvestmentDocument` is the one contract. Every surface that hands a
client a PDF asks it — the report page's button, the flatten copy, Send to
Client, the client workspace's Reports tab — and `publishInvestmentPdf` is the
one that also stores the bytes and records `pdf_url`. **There is no second PDF
truth to choose between by pressing a different button**, which is what there
used to be: three controls produced three different artefacts, and only one of
them honoured the operator's template selection.

**The print engine is reached from exactly one place, for exactly one purpose.**
RC-3.1 took WeasyPrint off this journey; RS-2 (14 Sep 2026) brought it back
for the FINAL document alone, after RV-1 measured why the browser renderer
could not be the last step: jsPDF embeds no fonts, so a chosen template's
headline figures drew illegibly, and it cannot draw text on a filled panel at
all. The reason it was taken off still stands — a render service reached from
a preview, an edit or a page load is a cost with no deliberate act behind it —
so what is pinned now is the BOUNDARY rather than the absence
(`investmentFinalRender.spec.ts`, asked of the module graph): one client module
names the function (`weasyRenderClient`), one journey module imports it
(`routeReportThroughTemplate`), one call site asks for a `final` render, no
preview surface can reach it, and no Cloud Run host is addressed from the
browser at all — the engine sits behind the edge function, which applies the
client-readiness gate a second time and stamps the job with the report it was
of. `render-investment-report-pdf` stays unreachable. Template Builder's own
preview and export paths are in the same repository and are still not on this
journey.

## Two presentations, one payload

| | standard | selected template — preview | selected template — FINAL |
| --- | --- | --- | --- |
| renderer | pdf-lib, `investmentPdfDocument.ts` | jsPDF, `reportTemplate/pdfRenderer.ts` | WeasyPrint (pinned), `render-template-pdf` |
| telemetry | `browser_pdf_lib` | `browser_template_jspdf` | `weasyprint_final` |
| drawn from | the report's own Markdown | the adapter's frozen binding payload | the same payload, compiled by `compileTemplateHtmlForPdf` |
| stored by | `publishInvestmentPdf` uploads it | never stored | the engine, in `investment-reports`; the path travels back |

All three identities are exported constants rather than literals at the logging
call site, because telemetry has exactly one question to answer — *which
renderer produced these exact bytes* — and it used to answer
`premium_weasyprint` on every download, long after WeasyPrint had stopped being
reachable. A telemetry value naming a retired service is worse than none,
because it is read as evidence. `routeReportThroughTemplate` takes the choice
as `renderer: 'browser' | 'weasyprint'`; the Investment finalisation passes
`weasyprint` and every other caller gets the browser default, so no format
reaches the engine by omission.

**The readiness gate sits above both.** `assertInvestmentReportClientReady`
refuses a report carrying a blocking `governed_authority` flag whichever
presentation it would have come out in, because the defect is in the report and
not in the layout. It used to live inside the two render services, which meant
removing them would have deleted it.

## One finalisation → one PDF

A final render is asked for by a deliberate act — Generate, Download, Send,
Publish — and never by typing, an edit, a preview refresh, opening the
Templates page, a hover or a page load. Two protections in
`produceInvestmentDocument` keep one act to one render, and both are pinned by
`deliverInvestmentPdf.spec.ts` rather than trusted:

* **Concurrent asks share one production.** A double-click, a re-rendered
  button, two surfaces asking at once: the in-flight promise is keyed on
  `(report, request)` and handed to every caller.
* **A completed finalisation is remembered, per tab.** The key is everything
  the document is drawn from — the record as read (every column but `pdf_url`,
  which publishing itself writes), the chosen template, the hero-image set, the
  variant, the five controls and the design options — so Download after
  Generate, and Send after Download, reuse the document. An edit, a different
  template, a toggled control or a changed image moves the key and the next ask
  draws again. The row is keyed whole rather than by a version stamp because the
  detail projection carries `current_version` and not `updated_at`, and an edit
  moves only the latter. The memo holds eight documents and forgets the oldest;
  `forgetFinalisedInvestmentDocuments()` empties it.
* **Publishing reuses the stored bytes.** The engine stores the final PDF in
  `investment-reports` — the bucket the portal reads — and answers its `path`;
  `publishInvestmentPdf` points `pdf_url` and the portal row at that path
  instead of uploading a second copy. A document drawn in this tab (the
  standard presentation, or a template the browser drew) is uploaded exactly as
  before. Measured through the real journey on three reports (14 Sep 2026):
  one `render-template-pdf` call per finalisation, zero on Send, and the portal
  row's `storage_path` equal to the render's path.

The one thing the key does not see is a change to the TEMPLATE's own schema
made in the same tab between two asks — Template Builder is an authoring tool,
and a person editing a master and immediately finalising a client report from
the same tab would receive the document drawn before the edit. It is recorded
here rather than guarded, because the guard would be a read of the template on
every ask to protect an author from their own tab.

## Five controls, and the two kinds they are

`presentationOptions.ts` states them once.

* **Sources** and **Scoring** are CONTENT INCLUSION. They remove whole sections,
  and they are applied to the report's Markdown **before either renderer sees
  it** — so a chosen template and the standard document agree about what belongs
  in this client's copy. They were inline in the standard generator before,
  which meant a report delivered through a template carried its source notes
  however the switch was set, and nobody was told. Measured over the corpus, the
  Sources rule matches a heading in **964 of 1,210** reports and the Scoring rule
  in **1,043**; a report whose source notes are folded into a combined appendix
  with the disclaimer matches neither, and that is correct — removing that
  heading would remove the disclaimer.
* **Charts**, **Hero images** and **Sparklines** are PRESENTATION. They decide
  what is DRAWN, never what is true: turning charts off leaves every figure,
  table and sentence the chart was drawn from exactly where it was. Measured on
  report `783bb982`, Charts off takes the standard document from 20 pages to 14
  and the Dictionary template from 29 to 23, and removes no number.

Hero images place what `report_hero_placements` already holds. **Nothing is
generated during export** — no model call, no image API. That table currently
holds zero rows across the whole database, so the control is wired and has
nothing to place; that is an honest empty rather than a broken switch.

## A directive is drawn or dropped — its source is never printed

The generator's prompt tells the model to write its figures as `{{bars: …}}`,
`{{gauge: …}}`, `{{glance: …}}` and nine more kinds. `markdown.pure.ts` states
the rule and the template presentation obeys it through `vizFigures.pure.ts`.
The standard presentation had never heard of them: on report `783bb982` it set
**thirty-six** of them as body copy on a client's pages, one repeated across
four consecutive pages because the line was carried as a table's header row. 60
of the 1,195 completed reports carry directives — 4,652 of them, 77.5 a report —
and they are the ones the current generator writes.

Two rules came out of fixing it.

**The removal happens at paint time, and nowhere earlier.** Stripping before
`parseReportContent` cost the document FOUR CHAPTERS and the disclaimer:
`parseReportContent` saves a section only `if (currentContent.length > 0)` and
`allSectionNames` drops anything under forty characters, so a chapter whose own
body is a single `{{glance: …}}` opener — "Why This Location Matters", "Amenity
& Access", "Property Fit Within the Suburb", "Appendix, Source Notes &
Disclaimer" — became a heading over nothing and vanished with its contents entry
and its subsections' parentage. Sectioning, the section filter and the table of
contents see what the record holds; only the painted text loses the tokens.

**A removed figure never removes a sentence.** The prose around a directive, and
every number in it, is untouched.

## The presentation does not rewrite the report's prose

`sanitizeAIContent` repairs merged words in model output, and two of its rules
split every case boundary they found — which is what a NAME looks like.
Measured over the completed corpus, the camelCase splitter's own hit list is
this product's data sources and Australian agencies: **CoreLogic 3,975**,
OpenAgent 447, AreaSearch 160, OnTheHouse 97, PropTrack 83, plus QuickStats,
MacKillop, MidCoast, VicPlan, VicRoads, VicPol, VicEmergency, TrainLink,
FloodCheck and OpenStreetMap. Every standard-presentation PDF printed "Core
Logic" and "Prop Track", so the document misnamed the sources it cites — while
the template presentation printed them correctly, which means **one record was
producing two different sentences**. That is the parity question, asked of
prose rather than of figures.

The letter-digit splitter was the same defect on units and codes (`988 m2` →
`988 m 2`; the corpus's letter+digit tokens are SA2 1,290, SA4 778, SA3 776,
FY21, GRZ2, Yr10 — geography and zoning, not merges). The punctuation rule split
on any letter after a stop, so `e.g.,` came out `e. g.` and the firm's own
contact line came out `www. npcservices. com. au`.

What still repairs: `done.The` → `done. The` (a lowercase letter, a stop, then
a CAPITAL — a lowercase letter after the stop is the shape of a domain, an
abbreviation or a file name), `2026The`, `Westernfreeway`, `Vale'sdemographic`.
The compound-word rule is case-SENSITIVE for the same reason: `/gi` matched the
`Road` in `VicRoads`.

## Punctuation sits against the word it belongs to

`parseMarkdownText` returns one run per emphasis span, and the drawing split
every run on spaces into independent words — so `**988 m² land size**, paired`
drew the comma as its OWN word with a space in front of it. Three on the first
page of prose.

A word carries `glue`: no space before it, no gap allocated to it when the line
is justified, and it may not START a line (the word in front comes down with
it). **Both sides decide** whether a run continues the one before: a run's own
text never begins with the space that separates it — that space is at the END
of the previous run — so gluing on "does not start with white space" alone
produced "is aland-rich". The page-overflow hand-off carries the flag too,
because rebuilding the continuation with `join(' ')` is what would put the
comma back on its own.

## A list with nothing in it draws nothing at all

`strengths-watch` resolved each item inside the draw and placed the glyph badge
before the text, so an item resolving to nothing left a coloured dot under a
heading bar with no words beside it. `investment_score.strengths` and
`.weaknesses` are `[]` on a report whose evidence was insufficient to grade —
the ordinary state — so the Verdict page of all three structures carried
"STRENGTHS" and "CONSIDERATIONS" as two title bars each with one stray bullet.
Items are resolved first, empties dropped, and a column with none left draws
nothing including its title bar.

## An unresolved binding renders as the empty string, never as a visible `{{…}}`

That is the presentation renderer's own contract, and `definition-list` broke it
in the one place the Investment masters put the report's own facts: it read
`String(item.definition)` instead of resolving it, so **thirteen tokens** —
`{{org.name}}`, `{{property.address}}`, `{{assumptions.capitalGrowth |
percent}}`, `{{recommendation.grade}}`, `{{assessment.4.details}}` and the rest —
were set as body copy on the assumptions page and the colophon of every rendered
report, identically across all three selectable structures.

`productionMastersBindingsResolved.spec.ts` asks the question of the BYTES,
because that is the only place it is actually answered: a renderer that forgets
to resolve a prop typechecks, lints and draws a plausible page.

## A presentation may not decide which core facts a client sees

`extractKPIMetrics` opened with `if (reportTier !== 'financial') return null`,
so on a Compass report the standard presentation drew **no financial band at
all** — while every selectable template binds `financials.*` unconditionally and
printed the same figures from the same record. 1,124 of the 1,195 completed
reports are Compass tier, so for almost the whole corpus the purchase price, the
weekly rent, the LVR and the yields appeared or vanished according to which
presentation the operator happened to choose. That is not a design difference;
it is one record producing two different statements about the money.

The rule is **availability, not tier**: an authoritative value exists → it may be
presented; it is absent → that one KPI is omitted. Nothing in the presentation
calculates, derives, substitutes or fetches — every tile is a stored value
formatted. The Financial tier keeps its deeper modelling, its extra sections and
its specialist commentary; what it stops having is a monopoly on the basics.

Four things carry it.

**The tier line was not the only suppressor.** The band also required a section
NAME to invite it, and only 141 of the 1,123 Compass reports have one — so
deleting the tier test alone would have left 982 reports, the certification
subject among them, with no band. `sectionInvitesKpiBand` is now asked once and
also decides a fallback host: where no section invites the band, the first
section carries it.

**A complete record must not crowd its own facts out.** Net Yield, Deposit and
Loan were gated on `row1.length < 4` behind a four-tile cap, so the more the
record knew the less the client was shown. `drawKPIBoxes` still draws at most
four to a row — the primitive is unchanged — but the financial set is no longer
truncated to one row.

**Where two presentations read the same fact, they read it the same way.**
`financials.loanAmount` is `loanDetails.loanAmount ?? initialCosts.loanAmount`
and `financials.lvr` is `keyMetrics.lvr ?? loanDetails.lvr`; the band now reads
both in that order, because reading them in a different one is how a single
record comes to state two LVRs. The yields go through `rentIsEstablished` —
the same rule `reportBindingProjection.pure.ts` gates them with — so the standard
document cannot print a yield the engine says is unfounded. That is this
programme's `0.00%` defect in the other direction.

**Omission is the whole mechanism, and a zero is an omission here.** The
per-KPI checks are truthiness, which was already the rule and is deliberately
kept: measured over the 204 reports carrying a `keyMetrics` block, none holds a
zero price, rent or LVR, and the five with a zero gross yield are exactly the
reports whose rent was never established. Nothing prints `0`, `N/A` or a dash in
place of a figure the record does not hold.

`compassKpiContentParity.spec.ts` pins all three cases, and takes its
expectations from `applyInvestmentProjection` — what the selected template is
actually bound to — rather than from a list written in the test that could drift
from both.

### Measured content parity, 13 Sep 2026

The certification record rendered four ways (A standard, B Dictionary,
C Frontispiece, D Chancery), 25 figures compared in the drawn bytes:

| | before | after |
| --- | ---: | ---: |
| figures agreeing across all four | 12 / 25 | 21 / 25 |

The four that still differ are understood and none is a contradiction:

- **Annual rent** and **annual net cash flow** — the same facts the standard
  publishes weekly (`$445`/wk, `-$450`/wk). One fact, two units.
- **Net yield** — the standard publishes it (1.85%); the masters do not lay it
  out, though the projection publishes it to them. Standard carries *more*.
- **Score / grade** — the templates print `Assessment grade — N/A · out of 100`
  on a record with no score; the standard omits it, which is what this
  programme's own rule requires. Standard is the correct one.

The last two are master-layout questions and belong to the deferred template
geometry work, not to the presentation's content policy.

## Template failure is a fallback, never a worse document

`routeReportThroughTemplate` answers `null` for ten named reasons and the
operator is told which gate closed. The standard presentation then draws the
**same** payload — the same content rules already applied, the same record, the
same readiness gate — so a refused template costs the chosen design and nothing
else. There is no partial PDF, no placeholder panel, no raster and no
regeneration, and the operator's edits are not lost because nothing is re-read.
A final render the engine refuses (its own readiness gate, a resource the
boundary will not admit, an outage) is one more of those nulls, so the client
still receives the standard document rather than an error.

Compatibility is asked of the RENDERER, not of the template's `engine` column:
that column records which service a template was authored for, not whether it
can be drawn. The browser preview asks `judgeBrowserProductionExport` (a block
without a full jsPDF drawing refuses the template); the final render asks the
block registry's HTML capability, and refuses only a type no renderer has at
all (`template_not_renderable`). All four selectable Investment templates pass
both.

## The selectable Investment catalogue

Measured against production on 13 Sep 2026 — four active rows, three distinct
structures (the two Chancery rows are one structure bound to two format
spellings):

| template | format | pages | blocks | block types |
| --- | --- | ---: | ---: | ---: |
| Private Banking — Chancery | `investment` | 50 | 320 | 16 |
| Private Banking — Chancery | `investment_compass` | 50 | 320 | 16 |
| Data / Analyst — Dictionary | `investment_compass` | 51 | 327 | 18 |
| Luxury Editorial — Frontispiece · Midnight Editorial | `investment_compass` | 53 | 325 | 16 |

## A genuine zero is a finding; an absence is not a word

Two opposite failures, and the product had shipped both.

**`if (value)` collapses a measured zero into "missing".** Every tile in
`extractKPIMetrics` tested truthiness, so a **breakeven** weekly cash flow
(`$0`), a **cash purchase** carrying no loan (`$0`, LVR `0%`) and a rate held
at **0%** all vanished from the client's band as though the record did not know
them. The more ordinary the transaction, the more likely it was to lose a fact.

**And an absence must never be given a word.** `investment_score` on the
certification record carries `grade: 'N/A'` beside `policy.gradeIssued: false`
— a scorer's sentinel, not a grade. `reportBindingProjection` published it
verbatim, every Investment master binds it as `'{{recommendation.grade}} ·
{{recommendation.score | fixed:0}} out of 100'`, and all three selectable
structures printed **"Assessment grade  N/A · out of 100"** on the client's
method page.

The rule:

| the record holds | the client sees |
| --- | --- |
| an authoritative `0` | `$0` / `0.0%` — it is the answer |
| nothing | no element at all — not `N/A`, not a dash, not a fabricated `$0` |

Four things carry it.

**One authority, not a new one.** `presenceOf` (`visibilityPolicy.pure.ts`) is
this platform's three-state test — `absent` / `zero` / `value` — and the band
asks it directly. Anything resting on rent asks `rentIsEstablished`, the same
rule the template projection gates both yields with. Nothing in the renderer
calculates, derives or substitutes so that a card can stay visible.

**The sentinel is refused at the source, on the one field it belongs to.**
`publishableGrade` states the whole rule once and the projection publishes
through it; the score travels with the grade, because a number out of 100
beside no grade is the same claim wearing one fewer word. `'N/A'` is refused
*there* rather than in `presenceOf`, which deliberately treats `n/a` as
possible real content — a zoning of "None" and a street called "Na" exist.

**A bound field that received nothing is dropped, not drawn as its own
punctuation.** `resolveBindable` resolves an absent binding to the empty
string, which is right and is not enough: what reached the page was the
author's boilerplate with nothing between it. `boundValueResolved` asks the
resolver whether any binding contributed, and both definition-list renderers —
jsPDF and HTML — ask the same function, so the two presentations cannot decide
presence differently.

**Stamp duty is the one tile where a zero needs a second question,** and the
answer is the canonical engine's own schedule stamp (`stampDutyScheduleYear` /
`stampDutyScheduleSource`), never a recomputation here. A `$0` liability that
was calculated is stated; a `0` that means "never calculated" is omitted.

### And the same rule where stored content is READ (RS-5a, 14 Sep 2026)

The owner's rule — *"N/A or unavailable — this never should be included in
reports"* — reached three more places, and
`docs/reports/RUNTIME_CONSOLIDATION.md` §8 carries the measurements. **The
placeholder scrub runs on read as well as on write**: `presentStoredMarkdown`
is applied at `projectRowForPdf` (both browser presentations), the template
adapter, the legacy server renderer and the on-screen document view, so the
"N/A" cells every stored Briefing carries (36–97 a report) are neither shown
nor printed, without a migration and without a stored byte changing. **An
ungraded record publishes no verdict** — the headline this section's earlier
correction left as *"Not available — insufficient verified evidence"* is
absent now, with the action and the sentence, and the verdict block draws
nothing. And **an unscored dimension draws no row**: "Not assessed" beside a
dash was a placeholder wearing a label.

### What is deliberately NOT done

**No post-processing.** There is no `.replace(/N\/A/g, '')` anywhere. Such a
filter would hide the defect, keep the empty frame the placeholder was sitting
in, and delete the word from a client's prose the first time somebody
legitimately wrote it. The source omits the field; the guard only proves it did.

**Prose is not scanned.** `clientOutputSentinel.spec.ts` checks structured
fields and the two template renderers, whole-token. Measured on the four
certification documents afterwards: **zero** structured placeholders, and the
three remaining whole-word matches are complete English sentences — *"A
dimension the assessment had no data for is left unscored"*, *"Authoritative
postcode-level demographic information was not available for this analysis"*.
Those are the honest disclosure this platform wants, and a blunter rule would
delete them.

**A dash is not scanned for either.** §1 forbids a dash *used as a
missing-value substitute* — a semantic condition no text scan can see.
Searching for one finds `-webkit-print-color-adjust`, `var(--font-body)` and
`SFMono-Regular` in every page's stylesheet (this test found exactly those on
its first run). The rule is enforced structurally instead: no whole field may
be nothing but a dash.

**A material gap is the readiness layer's, not the band's.** Omitting an
element is for an optional value. Where mandatory report content is absent, the
existing client-readiness gate stops the report — presentation is never used to
make an incomplete report look complete.

### Measured after the correction

| | before | after |
| --- | ---: | ---: |
| figures agreeing across A / B / C / D | 12 / 25 | **22 / 25** |

**Score / grade now agrees across all four** — the templates stopped printing
`N/A · out of 100`, matching the standard's correct omission. The three that
still differ are annual rent and annual net cash flow (the same facts the
standard publishes weekly) and net yield, which the standard publishes and the
masters do not lay out.

## What is NOT settled

These three are **deferred by decision**, not overlooked. The owner has stated
that the rendered output is not yet at the desired quality level, and that the
question this work answers is "does every presentation faithfully render the
same validated report without Cloud Run?" — not visual perfection. None of them
is to be started here.

**DEFERRED REPORT QUALITY — TEMPLATE MASTER GEOMETRY.** The Verdict page's
sentence overflows into the KPI tiles on all three template structures. The
master places a `text-block` at a fixed `y` and the KPI grid at another, and
`{{recommendation.gradedLine}}` on the certification record is 137 characters
where the geometry was fitted for about 90. It is **not a browser-renderer
regression**: `htmlRenderer` positions blocks absolutely at the same coordinates
and only the PAGE clips, so the WeasyPrint document overflows identically. The
fix belongs to the template library — the masters' fitted geometry, regenerated
through `templates:compass:generate` — and the class is already named in
`CLAUDE.md`: a declared block height is a promise the renderer keeps only if the
text is as short as the author assumed. The 50 masters are **not** to be
regenerated in this PR.

**DEFERRED REPORT QUALITY — TEMPLATE TOKEN / CONTRAST.** KPI tile labels are
muted-on-dark in the dark colourways and read faintly. A design-token question
rather than a renderer one. The colourways are **not** to be redesigned in this
PR.

**DEFERRED REPORT QUALITY — FULL REPORT PRESENTATION REVIEW.** A whole-document
review of typography, hierarchy, figure placement and page rhythm across both
presentations, to be run as its own programme. Two known inputs to it are
recorded above: the masters print `Assessment grade — N/A · out of 100` where
the record carries no score, and they do not lay out the net yield the
projection publishes to them.
