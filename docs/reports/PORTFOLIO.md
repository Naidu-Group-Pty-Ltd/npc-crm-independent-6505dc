# Portfolio Performance Review — the format's contract

The third format on the report design system, after the Borrowing Capacity
Snapshot and the 10 Year Cash Flow Analysis. Read
[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) first; this document covers only what is
specific to the portfolio review.

---

## 1. Findings against the shipping output

Read off `PortfolioAnalysisPDFGenerator.tsx` directly, not inferred. These are
what the migration answers.

**F1 — the contents page is a guess.** `pageEstimate` starts at 3 and is
hand-incremented as entries are pushed (`:1398–1416`); it is never reconciled
with `pdfDoc.getPageCount()` after drawing. Sections flow continuously through
`addContentPage`, so where a section lands is data-driven — any portfolio large
enough to spill a table pushes every subsequent number out of true.

**F2 — the contents page lists sections in the wrong order.** *Property Portfolio
Details* is second-to-last in the table of contents (`:1414`) and is drawn
**first**, at `:1528`, immediately after the narrative.

**F3 — three sections are drawn but never listed.** *Your Portfolio at a Glance*
(`:1493`), *Borrowing Capacity Assessment* (`:2423`) and the property table's own
heading never appear in the contents. Several listed entries also share a page
number with the entry above them — Risk Assessment with Financial Health, Market
Conditions with Interest Rate Sensitivity, Projections with Growth Opportunities
— asserting starts nobody checked.

**F4 — the inventory drops rows silently.** When the property table overflows,
the continuation resumes at
`propRows.slice(Math.floor((PAGE_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM) / 20) - 1)`
(`:1547`) — a row index computed from page geometry at a row height of **20**,
while the first `drawTable` on the previous page was called with a row height of
**22** (`:1543`). The resume index therefore does not match how many rows were
actually drawn, and the rows in between are never printed. There is also only one
continuation: a portfolio needing a third page loses everything past the second,
with nothing on the page saying so.

**F5 — the footer counts the cover.** `${pageNum} of ${totalPages}` where
`totalPages = pdfDoc.getPageCount()` (`:3033`); the loop skips *drawing* on page
0 (`:3020`) but never subtracts it, so the contents page reads "2 of N" with N
including an unnumbered cover.

**F6 — the cover carries our company name on every tenant's report.** Page 0 of
`public/templates/NPC_PDF_Template-6.pdf` is copied in wholesale (`:1278–1312`)
with the title overlaid. The same class of defect as `BORROWING_CAPACITY.md` F1.

**F7 — no fidelity test of any kind.** No golden, no page-count assertion, no
fixture. The only tests naming the file assert it was moved between components.

F1 through F5 are not fixed one at a time. They are answered structurally: the
contents page is derived from the spine by `contentsEntriesFor`, so it cannot
list a section that was not built or order them differently from how they print;
page numbers come from `@page` counters, so nothing can claim a page it does not
occupy; and the holdings matrix is generated from `holdings.length`, with a
per-property commentary cap that says on the page when it bites.

---

## 2. Where the boundary is

Both prior formats have one. Cash Flow does not trust the browser because the
adviser's overrides are unsaved. Borrowing Capacity does not let the browser
decide the contents at all.

Here the browser is not the question — everything the document says is already in
two rows, so the caller sends one identifier and the server reads the rest. The
boundary that matters is a different one:

| | Trusted as | Why |
| --- | --- | --- |
| `report_data.portfolioMetrics` | figures | Computed arithmetic (`generate-portfolio-analysis:225`) |
| `report_data.propertyAnalyses[]` | figures | Computed arithmetic (`:272`) |
| `report_data.analysis` | **nothing** | Stored model output, parsed out of a fenced code block with no schema validation (`:677–695`) |
| `portfolio_reviews.*` | **nothing** | A second, independent pass over the client's live records |

