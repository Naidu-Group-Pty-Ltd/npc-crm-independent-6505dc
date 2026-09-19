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
| The purchase and the first year | `chapter` | 2 | Lede, KPI strip, purchase table, acquisition costs, year-one lines |
| The *n*-year projection | `wide-table` | 2 | Two landscape matrices — position, then cash flow |
| Value, debt and equity | `chapter` | 2 | Outcome KPIs, equity-build chart, ending table, cash-position chart |
| What this assumes | `chapter` | 1 | Assumptions, notes, the projection caveat |
| Contact & disclaimer | `closing` | 1 | The tenant's company block |

The `assumptions` section appears only when there is something to say; the spine
validator would otherwise fail a document that claimed a section it did not have.

### Why the matrix is two tables

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

`Cash_Flow_Analysis_<Address>_<YYYY-MM-DD>.pdf`. The `[^a-zA-Z0-9]` → `_` rule is
the existing one from `CashFlowAnalysisModal`, kept exactly; the date is appended
so a client who receives two revisions of the same property can tell them apart.

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
