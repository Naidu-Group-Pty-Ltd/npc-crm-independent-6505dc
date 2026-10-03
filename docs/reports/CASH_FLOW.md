# 10 Year Cash Flow Analysis — the format's contract

The second format on the report design system, after the Borrowing Capacity
Snapshot. Read [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) first; this document
covers only what is specific to the cash flow projection.

---

## 1. Where the boundary is, and why it moved

The Snapshot is computed server-side, and its contract document says why: *"for a
document that tells someone how much they can borrow, the contents are not the
browser's to decide."* That reasoning does **not** carry over here, and applying
it anyway would ship a worse document.

A borrowing capacity assessment is a saved row in
`borrowing_capacity_assessments`. A cash flow projection is not.
`CashFlowAnalysisModal` lets an adviser override any of ten fields
(`EDITABLE_FIELDS`) in any of ten years, live, and those overrides are not
persisted until they press save. A server that recomputed from
`investment_reports.financial_calculations` would produce a *different* ten years
from the one the adviser just reviewed, and the client would receive numbers
nobody looked at.

So the split is drawn one step further out:

| | Owner |
| --- | --- |
| The arithmetic — amortisation, growth, tax | The browser, as it already does |
| The document — brand, palette, typography, page geometry, disclaimer | The server |
| Storage, signing, the render ledger | The server |
| Deciding whether a payload *is* a projection | The server |

Everything the legacy jsPDF generator gets wrong is on the server's side of that
line.

**Not trusting is separate from not computing.** `normalise.pure.ts` rejects a
payload that is not a complete, finite, correctly-shaped projection, and names the
field: `years[3].rentalIncome must be a finite number` costs an hour less than
`invalid payload`. Equity, LVR, the weekly figures, the year-one block, the
ten-year outcome and the opening paragraph are all **derived** rather than
accepted — a smaller surface for the caller to get wrong, and the reason the
sentence a client reads first cannot disagree with the table under it.

---

## 2. What the document is made of

| Section | Slot | Pages | Content |
| --- | --- | --- | --- |
| Cover | `cover` | 1 | Property as the title, client in the meta, tenant's mark |
| The purchase and the first year | `chapter` | 2–3 | Lede, KPI strip, the legacy **Input Summary**, **Total upfront costs**, **Total overall expenditure to completion**, year-one lines |
| The construction schedule | `wide-table` | 1 | New builds only: land, build, total project, interest during construction, and the staged progress-payment table (§9) |
| The *n*-year projection | `wide-table` | **1** | ONE landscape table — the legacy rows under the legacy headings, with a Today column (§9) |
| Value, debt and equity | `chapter` | 2 | Outcome KPIs, equity-build chart, ending table, cash-position chart |
| What this assumes | `chapter` | 1 | Assumptions, notes, the projection caveat |
| Contact & disclaimer | `closing` | 1 | The tenant's company block |

The `assumptions` section appears only when there is something to say; the spine
validator would otherwise fail a document that claimed a section it did not have.

### Why the matrix was two tables (superseded — see §9)

Fourteen lines is **one row more than a landscape page holds**. The first render
of this document put "After tax, per week" alone on a page of its own. Splitting
by what the rows are about — the position, then the cash flow — fits, and reads
better than the fourteen-row wall: the two groups answer different questions and a
reader was already scanning for the boundary between them.

That split then exposed a second defect in the shared stylesheet: `page:` only
forces a break when the page **name** changes, so two adjacent
`.page-landscape-table` sections ran together. `css.pure.ts` now emits
`.page-<name> + .page-<name> { break-before: page; }` for every named page,
generated from the same table as the rest of the page rules.

---

## 3. The charts

Two, and only two. The projection table already states every figure; a chart earns
its page only by answering something the table answers slowly.

- **Equity build** — a stacked column per year. Reading value-against-debt off the
  table means tracking two columns down ten rows and subtracting each pair.
  Stacked rather than paired because the two parts *sum* to the property's value:
  a stack says "the same thing divided", paired bars say "two things compared".
