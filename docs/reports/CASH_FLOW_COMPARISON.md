# Cash Flow Comparison Analysis — the contract

The fifth format on the report design system, and the first comparison whose
figures are arithmetic rather than model output.

Route: `render-cash-flow-comparison-pdf`.
Canonical modules: `supabase/functions/_shared/reports/cashFlowComparison/`.
Ledger: `cash_flow_comparison_renders` (migration `20260818000000`).

---

## 1. Where the boundary sits

**The browser owns the arithmetic; the server owns the document and the
identities.** Same split as the 10 Year Cash Flow, and it is worth restating
because the reason `CASH_FLOW.md` §1 gives does not survive contact with a
comparison on its own.

That reason is that `CashFlowAnalysisModal` lets an adviser override ten fields
in any of ten years without saving, so a server recomputing from
`investment_reports.financial_calculations` would render a different ten years
from the one they reviewed. True — **for the report they have open**. The peers
are built from `manual_overrides.cashFlowYearlyOverrides` and
`financial_calculations` (`CashFlowAnalysisModal.tsx:505-660`), both persisted
and both recomputable server-side. Anyone checking will find the stated argument
does not hold for N−1 of N properties.

The reason it still holds is stronger than the one it replaces: **a comparison is
only worth anything if every property in it was computed by one implementation.**
The modal's chained cascade is around a hundred lines of year-on-year
compounding. A second copy on the server would agree with it until the day it did
not, and the first symptom would be a client document ranking two properties in
an order the screen did not.

What the server does own, and never accepts from the caller:

- **Every address.** Read from `investment_reports`. A label on a column of
  someone's financial projection is not a display preference.
- **Every derived figure.** See §3.
- **The client's name**, when exactly one client resolves through
  `client_property_id`. Zero or several and no "Prepared for" line is printed:
  a comparison spanning two clients' properties is a real thing an adviser does,
  and naming one of them would be wrong.

**Nothing is persisted about the comparison itself.** Not the projections and not
the analysis — see F1.

---

## 2. What was wrong with the shipping output

### F1 — the analysis is never persisted, and structurally cannot be

`compare-cash-flow-reports` returns its JSON without writing anything. The
modal's "Save Analysis" button (`saveAiAnalysis`, `:1515`) writes to
`cash_flow_analyses`, which holds **0 rows**, for two independent reasons:

- Its INSERT policy is `WITH CHECK (auth.role() = 'authenticated' AND (created_by
  = auth.uid() OR created_by IS NULL))`. This application signs in through
  `custom_users` (4 rows) rather than Supabase auth (2 rows), so the browser
  client is not `authenticated` and every insert is refused. The adviser sees
  "Save Failed".
- Even if one succeeded, the SELECT policy is `created_by = auth.uid()` and the
  insert never sets `created_by`. The row would be invisible to its own author
  from the moment it was written — `loadSavedAnalysis` (`:377`) would never find
  it, `savedAnalysisId` would stay null, and every save would insert another
  orphan.

The table carries **12 RLS policies** — an owner set plus two duplicate
service-role sets. It has been built and re-secured twice and never once written
to.

**Recorded, not fixed.** Repairing it is an RLS migration on a table
`ai-dashboard-agent` also reads (`:4188`), and it makes a currently-failing
button start writing rows. That is a behaviour change with its own blast radius,
and it does not belong inside a report migration. It is also why this format
renders from browser state rather than from a row.

### F2 — five field names did not match the producer's own schema

Measured against `compare-cash-flow-reports/index.ts:188-203`:

| Legacy read | Schema emits | What printed |
| --- | --- | --- |
| `ranking.propertyAddress` (`:1830`) | `address` | `#1 - undefined` |
| `ranking.overallScore` (`:1834`) | `score` | `Score: undefined/100` |
| `balancedApproach` (`:1866`, `:2073`) | `balanced` | the Balanced recommendation never rendered at all |
| `recData.recommendation` (`:1879`, `:2091`) | `{propertyNumber, reason}` | `N/A` for all four investor profiles |
| `overallRecommendation` (`:1905`, `:2116`) | an **object** | an object handed to `pdf.splitTextToSize` |

The on-screen panel reads `overallRecommendation.bestProperty.reason` correctly
(`:5291`), so the same object was being read three different ways in one file.