So `normalise.pure.ts` reads the analysis the way Cash Flow reads the wire: every
field defensively, every figure given a unit, **a missing or malformed block
dropping its section rather than rendering `undefined` onto letterhead.** A
shorter document is a fine outcome; a heading over the word "undefined" is not.

Two things are deliberately *not* defensive. A missing figure in
`portfolioMetrics` is a real fault and surfaces as one. And the client's name is
read from `clients` through `CLIENT_NAME_COLUMNS`, never from
`report_data.clientName`, because a name the caller stored is a name the caller
can change.

### The two sources disagree, and the document says so

This is the finding that shaped most of the payload. `portfolio_analysis_reports`
and `portfolio_reviews` are produced independently, on different dates, from
different reads of the client record. On one real pair three days apart:

- the analysis says the portfolio is worth $1,400,000 and returns $7,569 a month;
  the review says $1,505,000 and $1,821;
- the analysis rates a property "Good" while the review classes the same property
  an "Underperformer";
- the analysis writes "Positive net monthly cashflow of $901.84" for a property
  whose review rubric says "Negative cash flow";
- the two spell the same address differently — `17 Cahill Street, East Innisfail`
  against `17 Cahill Street, Innisfail`, `Trunding` against `Trungi`.

None of that is corruption. The answers:

- **Address matching falls back to the street line**, and only when that line is
  unambiguous on both sides. Exact matching silently scored half the properties
  and printed em dashes for the rest, which reads as a review that did not score
  them.
- **The review's verdict is kept apart from the analysis's**, attributed and
  dated. Merged they were one self-contradicting bullet list; separated they are
  two assessments and the disagreement is itself information.
- **The ranking table shows both raters' columns** when a review exists.
- **The review section states both dates** and says that where the figures differ
  neither is wrong, because they were taken at different times.

---

## 3. What the document is made of

Nine sections, from the legacy's twenty content blocks. Nine is not a trim of
twenty; five of those pairs are one subject drawn twice, or drawn in two places
because the drawing order forced it.

| Section | Slot | Pages | Appears when |
| --- | --- | --- | --- |
| Cover | `cover` | 1 | always — client as the title, tenant's mark |
| Contents | `contents` | 1 | always — generated from the spine |
| Where the portfolio stands | `chapter` | 2 | always |
| What the portfolio is made of | `chapter` | 2 | `compositionAnalysis` |
| Every property | `wide-table` | 1 + ⌈n/18⌉ | always |
| How each property is performing | `chapter` | 1 + min(n, 20) | `propertyRankings` |
| Financial health and risk | `chapter` | 2 | `financialHealth` or `riskAssessment` |
| Borrowing capacity and headroom | `chapter` | 1 | `borrowingCapacityUtilisation` |
| Market and projections | `chapter` | 3 | `marketConditions` or `projections` |
| What to do next | `chapter` | 2 + ⌈actions/12⌉ | `growthOpportunities` or any action |
| This review | `chapter` | 2 | a completed `portfolio_reviews` row |
| Contact & disclaimer | `closing` | 1 | always |

Every budget above was **measured**: all 21 stored reports were rendered through
WeasyPrint and the section boundaries read off the running heads. They land
between 18 and 26 pages. The budgets remain estimates — section length is driven
by how much prose a model wrote, and two reports for the same client a week apart
differ by a page — and exist so `validateSpine` catches a document that has
collapsed or run away, not so it can predict a page number. Nothing in this
format prints one.

### The archetype's band is loose, deliberately

`portfolio-performance` carries `pageBudget: [7, 46]`, far wider than the
measured 18–26. It is the one archetype whose length scales with its subject: a
portfolio is between one and sixty properties.

- The **ceiling** is a runaway guard. With `MAX_HOLDINGS` properties and
  commentary capped at `DETAIL_CAP`, the spine tops out in the low forties. A
  band tight enough to be a page prediction would refuse a legitimate large
  portfolio.