- **Cash position** — horizontal bars of after-tax cash flow, each with its figure
  printed beside it, so the chart still reads in monochrome and to a reader who
  cannot separate the two hues.

Neither is load-bearing: both return `''` when the data is absent or degenerate,
and the section prints its table either way.

The debt segment uses `withAlpha(ink, 0.22)`, not `groundAlt`. `groundAlt` is a
page tint — at column size it disappears against paper, and the first render read
as plain bars growing rather than as a value being split.

---

## 4. Two modules that moved

`measure.pure.ts` and `brand.pure.ts` were written for the Snapshot and neither is
about borrowing capacity:

- A `Measure` is the design system's vocabulary. This format needs the same
  `$1,240/mo` against `$14,880 pa` distinction, and a second implementation would
  be a second set of rounding rules on the same client's money. Now
  `reportDesign/measure.pure.ts`.
- `resolveSnapshotBrand` reads a brand snapshot and returns a palette, a company
  block, a masthead and a lockup — none of which know what document they are
  about. Now `reportDesign/documentBrand.pure.ts`.

Both had to move: `cashFlowSourceOfTruth.spec.ts` (like its Borrowing Capacity
twin) forbids a format module from importing anything but its siblings and
`../../reportDesign/*.pure.ts`, because Edge Functions resolve relative `.ts`
paths and nothing more.

`aud/week` is new. The headline of this report is what a property costs a week,
and the legacy generator prints that figure beside an annual one with nothing to
tell them apart.

---

## 5. The render path

`supabase/functions/render-cash-flow-pdf/index.ts`

1. **Auth is a human, then a permission.** `verifyAuthOrNativeUser` establishes
   identity — the service-role identity is refused because it is not a person —
   and `requireModulePermission(reports, can_view)` establishes the right. That is
   the same gate `render-investment-report-pdf` applies to the same report.
2. **The address and the client name are read, not accepted.** A name the caller
   supplies is a name the caller can change, and the address on a financial
   projection is not a display preference.
3. **The brand is snapshotted, then referenced.** `upsert_report_brand_snapshot`
   dedupes by content fingerprint, so re-rendering an unchanged brand reuses the
   row.
4. **Resources are checked before the POST.** `assertSafeRenderResources` runs on
   HTML this function built, because the assets in it came from a tenant's
   settings form — the guard belongs on the boundary, not on the trust.
5. **There is no fallback.** If WeasyPrint fails, this fails. A silent downgrade
   ships a client a document nobody approved.
6. **Every attempt leaves a row** in `cash_flow_renders`, which is the difference
   between "the client says the PDF never arrived" and an answer.

The projection itself is deliberately **not** stored: `cash_flow_analyses.analysis_data`
already holds the saved form, and a second copy would be a second answer to "what
did this report say".

### The filename

`10 Year Cash Flow Analysis - <address> - 01 Oct 2026.pdf`, through
`readableFileName`, the rule every report's download follows (§12). It was
`Cash_Flow_Analysis_<Address>_<YYYY-MM-DD>.pdf` until 1 Oct 2026. The date still
lets a client who receives two revisions of the same property tell them apart.
The storage key is the same name made URL-safe (`storageSafeFileName`), because
a key travels in signed URLs.

---

## 6. The legacy generators stay

Explicitly, and under test. `render.spec.ts` asserts that
`exportSingleReportPDF`, `exportComparisonPDF`, `exportAiAnalysisPDF` and
`handleExportExcel` are all still present in `CashFlowAnalysisModal`, that it
still imports jsPDF, and that the legacy item is still in the export menu.

The Borrowing Capacity Snapshot carries the same commitment, in the shape its own
surfaces need — see [`BORROWING_CAPACITY.md` §13](./BORROWING_CAPACITY.md). The
difference is only that this format has one export menu and that one has five
separate buttons, so there the choice lives in a shared control.

The comparison PDF and the AI analysis PDF are **not** migrated. They are
derivative documents built from the same modal, and neither is the artefact the
business sends. If they are migrated later, they get their own archetypes rather
than being bolted onto this one.