**Fixed**, at the user's direction — see §7. Note the sixth defect inside the
second: `/100` is an assertion the record does not support, because the schema
names no scale. Fixing the key while keeping the denominator would have turned
"undefined" into a confidently wrong number.

### F3 — half the analysis is generated, paid for and thrown away

The schema names eight top-level sections. Before this migration only
`executiveSummary`, `finalRankings`, `investorRecommendations` and
`overallRecommendation.bestProperty` reached any surface — screen or PDF.
`cashFlowTrajectory`, `capitalGrowth`, `yieldAnalysis`, `riskAssessment`,
`overallRecommendation.avoid` and `alternativeScenarios` were rendered nowhere.

**Fixed**, with the attribution caveat in §5.

### F4 — `propertyNumber` names an ordering nobody recorded

The producer builds `propertiesData` by mapping over `reports`
(`compare-cash-flow-reports/index.ts:78`), which is the result of
`.in('id', reportIds)` at `:58`. **Postgres does not guarantee that `IN` returns
rows in the order the ids were given.** So `propertyNumber` indexes a list that
existed only inside that one function call.

`finalRankings` survives because the model is instructed to echo `address` back
(`:192`). Nothing else does: `investorRecommendations.*`, `cashFlowTrajectory.*`,
`capitalGrowth.*`, `yieldAnalysis.*`, `riskAssessment.*`,
`overallRecommendation.bestProperty` and `alternativeScenarios[].recommendation`
are all bare integers.

**Consequence, and it is load-bearing for this document**: nothing here resolves
`propertyNumber` to an address. Model prose prints unattributed, exactly as the
on-screen panel already does (`:5265`, `:5271`, `:5277`, `:5283`, `:5294`), and
only rankings are attributed — matched on the address string, with a stated "not
matched to a property" callout when it matches none.

**The fix is one line in the producer** — enumerate `reportIds` rather than
`reports`. It is the only thing standing between this format and attributed model
prose. Out of scope here for the same reason F1 is.

### F5 — the peer metrics are not comparable with the primary's

`calculateAdvancedMetrics` (`:1300-1422`) is fed by two different readings of the
same report:

- **LMI.** `baseFinancialData` had `lmiAmount`; `compBaseData` (`:1438-1444`) has
  no such key. `totalInitialInvestment` (`:1374`) is deposit + stamp duty + legal
  + LMI, and it is the denominator of return on capital, cash-on-cash and the
  equity multiple. So the property the adviser opened had its returns divided by
  a larger cost base than every property it was ranked against.
- **Purchase price.** `compBaseData` reads
  `mo.purchasePrice || fc.purchasePrice || fc.propertyValue`, missing
  `initialCosts.propertyValue` — which the peer's own *projection* does read
  (`:528`). Where they differ, capital gain was measured from a base the
  projection never used. The `||` also turns a legitimate `0` into a fallback.

**Fixed at the root.** The cascade moved to
`src/lib/reports/cashFlow/readBaseFinancials.ts` and every property in a
comparison goes through it. The modal's `baseFinancialData` is now a call to that
function; nothing about the report it has open changed.

**Still outstanding:** the peer *projection* engine (`:505-660`) resolves the same
fields inline before it starts compounding. Extracting that means extracting the
hundred-line cascade around it, which is beyond a report migration.
`legacyPathStays.spec.ts` asserts the two resolve `purchasePrice` and
`marketValueNow` with identical expressions, so the day they drift is the day a
test says so.

### F6 — `compare-cash-flow-reports` gates on authentication, not authorisation

It calls `verifyAuth` (`:40`) and then reads
`investment_reports.financial_calculations` for every requested id with the
service role. No module permission check. **Recorded, not fixed** — closing it
changes who can call that function, which is its own decision.

The render route does not have this hole: it gates on `reports / can_view`, the
same key `render-cash-flow-pdf` and `render-investment-report-pdf` apply to the
same reports.

### F7 — the deterministic half reached no document at all

`exportComparisonPDF` prints eight metric rows on one page.
`exportAiAnalysisPDF` returns without drawing anything when there is no analysis
(`:1947`). So the ten years of every property — the thing an adviser spends the
session editing — had no route to a client in any form.

---

## 3. Derive, never accept

**Anything derivable is derived on the server; nothing derivable is accepted.**