- The **floor** is the arithmetic minimum: cover, contents, where-the-portfolio-
  stands, one page of matrix, closing. A report whose `analysis` came back empty
  produces exactly that, and it must render — the figures in it are the
  deterministic half, and refusing would turn a content problem into an outage.
  Found by rendering one.

### Dropped, deliberately: the full Borrowing Capacity Assessment

Legacy section 14 delegates to `borrowingCapacityPdfLibSections.ts` and redraws,
in a second set of primitives inside this document, a format that now has its own
migrated route, payload contract and tests. Reproducing it here is exactly how
one subject came to have five implementations. The capacity section keeps the
figures that belong to a *portfolio* view — assessed capacity, debt deployed,
headroom, utilisation — and says on the page that the assessment itself is the
Borrowing Capacity Snapshot, produced separately. The legacy generator keeps
drawing the full section, unchanged, for anyone who wants it.

---

## 4. The charts

Three. A chart earns its page only by answering something the holdings matrix
answers slowly, and in a table of thirteen lines there are three such questions.

**Composition donut — where the money is.** Concentration is a proportion, and
reading it off the matrix means ranking every holding by eye. Segments are
labelled by address, not type: two "investment" segments say nothing about which
holding carries the portfolio. Below three holdings it returns `''` — two is a
ratio and reads better as a sentence.

**Yield against leverage — which properties are the problem, and whether for the
same reason.** The rankings list them 1…n in prose, but neither the list nor the
matrix shows that two low-ranked holdings are both high-LVR *and* low-yield — one
problem, one action — while a third is low-LVR and low-yield, which is different.

Two things about this chart were found by rendering it:

- Its dividers are thresholds, not the geometric middle. The default divider is
  half of the largest value plotted, which moves whenever a property is added and
  stands for nothing. The vertical line is **80% LVR** — the loan-to-value at
  which Australian lenders price mortgage insurance, which is not this module's
  invention and means the same on every client's report. The horizontal line is
  the portfolio's own average yield, because yield expectations differ by market
  and there is no equivalent constant. The caption says which is which.
- Points near the right edge had their labels clipped off the page, so a chart of
  a highly-geared portfolio silently stopped naming the holdings that made it
  one. Labels now flip to the left of the dot past 72% of the plot, and quadrant
  captions anchor to the box's corners so a divider at a real threshold cannot
  squeeze one out.

Owner-occupied holdings are excluded — the producer stores `'N/A'` for yield and
the normaliser reads that as absent rather than as zero — and the caption says how
many, because a chart that silently drops a client's own home lies about the
portfolio's size.

**Capacity bullet — how much room is left.** The bar is debt deployed and the line
is the assessed capacity, so being over the limit reads as the bar crossing the
line. The legacy draws the same fact as a progress bar that turns red at 80%:
colour carrying the meaning, beside prose that may say the position is
comfortable.

Four were considered and rejected, which is the more useful half of the record:

- A **waterfall** from portfolio value to equity, or to the projection. The
  Borrowing Capacity format deleted its waterfall after it totalled ~$8,150
  against the $1,840 printed beneath it. Here it would be worse: the projection
  is model-written, arriving as finished numbers with no intermediate steps, so
  a waterfall would have to invent the steps that reconcile them.
- A **score wheel** over the review's five scores. The data begs for it and the
  axes are not independent — the review wizard derives growth potential from the
  health score and copies the health score into cash flow for owner-occupied
  holdings. A radar over numbers computed from one another draws a shape that is
  an artefact of the formula.
- **Bars of per-property cash flow.** That is the matrix's cash-flow column drawn
  a second time.
- A **gauge** on the headline health score, which is already the largest thing on
  the page in the KPI strip.

No chart is load-bearing. Each returns `''` when its data is absent or
degenerate, and the section prints its table either way.

---

## 5. The render path