---

## 7. Deployment

`render-cash-flow-pdf` must be deployed and
`supabase/migrations/20260815000000_cash_flow_render_path.sql` applied before the
menu item does anything. Until then `requestCashFlowPdf` falls back to
`exportSingleReportPDF` and says so — on a missing *function* only, never on a
400 or a 500, because falling back on a real failure would hand a client a
document produced by the generator this format exists to replace while telling
nobody.

---

## 8. The Template Builder path — a second document, from a different source

Everything above is the **render route**: the browser computes a projection, the
adviser reviews it, and `render-cash-flow-pdf` typesets exactly that payload.

There is now a second way this format reaches a client, and it does not share a
byte of that pipeline. `/admin/template-builder` can activate one of 50 design
templates for `report_type = 'cashflow'`, and those are driven by
`cashFlowAdapter`, which is given a **report id and nothing else**.

That difference is the whole of §1 read backwards. The adviser's overrides are
never persisted, so an adapter handed an id cannot recover the projection anyone
reviewed. What it can recover is the one the report itself stores:

| | Render route | Template Builder route |
| --- | --- | --- |
| Input | The browser's live payload | `investment_reports.financial_calculations.projections` |
| Adviser overrides | Included | Not available, and not approximated |
| Reports it can serve | Any, from the modal | 162 of 1,182 |
| The rest | — | `buildBindingContext` returns null; the legacy generator keeps them |

Both routes stay. Neither is a fallback for the other.

### The four figures the projection refuses to publish

`_shared/cashFlowProjection.pure.ts` carries the measurements; this is the
summary, because it is the reason the templated document is *shorter* than the
record it is drawn from.

| Stored field | Contradicts | Measured |
| --- | --- | --- |
| `keyMetrics.annualNet` / `weeklyNet` | `projections[scenario][0].cashFlow` — both are year-one cash flow | Median disagreement **$24,793**; agree on **0 of 162** |
| `initialCosts.totalUpfront` | The initial costs listed beside it | Equal on **29 of 161**; residual −$80,740 to +$93,000 |
| `annualCosts.totalAnnual` | Its own seven components | Equal on **18 of 162**; residual −$25,020 to +$14,003; exactly 0 on 13 |
| `initialCosts.propertyValue` | Its own series | **$3** on one report whose year-one projected value is $780,000 |
| `assumptions.capitalGrowth` | The growth the series was built at | Recorded on 69; matches the series' 4% on **3** |
| `loanDetails.interestOnlyPeriod` | A balance that amortises from year one | Recorded on 93; the balance falls in year one on **161 of 161** |

None of these is a bug to be fixed here — they are what the record holds, and
"fixing" one would mean this route disagreeing with the render route about the
same report. They are simply not bound, so the templated pages carry **no total
row** under either cost table. That looks like an omission and is the opposite: a
total wrong by $93,000, printed under the figures it claims to total, tells a
client the document cannot add up and gives them no way to tell which line is
wrong.

The growth rates *are* stated, and they are derived from the series rather than
read from `assumptions` — `(value₁₀/value₁)^(1/9)` is **2.000, 4.000 and 6.000**
on all 162 reports and `(rent₁₀/rent₁)^(1/9)` is **2.000, 3.000 and 4.000**,
without exception. A page headed "what this rests on" is a checkable claim about
the document's own arithmetic, so it is read off the arithmetic.

### No client, and what that cost elsewhere

`investment_reports` has **no `client_name` column**, and `client_property_id` is
set on 2 of the 162. So the templated document is addressed to a property.

Finding that out found a live defect in two formats that had already shipped. An
unresolved binding renders as the **empty string**, not as a visible `{{…}}`, so
the Borrowing Capacity and Comparison masters — whose cover title was
`{{client.name}}`, against tables that have no client-name column either — shipped
a cover with no title and a running foot beginning " · ". Both now name what the
document is about, and `cashFlowCatalogue.spec.ts` asserts which of the five
formats may bind a client at all.