`toWireComparison` sends projections and nothing else — no metrics at all. The
route recomputes every one from the years it was given. Two sources for one
relationship is how a document says a property returned 41% in a KPI strip and
38% in a table three pages later, and a comparison is a document whose entire
content is one property's number beside another's.

The rule caught two defects before a line of the renderer was written: F5, and
this one:

**Two break-evens, named apart.** The modal calls "break-even" the year
*cumulative* cash flow turns non-negative (`:1392-1399`). `cashFlow`'s
`toOutcome` calls it the year *annual* cash flow turns non-negative. Both are
true, they are rarely the same year, and there was no way to notice while each
lived on its own screen. The payload carries both — `firstPositiveYear` and
`paybackYear` — and section 5 prints both with a callout saying which is which.

`initialInvestment` is deposit plus every itemised acquisition cost. A cash
purchase with no itemised costs has no denominator, so every ratio built on it is
`null` rather than `Infinity`: "infinite return" on a client's page is a bug, not
a compliment.

---

## 4. What the payload refuses

A comparison is a table with aligned columns. Almost every refusal follows from
that, and each is loud — a `CashFlowComparisonPayloadError`, answered with a 400
naming the property and the field — rather than clamped or dropped.

| Refused | Why |
| --- | --- |
| fewer than 2, more than 5 properties | matches `compare-cash-flow-reports:47`. Refused, not truncated: dropping the fifth produces a document that looks complete |
| the same report twice | it would tie on every measure and print two identical rows |
| different year counts | a four-year property beside a ten-year one is a table that lies |
| different year *numbers* | two properties both projecting ten years but numbering them 0–9 and 1–10 share a column header that is wrong for one |
| `NaN` / `Infinity` | inherited from `cashFlow/normalise.pure.ts`. A table with a hole in it on company letterhead is worse than an error |
| a `reportId` that does not resolve | every property or none — a four-property document from a five-property request says nothing about the missing one |

### The model half is untrusted

Capped in every dimension, and a block whose shape does not match the schema is
**dropped rather than coerced** — coercion is exactly how F2's fifth defect
happens.

**URL schemes are neutralised in every model-authored string, and that is a
correctness fix rather than hygiene.** `assertSafeRenderResources` decodes HTML
entities *first* (`renderResourcePolicy.pure.ts:68`) and then throws on any
`//host`, `http(s)://`, `file:`, `ftp:` or `gopher:` token **anywhere in the
document**, including inside escaped body text:

```
Remote render resources must be normalized into project storage
```

So a model writing "per corelogic.com.au/median-values" with a scheme on the
front would fail the render with an error naming no field and no line. Escaping
does not help — the policy undoes it before it looks. The scheme is removed and
the rest of the token kept, so the sentence still reads and still says where the
claim came from; `URL_TOKEN` does not match a bare host.

> The Property Comparison format has this latent today. It does no URL stripping
> and its source is stored model output.

---

## 5. The document

Archetype `cash-flow-comparison`, `pageBudget: [15, 34]`, `contents: true`.

| # | Section | Slot | Appears when |
| --- | --- | --- | --- |
| 1 | Which property comes out ahead | chapter | always |
| 2 | What each costs to get into | chapter | always |
| 3 | N years of cash flow | wide-table | always |
| 4 | N years of value and equity | wide-table | always |
| 5 | The measures side by side | chapter | always |
| 6 | What the analysis found | chapter | `executiveSummary`, `cashFlowTrajectory`, `capitalGrowth` or `yieldAnalysis` |
| 7 | Each property in turn | chapter | any ranking carries a verdict, strengths or weaknesses |
| 8 | Who each property suits | chapter | `investorRecommendations` |
| 9 | Risk, and what to avoid | chapter | `riskAssessment` or `overallRecommendation` |
| 10 | On what basis | chapter | always |

**Sections 1–5 and 10 are arithmetic and always present. 6–9 exist only when the
adviser generated an analysis, and each of the four is independently
conditional.** That last part is load-bearing rather than defensive:
`compare-cash-flow-reports` used to ask for eight sections with
`maxTokens: 4000` — a third of what the sibling comparison function is given
against a schema of comparable size, and that one truncated 94% of its
five-property calls. It did truncate, and § "What 'Failed to parse' actually
was" below records what that cost. A response that closed its braces early
still parses, so a partial analysis is a normal arrival. Gating the four
together would drop three present sections because a fourth ran out of
budget.