`render-portfolio-review-pdf` holds the six properties the other two routes hold,
in the same order.

1. **Auth is a human, then that human and this client.** `verifyAuthOrNativeUser`
   establishes the identity; `canAccessClient` establishes the relationship, with
   a `portfolio_reports / can_view` fallback because 759 of 766 clients have a
   null `created_by` and ownership alone would refuse almost everyone. A caller
   with neither gets **404, not 403**: whether a given report exists is itself
   something they are not entitled to learn.
2. **The client's name is read, not accepted**, through `CLIENT_NAME_COLUMNS`.
   Spelling those columns by hand is what shipped the Snapshot's 404
   (`BORROWING_CAPACITY.md` §14).
3. **A failed read is not a missing row.** Every query checks `error` before
   `data` and throws with the message the database gave. A `select` naming a
   column that does not exist returns neither data nor error to `maybeSingle`,
   and calling that "not found" cost a full debugging cycle.
4. **The brand is snapshotted, then referenced** — `upsert_report_brand_snapshot`
   dedupes by content fingerprint.
5. **Resources are checked before the POST** — `assertSafeRenderResources` runs
   even though this function built the HTML, because an asset arrives from a
   tenant's settings form and the guard belongs on the boundary.
6. **No fallback, and every attempt leaves a row** in `portfolio_review_renders`.

**It is not metered.** `generate-portfolio-analysis` runs under
`withReportMetering({ kind: 'report.portfolio-review' })` because it reserves
tokens and asks a model. Typesetting a row that already exists asks nothing of
any model, so re-rendering a saved report is free and the new menu items carry no
cost estimate.

**It does not write `portfolio_analysis_reports.pdf_file_path`.** That column is
what *publish to client portal* reads (`manage-client-data/index.ts:540–609`,
uniqueness-guarded by `20260724000000_prevent_duplicate_portfolio_publications.sql`).
Pointing it at a document from a different renderer would silently change what
every future publication sends a client. Switching that over stays a separate,
deliberate decision. Storage goes under
`portfolio-reports/<clientId>/typeset/<date>/<uuid>-<name>` — the prefix the
format already uses, with an extra segment so nothing written here can collide
with a file `pdf_file_path` points at.

`portfolio_review_renders` records the artefact and **references** both source
rows rather than copying their contents, so any document it names can be
reproduced without creating a second answer to what the review said.

---

## 6. The legacy generator stays — and was never opened

`PortfolioAnalysisPDFGenerator.tsx` (3,878 lines, pdf-lib) and its borrowed
section pack `src/utils/borrowingCapacityPdfLibSections.ts` (940 lines) are
**not touched by this work at all**. Neither are its three mount sites:
`ClientDetailsModal.tsx`, `ClientPortfolioActions.tsx` and
`review-wizard/GenerateReportStep.tsx`. The existing *Generate → Download & Save*
flow works exactly as it did.

That is a stronger guarantee than the other two formats got, and it is not
generosity — it is forced. That component has **no importable entry point**.
There is no `generatePortfolioPDF({ returnBlob: true })`; the only way to get the
PDF is to mount the component and click through. Both prior formats offered
"legacy layout" inside a shared control by calling exactly such a function, and
that option does not exist here.

Two consequences follow:

- `requestPortfolioReview` takes **no legacy fallback**. There is nothing to call,
  and nothing is being replaced. An undeployed route fails with a message naming
  the button that works.
- `PortfolioReportDownloadButton`'s second item is the **stored** PDF at
  `pdf_file_path` rather than a re-render. Where a report has none, the item stays
  visible and disabled with the reason — a missing item reads as a feature that
  does not exist, a disabled one reads as the true and actionable thing.

`src/lib/reports/portfolio/__tests__/legacyPathStays.spec.ts` asserts all of the
above structurally, and was verified by breaking what it guards.

### A side effect worth having