See [`../template-library/07-investment-compass-families.md`](../template-library/07-investment-compass-families.md)
for the design system these 50 masters are drawn in.

---

## Template Builder rendering carries the series on screen

The stored-series gate (`matchStoredScenario`) was the first answer to
templating this format, and it was correct and almost never satisfied: the
modal recomputes ten years live, so a chosen template silently fell back to
the composer on nearly every download. The answer now is a channel rather than
a gate. The adapter accepts the caller's reviewed `WireProjection` as
`payload` — the same wire the composer receives — via
`src/lib/reports/cashFlow/liveProjectionRow.ts`, which converts it to the
stored-row shape so `projectCashFlow` publishes it under the vocabulary every
master binds. Three rules: a year missing any drawn field refuses the whole
series (the caller falls back to the composer, which validates server-side);
`cashFlow` maps from `afterTaxAnnual` because the composer's opening sentence
is the after-tax position and the two documents must lead with the same
figure; and the projection is labelled `reviewed` / "Adviser-reviewed" with
the stored scenario-comparison blocks withheld — a matched series still routes
under its named scenario, so "Moderate" is only ever printed when the series
is the stored moderate one.

### The template render never reads the database

The payload channel above was first sent *only* when the on-screen series did
not match the stored one. That left the matched case — and it is the case a
person hits when they have not overridden anything — depending on the adapter
re-reading `investment_reports`. That read can be refused for reasons which
have nothing to do with the document: RLS under this app's custom cookie auth,
a module permission on the broker, an unreachable function. And a refused read
is **indistinguishable from "this record cannot be templated"**, so the chosen
template silently produced the standard composer's document instead.

So the modal now sends the payload on **every** render, and the adapter serves
it **before** it loads anything: `resolveRoutingContext` and
`buildBindingContext` both check `liveRowFromPayload` first and only fall back
to a read when no payload was supplied. Everything the template needs is
already on screen — the ten years, the address for the title, and the scenario
name when `matchStoredScenario` proved one — so a templated cash flow render
now touches the database for exactly two things: the user's template selection
and the template's own schema. Neither is optional and neither is this record.

The proved scenario travels with the payload so the honest labelling survives:
a matched series still prints "Moderate", and only a hand-shaped one is
labelled "Adviser-reviewed".

---

## 9. Legacy parity, the construction schedule and the one-page projection (28 Sep 2026)

The owner's rule: the typeset document follows the legacy export's process
exactly, a new build carries its **construction schedule**, and the ten-year
projection is read **on one page**. Measured against the two 37 Bolin Street
documents of 28 Sep 2026, the typeset one had printed nine of the legacy's thirty
inputs, neither expenditure table, no construction schedule on any report, and a
projection split over two landscape pages behind a header page of its own.

**One implementation, three readers.** The schedule, the two expenditure tables
and the Input Summary are pure modules beside the composer —
`constructionSchedule.pure.ts`, `expenditure.pure.ts`, `inputSummary.pure.ts` —
and the modal's on-screen view, its jsPDF export and the typeset document all
read them. The schedule is the modal's old inline `useMemo` MOVED:
`constructionSchedule.spec.ts` runs the pre-refactor algorithm verbatim against
the module over 3,000 generated cases, row for row and to the cent. The
upfront/overall tables were written three times inside the modal and had
drifted (the on-screen copy left inspections out); they are one call now.

**The browser sends the case; the server derives the tables.** `WireProjection`
carries `inputs` (every figure the summary prints, the land/build split and, for
a new build, the six stage percentages and months) and `settlement` (year 0 —
the Today column). `normalise.pure.ts` computes the schedule and the tables from
those with the same modules; it never accepts a table of figures. Both are
optional, so an older client still renders the purchase table as before.

Three rules bite.

- **Only a new build with a build contract is staged.** `isNewBuild` and a build
  price the record states (or land lets it be derived) — never the purchase
  price (QA-13). The adviser's export switch hides the table and keeps the
  construction interest in the costs, as the legacy did.
- **Every total is the sum of its own printed rows**, and a zero row is left out
  rather than printed as `$0`. The schedule's interest is printed to the cent
  because its footer is the sum of rounded rows.