**The verdict goes first**, inverting the producer's order, for the reason
`COMPARISON.md` §5 gives. The KPI strip leads with the *gap* rather than the
winner's figure, because a 2% lead and a 40% lead produce the same ordered list
and mean entirely different things.

**A comparison with no analysis is a complete, sendable document**, and section
10 says so rather than leaving the absence to be noticed.

### What "Failed to parse" actually was

An adviser comparing properties pressed **Generate AI Analysis** and got
*"Failed to parse AI analysis"*, every time. Nothing about that sentence was
true: the model answered, and answered in JSON. Four things in the producer
conspired, and each one alone is enough to produce it.

1. **A flat 4,000 output tokens for an eight-section schema.** `max_tokens` is
   the *whole* output allowance, and a reasoning model spends thousands of it
   thinking before it writes a character. This is the number the paragraph above
   and `normalise.pure.ts` both flagged as the one to worry about.
2. **Nothing asked for JSON except a sentence of prose.** No `response_format`
   was sent at all, so the shape was a request rather than a constraint — and
   the prompt asked for seven numbered sections *and then* for JSON, which
   invites a model to write the sections in prose first and spend the budget
   before the object starts.
3. **The fence regex required a CLOSING fence.**
   `/```(?:json)?\s*\n([\s\S]*?)\n```/` cannot match a response that was cut
   off, so a truncated answer fell through to `JSON.parse` *with the opening
   fence still attached* and threw a `SyntaxError` about a backtick. The same
   defect `generate-portfolio-analysis` carried, and the reason `readModelJson`
   exists.
4. **`finish_reason` was never read**, so the one field that says "cut off"
   reached nobody, and a model that had run out of room was reported as one that
   could not write JSON — which sends an operator to the wrong remedy.

A fifth sat behind them: `invokeSecureFunction` defaults to **60 seconds** and
the modal passed no override, so raising the budget on its own would have
swapped a parse failure for an abort. `CASH_FLOW_ANALYSIS_CLIENT_MS` is the
producer's number, imported by the modal, so the two ends cannot drift.

`analysisRequest.pure.ts` holds all of it: the token sizing (base plus a slope
per property, because three sections carry a row each), the schema — whose
top-level keys are asserted to be `ANALYSIS_SECTIONS`, so what is asked for and
what `toAnalysis` reads cannot drift — the `json_schema → json_object → prose`
ladder, and the reading. The producer also **orders the fetched reports by the
ids it was sent**: `propertyNumber` is the only handle the model has on a
property in five of the eight sections, and it was the position of a row in an
`.in()` result, an order the server never promises.

### There is still no salvager

The natural reading of `COMPARISON.md` is "model output → build a salvage
module". The original argument against one here was that truncation "fails
loudly and totally, so there is nothing damaged to read back" — and half of that
reasoning *was* the bug. The conclusion survives it for a better reason: the fix
removes the cause rather than reading back the damage, and the partial answer
that actually reaches the reader is the one that **parses** — a model that
closed its braces early — which every block is already independently conditional
on. What is new is that a partial answer is now **kept** rather than refused:
`classifyCashFlowAnalysis` names which of the eight arrived, `missing` travels
with the analysis to the screen and into the document, and the panel leads with
"This analysis is incomplete" rather than quietly drawing four blocks of eight.

### The screen draws what the document draws

Six of the eight blocks had never been read by anyone before the migration, and
after it the *document* drew all eight while the *panel that generated it* drew
four — so an adviser downloading the PDF got more than the page they were
reading. `CashFlowAnalysisFindings` is the other four. Two rules hold it.

**A property number is resolved through the model's own rankings, never through
our position in a list.** Every block but the rankings names a property by the
1-based index the producer sent. The obvious resolution — index into `[the open
report, ...the ones being compared]` — is wrong for a *saved* analysis:
`cash_flow_analyses` stores its comparison ids sorted while the panel holds them
in selection order, so re-opening one can put the numbers against different
houses. `finalRankings` carries both the number and the address, it is the only
part of the answer that does, and it travels through the save. A number that
resolves to nothing drops its row rather than being labelled with a guess.