Every existing item in the reports-list row menu is
`disabled={!report.pdf_file_path}`, and **7 of the 21 saved reports have no
stored PDF** — they are completely un-downloadable today. The typeset render
reads `report_data`, not the file, so those seven become downloadable for the
first time.

### Where it is offered

| Surface | Added |
| --- | --- |
| `PortfolioAnalysisReportsList.tsx` row menu | "Download review (typeset)", first, ungated |
| `ClientReportsTab.tsx` portfolio rows | the shared control, compact appearance |
| `review-wizard/GenerateReportStep.tsx` | a sibling card for the latest saved report |

It is deliberately **not** added inside the generator's own preview dialog
(`PortfolioAnalysisPDFGenerator.tsx:3222`), even though that is where the two
renderers would sit most naturally side by side. At that moment the analysis
exists only in component state — the `portfolio_analysis_reports` row is not
inserted until `downloadPDF` runs (`:3113`) — so a server route that reads the
persisted row would have nothing to read.

---

## 7. Tests

| File | Asserts |
| --- | --- |
| `portfolioSourceOfTruth.spec.ts` | one bridge per canonical module; import discipline; purity |
| `normalise.spec.ts` | units attached, figures derived, a malformed row named rather than rendered, the review folded in and absent cleanly, the two sources kept apart |
| `render.spec.ts` | contents matches what is built, the inventory holds every property, the cover is the tenant's, escaping, an invalid spine refused, the spine inside its band for 1 to 60 properties, no colour in the format's own modules |
| `legacyPathStays.spec.ts` | the generator, its section pack and all three mount sites still exist and are still wired; the new path never calls it, never falls back, never writes `pdf_file_path`, and is not metered |

Four guarded properties were verified by deliberately breaking them and watching
the right test fail: re-gating the typeset menu item on `pdf_file_path`, deleting
the generator from a mount site, removing the street-line fallback in address
matching, and merging the review's verdict back into the analysis's.

There is no golden PDF. The 21 stored reports were rendered and read, and what
that found is recorded above; a committed golden of any of them would be a
committed set of a real client's financials.

---

## 8. Deployment

Two manual steps, in this order:

1. Apply `supabase/migrations/20260816000000_portfolio_render_path.sql`. The DDL
   was executed against production inside a transaction and rolled back, so it is
   known to run.
2. Deploy `render-portfolio-review-pdf`.

Until both are done the new menu items fail with a message naming the legacy
button, which keeps working throughout.

> Still outstanding from earlier work: `render-investment-report-pdf` is deployed
> at v9 from 31 July, so the `ReferenceError` fix has not shipped. Investment
> report PDFs keep failing until that function is redeployed.

---

## 9. The Template Library masters

Separate from everything above. Sections 1–8 describe the format's *own*
generator — `render-portfolio-review-pdf`, nine sections, its own normaliser.
This section describes the same report drawn as **50 Template Library masters**
in the ten Investment Compass design families, which is a different destination
for the same data: an operator picks a design, previews it, and can activate it
for live rendering. Both stay.

| | The format's generator | The library masters |
| --- | --- | --- |
| Where | `supabase/functions/render-portfolio-review-pdf` | `template_library_entries`, `report_type: 'portfolio'` |
| Sections | 9, paginating | 7 fixed pages, no reflow |
| Data path | `normalise.pure.ts` | `portfolioProjection.pure.ts` → `portfolioAdapter` |
| Second source | folds in `portfolio_reviews` | reads `portfolio_analysis_reports` only |
| Design | one, the NPC design system | ten families × five variants × ten colourways |

### The projection, and what it will not say

`supabase/functions/_shared/portfolioProjection.pure.ts` restates a stored row
in the vocabulary a template binds. It calculates nothing the analysis did not
already compute; the only derivation is monthly × 12.

Three rules it follows, each answering something the live table does that its
column names do not advertise:

- **A leaf is published only when it is genuinely a string, and the names do not
  tell you which leaves those are.** `analysis.executiveSummary` is an *object*,
  not a paragraph. Inside `riskAssessment`, `concentrationRisk`, `vacancyRisk`
  and `interestRateSensitivity` are single sentences while `marketRisks` (2–4)
  and `mitigationStrategies` (4–5) are **arrays** — and all four of
  `strategicRecommendations`' fields are arrays, the three horizons included,
  at 1–4 entries each. This was read off the table, and the first draft here got
  it wrong in the safe direction: refusing the five arrays as non-strings would
  have left two fields of the risk page and three of the actions page blank on
  every report ever generated. The unsafe direction prints `[object Object]`.
  Both are silent.
- **Numbers are coerced, not read.** `propertyAnalyses[].lvr` and `.grossYield`
  are numeric *strings* — `"83.7"`, `"6.74"` — on all 66 stored elements.
  Meanwhile 11 of those 66 carry `netMonthlyCashflow`, `annualCashflow` and
  `monthlyRentalIncome` as JSON null (owner-occupied holdings with no rental
  data), and those stay absent: `$0` a month is a claim, and the wrong one.
- **`health_score` is a score out of 100, not a percentage.** It runs 25–90
  across the 21 stored reports. The `percent` filter does not multiply, so
  setting it with `| percent` would print "68%" — wrong, and not wrong enough to
  notice.
- **The risk assessment keeps its stored key names.** `risk.vacancy` already
  means "reaction to three months vacancy" to the voice catalogue — a client
  tolerance, not a portfolio exposure — so the projection publishes
  `vacancyRisk`, `marketRisks`, `concentrationRisk` and the rest verbatim. One
  key cannot answer two questions.

### F4, said out loud

The masters draw a **fixed four-row inventory**, which is the observed maximum
(`total_properties` runs 1–4 across all 21 reports), and a conditional block on
the same page states the shortfall when a portfolio holds more:

> The portfolio holds 6 properties and the table above draws 4.

That is finding **F4** answered rather than reproduced. The complaint against
the shipping generator is not that it truncates — a fixed-position page model
has to stop somewhere — it is that it drops rows "with nothing on the page
saying so". The block costs its height whether or not it renders, because a
conditional in a layout that cannot reflow has to.

### The two voice templates that came with the report type

`portfolio-review` and `portfolio-comparison` are seeded voice templates
carrying `report_type: 'portfolio'`. Registering the adapter flipped both to
`production_ready` — `deriveEntryFacts` reads the report type, not the
bindings — so the projection also publishes the older vocabulary
`portfolio-review` binds: `portfolio.count`, `portfolio.lvr`,
`portfolio.grossYield`, `portfolio.netCashFlow`, `portfolio.holdings[]`,
`strength`, `watch`, `narrative`. Those are mechanical restatements —
`lvr` and `grossYield` are ratios of two stored totals, and are deliberately
*not* the mean-of-property `averageLvr` / `averageYield` beside them.

Four of its leaves stay unresolved, because the analysis has no counterpart and
a plausible guess on a client's page is worse than a gap: `growth12m`,
`scores.*`, `recommendation.{headline,body}` and the owner/timing on each
action. `portfolio-comparison` binds `drag.*`, `ranking.*` and `equity.*` —
per-property growth, maintenance history and equity-release scenarios, none of
which is in `portfolio_analysis_reports` at all — so it remains a preview
document in practice whatever its card says.

### Tests

| File | Asserts |
| --- | --- |
| `portfolioProjection.spec.ts` | units and magnitudes, typed columns beating their jsonb copies, non-string leaves dropped, performers read in either case and omitted when null, an empty row publishing nothing rather than zeroes |
| `portfolioCatalogue.spec.ts` | 50 masters across 10 families, slugs disjoint from the other two catalogues, every bound **leaf** published, the sample's totals summed from its own holdings, colourway changes nothing but colour, and the inventory notice appearing only when it should |
