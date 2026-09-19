# The Reporting Tier Framework — one record, six renderings

Signed off 2026-09-05. This is the locked architecture for every reporting
tier; the derivation audit that grounds it is
`REPORTING_ENGINE_AUDIT_2026_09.md` (§19 records Phase 1's implementation,
§20 Phase 2's).

**The doctrine in one sentence:** figures are typed from the record, prose is
written about the record, structure is selected from one registry — and a tier
is a depth setting, not a different machine.

## The five laws

1. **Every number is typed from the record; a model never writes a figure.**
   Authored prose may discuss a figure it was handed, never introduce one.
2. **A labelled row is a promise that a figure follows it.** Absent means the
   row is omitted and coverage disclosed — no N/A, TBD or placeholder, in any
   tier, ever. Enforced where content is WRITTEN and where it is READ
   (`presentStoredMarkdown`, RS-5a): the derived reports stored before the
   write-path scrub render clean for every reader, with no stored byte
   changed. The owner's rule extends it to the words themselves — a client
   document never says "N/A", "unavailable" or "not available".
3. **One registry is the constitution.** Structure is selected by section id,
   never by matching heading strings; a declared section with no producer
   fails CI. (Shipped — `_shared/reports/investment/sectionRegistry.pure.ts`.)
4. **Derivation reads the record, not the sibling document.**
5. **The template owns presentation and nothing else.** White-label changes
   tokens and page furniture; figures, sections and conclusions survive
   byte-identical across any template, and identity comes from the row.

## Provenance classes

Every fact carries one, and the class decides its validation and where it may
appear: **Measured** (external service, stamped source + date — Domain, ABS,
RBA, SEIFA, crime, employment, climate, SQM, risk), **Computed** (an engine —
financialEngine, stampDuty, investmentScoreEngine — validated by identity
checks), **Recorded** (facts of the engagement — specs, overrides, client),
**Authored** (model commentary, fact-checked against the record,
schema-constrained with no numeric fields). A table cell may hold only
Measured/Computed/Recorded values.

## The tiers

| Tier | Pages | Promise | Substance |
|---|---|---|---|
| Snapshot | 4–6 | "Should I look closer?" | spine + typed tables; zero model calls at assembly |
| Briefing | 10–14 | "The case in ten minutes" | condensed location case + composed financial tables + typed SWOT |
| Compass (Primary) | 20–26 | "Why this property, here" | the foundation; the only place narrative is generated |
| Financial Analysis | 14–18 | "Can I hold it, what does it return?" | chapters composed from `financial_calculations` |
| Due Diligence (stored `strategic`) | 18–24 | "What must be verified before contract" | property/location risk at depth + verification register |
| Comparison | 12–18 | "Which one?" | Computed metric matrix; model authors only the relative judgement |

The spine — mandatory in every tier: cover + report identity, verdict with
score/grade/coverage, property identity table, key-figures strip, provenance
+ disclaimer.

## The registry

`supabase/functions/_shared/reports/investment/sectionRegistry.pure.ts` is the
depth matrix as a module: 38 sections, each with its provenance class, the
headings production has actually carried for it, and a placement per tier
giving depth, order, label, surface and **producer**. Read its header before
changing it. Four things it expresses that a list of headings cannot:

- **A tier renames a section.** The label belongs to the placement, not the
  section — one "purchase and holding costs" section is spelled three ways
  across the generator, FIN and the briefings production holds.
- **A tier merges sections.** The Compass draws one `Demand Drivers` where Due
  Diligence draws four; `depth: 'merged'` with `mergedInto` says so. That fact
  lived in a code comment, which is why the compass-40 engine shipped a report
  carrying the *unmerged* v2.0 sections and nothing noticed.
- **A section is not always markdown.** The cover, property identity table and
  key-figures strip are drawn by the template from the binding projection.
- **A declaration is not a producer.** Every `spine` and `required` placement
  names what makes it — a composer, an authoring guide, a split-registry route,
  or a projection namespace — and `sectionRegistry.spec.ts` resolves each one by
  running it. Gaps are frozen in `PRODUCER_GAPS`, which can only shrink.

Two rules bite. **Nothing routes on the registry yet** — Phase 3 assembles from
it and deletes heading matching; Phase 2 makes the other definitions *checked
against* it, so `reportSplitRegistry` and `compassSectionRegistry` can drift only
by failing CI. And **a producer that resolves is not a section that appears**:
the Due Diligence tier's routed producers are all correct and still put
`Planning, Zoning and Title Due Diligence` on 1 of 11 documents, because routing
depends on the *parent* carrying a matchable heading. That is law 4's problem
and Phase 3's fix.

## Locked decisions

- **A — the Compass verdict page keeps the key-figures strip** (price, rent,
  gross yield, weekly position): four Computed facts, not modelling. Detailed
  modelling stays in the Financial tier.
- **B — "Strategic" is renamed the "Due Diligence Report"** everywhere a
  person sees it; the stored value `strategic` remains as an alias. (Lands
  with the tier's own cover identity in Phase 4.)
- **C — Primary only.** Every tier and every scope generates on the Primary
  engine; suburb/postcode/statewide get their own Primary-mode registry
  (Phase 4), and the generator's `legacy` branch is deleted once every scope
  has a producer (Phase 5). Forward rule: historical `legacy` rows stay as
  delivered.

## Build order

1. **Stop the wrong documents** (§19 — shipped): Financial chapters composed
   from the record; Briefing guide re-cut; placeholder scrub + label strip +
   snapshot trim on every derived output; DD scorer fixed; verdict sentence
   composed and guarded (template v12); engine + scope stamped on children.
2. **One registry** (§20 — shipped): the tier matrix as a module with a
   producibility test; the six competing structure definitions subordinated to
   it; the dead `TIER_CONFIG` section lists deleted; the Briefing trimmed to its
   own structure and given the sources section its tier promises.
3. **Sectioned record** — per-section storage + abstracts; assembly by id;
   heading-string matching deleted. *In progress (§21): resolution and the
   partition primitive are in; storage and assembly are not.*
4. **Tier formats** — Financial/Due Diligence/Briefing/Snapshot as first-class
   formats with proportional shells; the suburb-scope Primary registry;
   decision B's rename.
5. **Comparison & the gates** — store what the comparison asks for, stamp its
   scale, one render path; the five validation gates (input, record, section,
   assembly, render) as CI-tested modules; delete the legacy branch.

---

## Decision E — one purpose each (17 Sep 2026)

> "There is financial information currently being projected within the Compass
> Report that should be clearly incorporated into the Financial Report instead
> of remaining within the Compass Report. This needs to be properly reviewed
> and separated so that each report has a clear purpose and presents the
> relevant information in the correct place."
> — the owner, 17 Sep 2026

### What was wrong

`compassSectionRegistry.ts` has said since v2.0 that

> ALL detailed financial modelling (purchase costs, yield, loan, cashflow,
> sensitivity, 10-year projections, land tax, equity) lives in the separate
> Financial Analysis Report and MUST NOT appear here

and every Compass section's own `purpose` repeats it — *NO purchase price,
LVR, yield, cashflow or any financial figure*. The generator obeys it: the
prose a model writes for a Compass has no financial section in it. The 17 Sep
regeneration of 262 Pallas Street carries eleven H2 headings and not one is
financial.

And the document a client opens led with three pages of it.

The rule was enforced on the PROSE while **three** implementations decided
what a document draws, and none of them read the registry:

1. `render-investment-report-pdf` reads the tier at line ~2997 and uses it for
   the document's LABEL and nothing else. It drew the KPI strip, the three
   financial charts and the price-and-rent paragraphs from
   `financial_calculations` on every tier.
2. The Investment Compass masters carry an executive KPI dashboard, an
   acquisition-and-cash-flow page and a ten-year equity chart in one page
   sequence that serves all five tiers.
3. `extractKPIMetrics` in the frontend PDF once opened
   `if (reportTier !== 'financial') return null` — so a Compass drew no band
   while the template drew every figure. The fix for that made the rule
   *availability, not tier*, and both presentations then showed everything.

So the Investment Compass opened on purchase price, gross yield, LVR and a
ten-year equity projection, and the Financial Analysis carried the location
case. Each report answered the other's question.

### The rule

`_shared/reports/investment/tierContent.pure.ts` is the one module that
decides what a tier's document contains, and the authority sits in
`reportBindingProjection` because that projection is what every template is
bound from: **withholding a namespace once reaches all 500 seeded masters,
every future one, and both render routes**, while a fix inside one composer
reaches one composer.

| Tier | Financial modelling | Price & rent | Location depth | DD register |
|---|---|---|---|---|
| `compass` | — | ✓ | ✓ | ✓ |
| `financial` | ✓ | ✓ | — | — |
| `strategic` (Due Diligence) | — | ✓ | ✓ | ✓ |
| `briefing` | — | ✓ | — | — |
| `snapshot` | ✓ | ✓ | — | — |
| `composite` (legacy) | ✓ | ✓ | ✓ | ✓ |

Three rules.

**A tier is a PURPOSE, not a length.** The Compass is not a Financial Analysis
with fewer pages. The honest test of the split is whether a reader could tell
which document they are holding from the contents page alone.

**Withholding the modelling is not withholding the price.** A location report
that will not say what the property costs is coy rather than focused, so
`identityFigures` stays true on every tier: the asking price and the
indicative rent are facts about the asset in the way its land size is. What
leaves the Compass is the analysis of a PURCHASE — yield, LVR, loan structure,
cash flow, sensitivity, the ten-year series.

**The drop has to be clean.** The projection withholds the bindings AND the
three master pages carry
`conditional: report && report.drawsFinancialModelling`, because a page kept
with nothing to bind prints labelled empty rows, which is worse than a page
the reader never sees. Two things needed no change: `renderKpiGridHtml`
already drops a tile whose bound value resolved to nothing, so the dashboard
closes up around the figures the tier does publish; and the `toc` block reads
the pages that actually rendered, so the contents list corrects itself.

That second claim was then MEASURED rather than left as an expectation, and
the measurement is the interesting half. Dropping the three pages does not
finish the job: the masters are one design serving five tiers, so a page drawn
on every tier may still bind a withheld figure somewhere inside it. Walked
over all 50 masters, that is **three pages and four blocks**:

| Page | Block | Withheld bindings |
|---|---|---|
| Cover | `kpi-grid` (fact band) | `financials.weeklyNet` |
| Executive dashboard | `kpi-grid` (five variants) | eleven, incl. `grossYield`, `netYield`, `loanAmount`, `cashOnCash` |
| Executive dashboard | `data-table` | `annualRepayment`, `loanAmount` |
| Sources and methodology | `definition-list` | `assumptions.capitalGrowth`, `assumptions.interestRate` |

All four close up, each by a rule its own renderer already carried and each
written for this class of defect — a `kpi-grid` drops the tile and recomputes
its column count from the survivors (so the cover band closes from four cells
to three rather than leaving a gap), a `data-table` drops a row whose bound
cells all resolved to nothing, and a `definition-list` drops an item whose
definition is bound and empty.

So the rule is not "no page may bind a withheld figure" — that would forbid
one design serving five tiers, which is the point of the catalogue. It is
that **a withheld figure may only ever sit somewhere that closes up around
it**, and `reportBindingProjection.spec.ts` walks every master's every page
and fails on any withheld binding outside those three block types, naming the
master, the page, the block and the path.

### The one escape, and why it exists

`projectInvestmentReport(row, { tier })` overrides the row's tier for exactly
one caller. `condense-investment-report` projects the PARENT Compass to
assemble the facts block for a Briefing or a Snapshot — and a Snapshot's whole
purpose is the figures. Keying the withholding on the row being READ would
have handed the Snapshot's prompt a parent with no modelling in it and quietly
emptied the one tier that exists to carry it. **The document being PRODUCED
decides what may be published**, so the producer names its own tier.

### Shipped as

Seed **v14** (`20261203000000_seed_template_library_v14_tier_separation.sql`)
plus the active-master refresh (`20261203010000`), exactly as v13 did: adopted
masters are COPIES and nothing else updates one after adoption.

The cover's standfirst now comes from the content policy rather than from
`DOCUMENT_IDENTITY`, because it is a promise about what the document holds.
The Compass's read *"What the property is, what it costs to hold, and what the
assessment concluded"* — a promise of the modelling it does not carry, printed
on the cover above a page sequence that then drew it.

---

## Decision F — the Briefing was the same defect in the other direction (18 Sep 2026)

S5/S6 §4:

> "Compass owns asset/locality/market evidence/assessment/planning/
> infrastructure; Financial owns detailed financing/repayments/cash position/
> projections; Strategic owns verification priorities/suitability/holding/
> monitoring/exit; Briefing+Snapshot genuinely condensed. **Confirm that weekly
> cash position and detailed modelling have not returned through shared
> key-figure bindings.**"

They have not. The bindings are clean and were measured rather than read.

### What the bindings publish, per tier

`projectInvestmentReport` run on the retained five-tier set — one real
production row per tier, not a sample:

| tier | row | financial bindings | `weeklyNet` | `weeklyRepayment` | assumptions | `equitySeries` |
|---|---|---|---|---|---|---|
| compass | `09f8569e` | 5 | absent | absent | 0 | empty |
| strategic | `2f1f7f6f` | 5 | absent | absent | 0 | empty |
| briefing | `89b451f6` | 5 | absent | absent | 0 | empty |
| financial | `c21ed1fa` | 37 | present | present | 4 | present |
| snapshot | `8c6edc56` | 37 | present | present | 4 | present |

The five on the withholding tiers are `purchasePrice`, `weeklyRent`,
`annualRent`, `annualRentAtOccupancy` and `annualRentAtOccupancyLabel` — the
identity figures, which stay on every tier because the asking price and the
indicative rent are facts about the asset the way its land size is. The label
carries the basis (*"Annual rent at 50 occupied weeks"*), so a figure derived
from an occupancy assumption the tier does not publish is self-describing.

### And then the body contradicted them

Decision E fixed the Compass: the rule was enforced on the PROSE while three
implementations decided what the document drew. The Briefing was the same
fault with the terms swapped — **the bindings were right and the body was
wrong**, and three things this platform already said about that document
disagreed with a fourth:

| module | what it said about the Briefing |
|---|---|
| `tierContent.pure.ts` | `financialModelling: false` |
| `reportBindingProjection.pure.ts` | withholds 32 bindings, drops three master pages |
| the cover it prints | *"the financial position in the Financial Analysis Report"* |
| `sectionRegistry.pure.ts` + `condenseCompose.pure.ts` | composed five detailed chapters into the body |

Measured on row `89b451f6`, those five composed to **3,156 characters over 73
table rows**: purchase and annual holding costs, gross and net yield, loan
size, LVR, monthly and **weekly repayment**, total interest over the term, the
sensitivity grid, and the ten-year value / rent / cashflow / equity / LVR
series with its equity bridge. Four of the five are **byte-identical** to the
Financial Analysis Report's own chapters; only `tenYear` differs, and only
because `scenarios: 'primary'` drops the alternate cases (2,091 → 1,141
characters).

That is not a condensed financial position. It is the Financial Analysis
Report's chapters inside a second document — and it fails the test Decision E
sets: **a reader could not name the document from its contents page.**

### The rule

**A tier that names another document for the modelling does not print the
modelling.** A companion note is a promise about what is NOT in this document,
and a body that contradicts it is worse than no note at all.

So the Briefing's registry declaration loses `purchaseHolding`, `rentalYield`,
`loan`, `sensitivity` and `tenYear`, and `condenseCompose` stops composing
them. Its contents page is now Executive Summary · Location & Demand · Amenity
& Access · Market Position · Property Fit · Risk Overview · Investment Score
Breakdown · SWOT Analysis · Top 3 Opportunities · Top 3 Risks ·
Recommendation · Market Data Sources.

Three things this does not do.

**It does not remove a control.** The score breakdown and the SWOT are still
composed from the record rather than asked of the model — they are the
assessment, which is what a Briefing is for. `composeFinancialChapters` is
untouched and still serves the Financial tier and the fork.

**It does not blank the document.** The price and the indicative rent still
reach it, and both other documents are named on its own cover.

**It does not rewrite history.** Stored Briefings keep every byte; this
decides what the next one contains. The retained fixture is a pre-P1-B
document and carries the parent's legacy structure (`Loan Analysis (P&I and
Interest-Only)`, `Cumulative Cashflow Projections`, `LVR Projections`) —
which is the same reason the cohorts must be distinguished before any claim
is made about "what a Briefing contains".

The Snapshot is left exactly as it was: `financialModelling: true`, one
`Financial Snapshot` block composed from the record, standfirst *"The numbers
that matter and a short assessment"*. One block is condensed; five chapters
are not.

### Where it lives

| File | What changed |
|---|---|
| `_shared/reports/investment/sectionRegistry.pure.ts` | The five financial sections lose their `briefing` tier entry; the reasoning sits beside the declaration. |
| `_shared/reports/investment/condenseCompose.pure.ts` | The briefing branch stops composing `composeFinancialChapters`; score and SWOT unchanged. |
| `condense-investment-report/index.ts` | The guide's preamble and its HARD RULE now carry the true reason — the modelling belongs to another document, not "it is attached after your output". |
| `src/lib/reports/__tests__/tierOwnership.spec.ts` | 14 consumer-level assertions across all five tiers. |