- **Capital growth over the term is measured from TODAY.** It was year ten less
  year ONE, which dropped a year of growth: $1,094,495 printed on Bolin where the
  legacy's (correct) figure is $1,177,745.

**One page is a measurement, not a promise.** The matrix — a header, twenty-three
lines and four headings — is set at a compact row height on the landscape page,
opened with its own section header (the chapter opener's deep top padding is
removed there, and the header is kept with the table). Rendered in WeasyPrint
69.0 over the standard document and all 50 catalogue designs, established and
new build (102 documents): the header, the whole table, and — for a new build —
the schedule with its footnote each land on exactly one page. A 24-month build
(the longest the schedule allows) did not fit under the KPI strip, so past
`LONG_SCHEDULE_ROWS` the strip becomes the legacy's one summary line and the rows
tighten; re-measured, 50 of 50 on one page. The `cf-` selectors outrank a
design's `table.data` rules, so a chosen template restyles colour and rules and
never the row height this page depends on.

## 10. A build planned on a land-only purchase (28 Sep 2026)

A land-only report had no route to a construction schedule. The build price
was offered only to a report recorded as a new build, and the cash flow staged
a contract only where `buildType === 'new_build'`. So an adviser whose client
bought a lot and meant to build on it had to re-enter the case as a different
kind of property to see the drawdown, the interest carried during
construction, or a projection of the finished home.

The owner's rule: on a land-only report, a switch in the **Cash Flow
Analysis** says whether the client is going ahead with a build. Switched on,
it adds the construction payment schedule. The switch is
`CashFlowPlannedBuildPanel`, drawn only on a land-only report. It takes the
build contract price, the build duration and the weekly rent once built. It
drives the analysis live and is written to the report on **Save**, like every
other edit in that workspace.

`plannedBuild.pure.ts` is the one statement of what the switch means, and it
adds **no second method**. `withPlannedBuild` re-reads the case as the new
build it becomes and hands it to the same `readBaseFinancials`,
`buildConstructionSchedule`, `acquisitionExpenditure` and projection every new
build uses:

- **Land** is the stated land price, else the price paid for the lot.
- **Total project** is the land plus the build contract. It is what the
  projection starts from, as a house-and-land package does.
- **Value today** is the land's recorded current value plus the build.
- **The loan is re-sized** to the whole project at the case's LVR. A lot
  loan carried over would leave the build contract financed by nobody.
- **Stamp duty stays the land's.**

Measured against the legacy export for Lot 1639 Corridale Estate, Lara VIC
3212, the same lot bought as land with the same build planned on it produces:

- the same schedule, row for row;
- $20,570 of construction interest;
- $87,974 up front;
- $743,534 overall;
- a $455,579 capital gain.

`plannedBuild.spec.ts` pins both halves.

Three rules bite.

- **No build price, no build.** Switched on with no contract price, the land
  stays land (QA-13). With the switch off, every report is returned as the
  same object, so nothing downstream recomputes.
- **The planned build never re-describes the land.** Its figures live under
  their own keys (`plannedBuildPrice`, `plannedBuildDurationMonths`,
  `plannedBuildWeeklyRent`), never `buildPrice`. The investment report
  prints a stored `buildPrice` into its prompt whatever the build type, and
  the report is about the land that was bought.
- **The document says it is planned.** The Input Summary reads "Total
  project (land + build)" and "Build price … (planned)", and the schedule's
  chapter is "The build planned on this land". Rendered in WeasyPrint 69.0
  over the standard document and all 50 designs, the projection and the
  schedule are each on one page, as §9 requires.

The stage percentages come from the report's construction settings, which the
override editor now offers on a land-only report with a build planned. The
timing comes from the schedule mode in the cash flow, which is saved with the
planned build.

## 11. Value, debt and equity is read on one page (28 Sep 2026)

The owner read the two delivered cash flows for 37 Bolin Street and Lot 33
Kanuka Drive and asked for one change: section three's two charts together on
one page, rather than the equity build on one page and the after-tax cash flow
overleaf. The section ran to two pages because:

- the chapter opener's deep top padding came first;
- the equity chart was 300 units tall;
- a five-row table sat between the two charts;
- the cash position was a column of ten horizontal bars.

So the table and the second chart landed on a page of their own, which was
two-thirds empty.

The section is now **one page**: the three figures, the equity build, the cash
position, then the end of the term beside what it means. Six changes carry it:

- **The two charts share one year axis.** `columnGeometry` gives both the same
  column slots, so year 3's cash column sits under year 3's equity column and
  the pair reads as one picture. The cash position is a column chart about a
  zero line (the break-even line), no longer a list of horizontal bars.
- **Every year is labelled** ("Yr 1" … "Yr 10"); the equity chart used to skip
  every other one.
- **The value axis steps on round figures** (`niceScale`: 1, 2, 2.5 or 5 of a
  power of ten). It used to step on quarters of the maximum, which printed
  ticks such as "$799k" that name no figure anyone would say.
- **Each figure sits at its column's end**: inside the column, in the paper
  colour, where the column can hold it; just beyond it where the column is
  short. Printed outside a long loss column, the figure landed on the year
  labels beneath the plot.
- **The key names only what is drawn.** A term with no positive year has no
  "Pays the owner" swatch.
- **Nothing is printed twice.** The cumulative cash flow is the strip's third
  figure and left the end-of-term table, which now foots value less loan to
  equity, plus the capital growth.

One page is a measurement. The layout was rendered in WeasyPrint 69.0 over the
standard document and all 50 catalogue designs, in four cases:

- established;
- new build;
- a land-only purchase with a planned build;
- a term that turns cash-positive.

That is 204 documents, and in every one the section header, both charts, the
table and the verdict land on the same page. Every document is also one page
shorter than before. The one-page chapter opens at 6 mm instead of the
opener's full padding (`cf-onepage`), and each block is held whole
(`break-inside: avoid`). A change to either chart's height, or to what the
section holds, has to be re-measured in WeasyPrint rather than assumed.
`growthOnePage.spec.ts` pins the markup the measurement depends on.

---

## 12. Audit 7: nothing cut, one name per figure, the choice beside the act (1 Oct 2026)

The document was drawn in WeasyPrint 69.0 with the render service's options,
in the standard design and all 50 catalogue designs, for four cases:

- established;
- new build on a 12-month schedule;
- new build on a 24-month schedule;
- a term that turns cash-positive.

That is 204 documents, read from the engine's own box tree.

The layout was already sound from the 28 Sep work:

- 357, 408, 408 and 357 pages across the four cases;
- no body page more than a quarter empty;
- no overflow, no wrapped foot, no split table.

So most of what changed is content, consistency and the export surface. The
two exceptions are a caveat that could be cut mid-sentence and a latent layout
defect.

**A caveat could be cut mid-sentence.** `buildProjection` read every note
through the 240-character `slice` that every other text field shares. The tax
note at its longest (a 47% rate the adviser entered) was 238 characters, so any
longer wording was cut silently. The first render of this audit printed "…and
must be confirmed" with "with an accountant" gone. Notes now have their own
bound, `MAX_NOTE_CHARS` (600). That is more than twice the longest note the
browser composes, which is 264 characters. A note past the bound is cut at a
word and ends in an ellipsis. `readBaseFinancials.spec.ts` holds every variant
`evidenceBasisNotes` can compose to half the bound, and requires each to pass
through `buildProjection` unchanged.

**The last section could leave its caution alone on a page.** At the full
chapter opener, "What this assumes" held the table, three notes and the caution
with a line or two to spare. An export with depreciation excluded sends a fourth
note. Measured with the code before this audit, that four-note export put "These
are projections" alone on an extra page in 37 of 51 designs. That was 394 pages
against 357, with 37 pages more than a quarter empty and the worst 89% empty.