**`shrink-0` protects a cluster's width, not its contents.** At 390px
"Break-even: Beyond year 10 · Safety margin: -$310/week" is 345px of content in
a 232px row; as a `shrink-0` cluster it hung off the card and was clipped by its
own rounded edge — the figure a reader most needs, cut in half. Measured in a
real Chromium, at 390, 430 and 768.

### Model prose is attributed to the model, and to no property

Section 6 opens by saying these findings are written rather than calculated, and
that where they name a figure the table is the record. Six of the eight blocks
had never been read by anyone before this migration — not on screen, not in
either PDF — so this is also the first time they reach a person. Every string is
escaped through `escapeHtml`; none reaches a `bodyHtml` parameter directly.

`overallRecommendation.avoid` is in section 9 and deliberately **not** section 1.
Naming a property to avoid on the same page as the ranking, in a document an
adviser may hand to a client considering that property, is a different act from
ranking it last.

`riskAssessment.highestRisk` stays in prose and never becomes a scoreboard entry
or a chart segment: an award for being the worst is not a category anyone wins —
`COMPARISON.md` §6 records what one looks like on a page.

---

## 6. The charts

Three, plus four landscape matrices. Each returns `''` when its data is absent or
degenerate, and every section prints its table either way.

1. **Ranked total return** (`renderBars`). Ranked on the same axis the scoreboard
   ranks on, so the bars cannot run in a different order from the table beside
   them. **`tone` is passed explicitly**: `renderBars` colours by `|value| / max`
   when none is given (`charts.pure.ts:717-726`), so the property that lost the
   most money would be drawn as the longest, greenest bar in the chart.
2. **Category wins** (`renderDonut`). Every property gets a legend row including
   one that led on nothing — dropping it would imply a smaller field than the one
   compared. Both the centre figure and the sub-label are stated: the defaults
   are the first segment's share and the first segment's *name*, and an address
   does not fit inside the ring's hole.
3. **Cumulative cash flow** (format-local, multi-series line). The chart this
   format exists for — *when does each property stop costing money, and do the
   curves cross?* Written here rather than in the shared module because the
   shared module has no multi-series line, which is the rule
   `cashFlow/charts.pure.ts` states for its own stacked column.

### The matrices are split by measure, not interleaved

Four `renderBandedMatrix` calls: after-tax cash flow, cumulative, property value,
equity — each N rows. The first version interleaved two measures per property,
which is 2N rows with two-line labels; at five properties that overflowed the
landscape page and stranded the fifth property's rows on a page of their own.
Splitting fits, and reads better than the fix required: comparing five properties
on one measure is a scan down one block.

Split at every property count rather than only when it overflows, for the reason
`COMPARISON.md` gives about orientation — a format whose central table changes
shape with the row count hands a reader two different-looking documents for the
same report type.

The primary is **not** marked in the matrices. `total` sets the summary-row
treatment, and a bolded row in a financial matrix reads as a sum — which in a
document whose posture is equal peers would also read as "this is the answer".
The marker is on the column headers of the side-by-side tables instead.

### Considered and rejected

- **`renderQuadrant`** — growth against yield, the obvious two axes. Wrong twice.
  It maps values with `xOf(v) = padL + (v / xMax) * plotW`
  (`charts.pure.ts:794`), so a negative point is drawn left of the plot
  rectangle; and both candidate axes go negative in normal use, because
  `netYield` is `((annualRent - totalExpenses) / propertyValue) * 100`
  (`CashFlowAnalysisModal.tsx:636`) and `capitalGrowthRate` is a per-year field
  an adviser stress-testing a downturn types a minus sign into. The dividers
  would be wrong too: CPI and the interest rate are per-property here, so one
  property's assumption would become everyone's threshold — and picking the
  primary's privileges the primary.
- **`renderHeatmap`** — property × year of cash flow, the right shape. It prints
  raw numbers (`cellText`, `:456`), so `-8432.17` reaches a client's page as
  `-8432.2` with no currency and no separator; and it ramps one hue linearly from
  the grid minimum, so a year at −$8,000 and a year at +$400 differ only in alpha
  and the sign change is invisible. Making it fit needs a formatter hook *and* a
  diverging ramp, and the banded matrix on the facing page still says it better —
  `signedKeys` gives negatives the negative tone and every figure is a number a
  reader can quote.