The section is now `onePage`, opened at 6 mm as "Value, debt and equity" is.
The four-note export at its longest wording is one page in all 51 designs, in
both the established and the new-build case. The ordinary three-note export
draws exactly the page counts it drew before, with no body page more than a
quarter empty. `growthOnePage.spec.ts` pins the markup.

**"Not held" said the opposite of the caution.** The land-tax note ended "…the
owner's aggregate taxable landholdings in the state, which are not held". "Held"
is the word land ownership itself uses, so a client could read it as "the owner
holds no other land". Both the land-tax note and the tax note beside it now say
what "was not provided for this analysis". The cost note says "the figures as
entered on the report" rather than "the report record". `evidenceBasisNotes` is
the one wording, so the screen, the jsPDF export and the typeset document change
together.

**One figure, one name.** The Input Summary called four figures "Capital growth
rate", "CPI growth rate", "Tax rate (MTR)" and "Rent basis". The assumptions
table on the last page called the same four "Capital growth", "Expense inflation
(CPI)", "Marginal tax rate" and "Occupancy". `toAssumptions` now uses the Input
Summary's names.

**The subhead was the largest type on its page.** "Year one, line by line" was
set at the display subhead size, 17pt in the standard design. It sat on a page
of three captioned tables and read as a second section title. It now carries
`SECTION_SUBHEAD_CLASS`. The shared stylesheet sizes that class at h3 (14pt in
the standard design) inside a chapter body, as it already did inside a memo. It
is still level 2 in the outline.

**A caution pointed at nothing.** The growth section's caution said "the capital
growth line above it". Since §11 it sits beside the end-of-term table, so it now
says "its capital growth over the term".

**The filename is readable** (§5). The legacy copy is qualified "legacy layout",
so it never shares a name with the typeset document in one folder. The
flattened copy is of the legacy layout and carries the same name plus the
"-flattened" the flatten button adds. (Audit 8 found this first passing
"flattened" as the qualifier as well, which named the file
`10 Year Cash Flow - flattened - … - 1 Oct 2026-flattened.pdf`.) The Excel
workbook takes the same name.

**The choice sits beside the act.** "Choose template" used to be an item inside
the export menu. On a phone that menu is itself inside "More", so the picker was
opened from inside a menu. It is now a button in the header row, beside the
export, at every width, as on every other report. The menu items read "Export
PDF", "Export PDF (legacy layout)" and "Export flattened PDF".

The menu's chart switches had said they controlled "PDF outputs", but only the
legacy generator reads them; the typeset Export PDF draws its own charts. They
are now "Legacy layout options", and `render.spec.ts` checks that the typeset
export reads none of them.

The Send to Client dialog, which the Cash Flow shares with the Investment page,
badged every send "Investment Report", a Cash Flow included. It called the
Compass "Investor's Compass", a name no document carries, and pointed at a
"Generate PDF" button that both pages now call "Export PDF". It now names the
document being sent: "10 Year Cash Flow Analysis", or the tier's title from
`tierIdentity.pure.ts`. The change is display only, and the title the portal
stores is still the caller's.

The header was driven in Chromium at 390, 820 and 1440 px. At every width the
controls sit on one row with no horizontal scroll, and the picker opens and
stays open. The send dialog was drawn for a Cash Flow, a Compass and a Due
Diligence Report.

Four things were looked at and kept:

- **The case-inputs fingerprint row** (QA-02).
- **The "Not stated" land and build rows** (QA-13). The legacy export prints
  them too.
- **The assumptions table.** It is a recap with no legacy counterpart, so it
  changes no parity.
- **The projection's "Capital growth" and "CPI growth" rows.** They are the
  legacy table's own row labels for the yearly rate, in its order (§9).
  `legacyParity.spec.ts` pins them, and a matrix row that reads a percentage in
  every cell is not mistaken for a dollar gain.

Two things remain unverified:

- **No production render.** Every measurement here is local WeasyPrint 69.0 with
  production options, against fixtures in the shape the browser sends. That is
  not a production acceptance. The first export after `render-cash-flow-pdf`
  deploys is the proof.
- **How often depreciation is excluded.** That would need a database read this
  work was not authorised to make.