- **`renderScoreWheel`** over the criteria. This format genuinely has the
  criteria, unlike the Property Comparison. Rejected on the primitive: it draws
  one polygon per call (`:495-497`), so five properties means five separate
  charts, and comparing polygon shapes across separate frames is the thing radars
  are worst at.
- **A waterfall** decomposing total return into growth plus cash flow. Honest,
  but one per property means up to five, and the Borrowing Capacity's waterfall
  was deleted for disagreeing with the figure beneath it.
- **A bullet.** Needs a value against a target; nothing here is measured against
  a threshold, only against the others.

---

## 7. The legacy generators stay, and were repaired

`exportComparisonPDF` (`:1655`) and `exportAiAnalysisPDF` (`:1946`) are still
there, still draw with jsPDF, still rasterise the three on-screen charts, and are
still bound to their buttons. The new control sits beside them at both surfaces.

**This is the first migration in the programme that edited the path it was
replacing**, at the user's direction. The five defects in F2 are corrected in
place, and each fix is asserted by `legacyPathStays.spec.ts` — which has to prove
two claims that pull in opposite directions, and does so for each one by having
been broken deliberately and watched fail.

Two of the fixes are behaviour changes worth naming:

- Four of the five make **absent content appear**. A client holding a filed PDF
  that says "Score: undefined/100" will find a regenerated one differs. That is
  the point.
- `recData.recommendation` is removed and `propertyNumber` is **not** substituted
  in its place, per F4. The label and the reason print; no property is named.

`requestCashFlowComparisonPdf` takes **no legacy fallback**. The two generators
produce genuinely different documents — a chart dump and an analysis-only brief —
so silently substituting either would hand a client a document nobody chose. On
an undeployed route it fails with a message naming the buttons that do work.

**Not metered.** Typesetting figures the browser already computed asks nothing of
any model. The analysis, when present, was paid for once at generation time and
is not regenerated.

---

## 8. The filename diverges from the legacy, deliberately

`Cash_Flow_Comparison_<N>_Properties_<YYYY-MM-DD>_<REF8>.pdf`, where `REF8` is
the primary report id's first eight characters uppercased and is also printed on
the cover foot.

The legacy produces `cash-flow-comparison-5-properties-2026-08-02.pdf` (`:1922`)
— lowercase, hyphenated, no reference. `CASH_FLOW.md` §5 treats a filename as a
contract and kept the legacy shape; here the legacy shape is the only
lowercase-hyphenated one in the suite, and a date alone does not separate two
comparisons run on the same day, which is the normal case when the whole point of
the screen is to try different peer sets. Both files can exist in one downloads
folder and they will not be confused for each other.

Storage: `cash-flow-comparison/<primaryReportId>/<date>/<uuid>-<name>` in
`client-files`. Keyed by the primary report, never by a client — the properties
may belong to different ones.

---

## 9. The ledger

`cash_flow_comparison_renders`. Beyond the usual file, brand, timing and error
columns:

| Column | The question it answers |
| --- | --- |
| `compared_report_ids uuid[]` | which properties. No foreign key, deliberately: a peer being deleted must not delete the record that a document comparing it was sent |
| `investor_profile` | the model ranks "for the ${investorProfile} investor" (`:155`), so two documents from the same properties under different profiles are different documents |
| `has_ai_analysis` | what proportion of sent documents carry model prose — the number that decides whether sections 6–9 earn their keep |
| `ai_sections_missing text[]` | how often the 4,000-token ceiling loses the tail |

Neither the projections nor the analysis are stored. RLS: superadmin select,
service-role write.

---

## 10. Verification performed

1. `deno check` on all six canonical modules and on the route.
2. **Four documents rendered through local WeasyPrint from real production
   figures** and read page by page: two properties without an analysis (17
   pages), five without (20), two with (25), five with (27). Four defects came
   out of that run and nothing else would have found them — the matrix spill, the
   chart key collision, the donut's centre label, and every page budget.
3. Every column and RPC parameter the route names checked against
   `information_schema.columns` and `pg_get_function_identity_arguments`.
4. The migration DDL executed against production inside a transaction, including
   a real insert, and rolled back — `to_regclass` confirmed null afterwards.
5. Every guard in `charts.spec.ts` and `legacyPathStays.spec.ts` verified by
   deliberately breaking the thing it guards and watching the test fail.
6. `npm run lint`, `npm run audit:style`, `npm run build`, `npx vitest run` — the
   style ratchet and the failing-test set identical to the branch base.

## 11. Deployment

1. Apply `20260818000000_cash_flow_comparison_render_path.sql`.
2. Deploy `render-cash-flow-comparison-pdf`.

Until then the new control fails with a message naming the existing buttons,
which keep working throughout.

---

## 12. The Template Builder path — fifty masters, and no adapter

`/admin/template-builder` now carries **50 design templates** for
`report_type = 'cash_flow_comparison'`, drawn in the ten Investment Compass
families. They are **preview-only**, and that is a finding rather than an
omission.

### There is nothing an adapter could read

Every other format on the family system reads a stored artefact. This one has
none, and each of the three candidates fails for a different reason:

| Candidate | Why it cannot serve a template |
| --- | --- |
| The projections | The browser's, computed by the ~100-line cascade in `CashFlowAnalysisModal`, and never persisted. §1 explains why a second server-side implementation would be worse than none |
| `cash_flow_analyses` | **0 rows**, and structurally cannot hold any — F1. Its INSERT check requires `auth.role() = 'authenticated'` while this application signs in through `custom_users`, and its SELECT policy would hide the row from its own author even if one succeeded |
| `cash_flow_comparison_renders` | **0 rows**; records `primary_report_id` and `compared_report_ids` but stores neither the projections nor the analysis (§9); and its only SELECT policy is `has_role(auth.uid(), 'superadmin')`, which the browser cannot satisfy for the same `custom_users` reason |

The obvious substitute is the one the 10 Year Cash Flow format uses —
`investment_reports.financial_calculations.projections`, on 162 reports — and it
fails for a reason that is not about scope. That series carries eight fields a
year and **every headline measure in this document is built on
`afterTaxAnnual`**: total return, ROI, cash-on-cash, the equity multiple and both
break-even years. The stored series models no tax at all. Filling those fields to
make the shape fit would put an invented after-tax position on a client's page.

So `cashFlowComparisonProjection.pure.ts` is written and tested, the masters bind
what it publishes, and the registry entry says *why* it is preview-only rather
than the default "not configured yet". The day a comparison is persisted
somewhere a template can reach, an adapter calling that projection is the whole
of the work.

### What the masters do with a document whose shape changes

A comparison holds 2 to 5 properties and the central tables put one column per
property. Every property-wide table is drawn **four times, once per count, under
mutually exclusive conditionals at one position** — the pattern
`COMPARISON.md` introduced for its ranking, generalised into `byPropertyCount()`
because this format needs it on five tables rather than one.

The archetype route's landscape matrices have no equivalent here: these families
are portrait and cannot reflow, so cash flow and equity get a page each with
years down the side and properties across — the same split-by-measure decision
§6 made, reached from the other direction.

### The editorial rules, asserted rather than described

`cashFlowComparisonCatalogue.spec.ts` holds each of §5's decisions to the page
sequence, because every one would be silently undone by an ordinary refactor:

- model prose names no property, and the spec walks every bound path under
  `analysis.*` to prove none ends in an address or a number;
- `avoid` appears on the risk page and nowhere near the ranking;
- `highestRisk` is prose and never a scoreboard row;
- no score is printed with a denominator;
- the verdict's KPI band leads with the **gap**, not the winner's figure;
- both break-evens print, named apart;
- each analysis page is gated on its own block, so a partial analysis loses only
  the sections that are actually missing.

### One defect this found in the renderer

**`data-table` never resolved bindings in its column headers.** Every body cell
went through `resolveBindable` and the headers did not, so a bound header printed
a literal `{{cashFlowComparison.properties.0.shortAddress}}` across the top of
the table. It survived because no format bound a header until this one — the
other six all name their columns statically, and a comparison is the first
document whose headings are data. Fixed in both renderers, with
`dataTableHeaderBindings.spec.ts` covering it.

It is also the only binding defect in this programme that is *visible* rather
than silent: an unresolved binding elsewhere renders as the empty string, and
this one rendered as its own source.

See [`../template-library/07-investment-compass-families.md`](../template-library/07-investment-compass-families.md)
for the design system these 50 masters are drawn in.

