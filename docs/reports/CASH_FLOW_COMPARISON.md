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

**The model was handed figures nobody recorded** (release audit, 26 Sep 2026).
A property with no stored interest rate or LVR went to the model as 5.5% and
80%, and a missing price or weekly rent as 0, while the capital growth rate
beside them was already sent as `null` "rather than assuming one". The model
reads what it is handed as that property's own figure, so the analysis could
state a rate and an LVR nobody had set. Every one of the five is now `null`
when the record does not hold it, and the prompt says a null figure is one the
record does not hold, to be named as not recorded and never computed from.
`analysisRequest.spec.ts` pins both halves.

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


## 13 · Choose template, Export PDF, and fewer sheets (28 Sep 2026)

This is the same treatment as the Property Comparison (`COMPARISON.md` §13).

**Controls.** Both surfaces in the Cash Flow Analysis now read:
- **Choose template**. The comparison is drawn in the Cash Flow's template
  (`DESIGN_BORROWED_FROM`), and the button says so.
- **Export PDF**, the typeset document. It used to be labelled "Typeset
  comparison" and "Typeset".
- **Legacy layout**, the jsPDF export. It used to be labelled "Export PDF
  (legacy layout)", so the screen showed two buttons named Export PDF.

**Name.**
- File: `Cash Flow Comparison - <the properties> - 28 Sep 2026.pdf`. It used to
  be `Cash_Flow_Comparison_<n>_Properties_<date>_<ref>.pdf`.
- Cover title: the properties, where it used to read "3 properties, 10 years".
  The term moves to the cover's meta.

**Pages.** Measured on three properties over the 50 designs: 22 sheets became
15–19.
- **Section 3 and section 4** each open the long edge with their heading and
  both matrices on one landscape sheet. `renderBandedMatrix` gave every matrix
  a sheet of its own, which put a heading alone on a portrait page and then one
  three-row table per landscape sheet.
- **The other sections run on.**
- **"Why capital in matters more than price"** is bound to the short table
  before it. It had turned a page alone.

## 14 · Audit 8: the comparison read as a client reads it (1 Oct 2026)

Audit 8 of the owner's report programme. It covers both comparisons. The
Property Comparison's half is `COMPARISON.md` §15, which also records how it
was measured: each document drawn the way the route draws it, at two, three and
five properties, in the standard layout and all 50 catalogue designs, measured
from WeasyPrint 69.0's own box tree. The rows are representative fixtures, not
production replays.

| Properties | Pages (51 documents) | Pages more than a quarter empty | Mean fill | Pages past the edge |
|---|---|---|---|---|
| 2 | 849 → 765 | 42 → 140 | 86.2% → 84.6% | 0 → 0 |
| 3 | 961 → 879 | 144 → 177 | 82.7% → 82.5% | 0 → 0 |
| 5 | 1,172 → 959 | 297 → 122 | 78.6% → 86.3% | 49 → 0 |

Every two-property document is 15 pages, where they ran 16–18. Every
five-property document fits the sheet.

The part-empty counts that rose sit at three boundaries, and each is a page
ending where the document changes:
- **Before the landscape sections.** The last portrait page before them ends
  where the entry section ends, because the orientation changes.
- **The landscape sheets themselves.** Each holds one section. At two
  properties a section fills about 59% of the sheet, and two do not fit one.
- **At three properties, section 7.** It now opens at the head of a page rather
  than leaving its opener at the foot (*A heading is never left at the foot of
  a page*, below).

None of these is a section stopping short in the middle of its own content.

### What the page said, and what it says now

**The property tables fit the sheet.** At five properties the fifth column ran
past the sheet's edge on 49 pages, in 46 of the 51 designs, by up to 132pt.
- **The cause.** Each table was drawn by `renderDataTable` with a figure
  column per property, and a figure column sets its head and every cell on one
  line. So the street heads in tracked capitals ("5 TALLAWONG / AVENUE") and
  "Not within the term" each held a column wider than its share.
- **The fix.** They are drawn by the shared portrait matrix now
  (`renderPortraitMatrix`, `portraitMatrix.pure.ts`): equal property columns,
  heads that wrap.
- **A phrase among the figures may wrap** (`wrapPhrases`). A cell in a figure
  column that holds words and no digit carries `PHRASE_CELL_CLASS`, and only
  that cell may break between words (`table.data td.num.phrase`). A figure
  still never wraps, so "-$96 a week" cannot break at its minus sign.
- **Nothing marks the opened property.** The column head of the property the
  adviser opened the analysis from carried a trailing " ·", and the ranking
  carried "(opened)". Both said something about the session, not the property,
  with nothing on the page to say what they meant.

**The year matrices are set as figures.** They take the portrait matrix's
leading and padding (`cfc-years`), and 2pt/4pt of side padding in the ruled
designs, as the 10 Year Cash Flow's own matrix does. At five properties every
matrix had taken a landscape sheet of its own: four sheets, each about half
empty, for two sections. Each section is one sheet now. Their captions are one
line on the long edge:
- the cumulative caption: "Each year added to those before it…";
- the equity caption: "Value less the loan balance. The gap between a
  property's value and its equity is what is still owed". It had read "the
  difference between this and the row above", and the row above was a
  different table.

**A measure nobody leads says why.** "No clear leader" stood for two different
findings. `winnerOf` now says which (`undecided`), and the table reads
accordingly:
- **Tied.** Two properties share the best figure.
- **None within the term.** On the payback year, no property repays its holding
  costs within the projection. The timing table beside it says the same words.
- **Not comparable.** Fewer than two properties have a figure for any other
  measure.

On the payback year alone an absent figure means "not within the term", which
every year inside it beats (`absentIsLast`). So the one property that repays
leads, with no margin, because the others have no figure to measure the lead
against.

**A lead between percentages is in points.** "Best return on capital … ahead
by 76.7%" read as 76.7% better than second place, where the second property
returned 291.2% against 367.9%. It reads "76.7 points" (`showMargin`).

**The donut counts what the table counts.**
- **One ring, one key.** Its centre read 4/8 while its key printed shares of
  the seven decided measures (57%, 14%, 29%). A measure nobody leads is a
  segment of its own, "No single leader", and the key prints counts ("4 of
  8"), which cannot round to 101%.
- **The right "nobody".** Its caption said "1 was tied" for a payback year no
  property reached. It says "no property repays its holding costs within the
  term" for that, and counts only real ties as tied (`leaderlessClauses`).

**The cumulative chart's axis is in round figures.** Quarters of the raw range
printed "$-50k", "$-99k", "$-149k", "$-199k": a minus sign inside the currency,
and steps nobody counts in. The axis steps by `niceScale` and labels by
`compactMoney`, the 10 Year Cash Flow's own, so it reads "$0, -$50k, -$100k,
-$150k, -$200k".

The shared `formatAxisValue` puts the sign ahead of the dollar too ("-$320",
"-$50k"), so every format's money axis does. Its old case in
`reportCharts.spec.ts` pinned the defect.

**The opening paragraph is in the strip's own figures.**
- **One precision.** The lead read "32%" over a KPI strip reading "31.9%". It is
  `formatMeasure` now, the strip's own.
- **The sum it is.** "$X of capital growth against -$198,521 of cumulative
  after-tax cash flow" put a minus sign after a word that already subtracts. It
  reads "$X of capital growth less the $198,521 it cost to hold after tax", or
  "plus $Y of after-tax cash flow" where the cash flow is positive.

**The analysis says only what it can.**
- **The label may not claim what the figures deny.** "Reaches positive cash
  flow first" stood over "though it stays negative across the term", beside a
  timing table reading "Not within the term" for every property. Where no
  property's own cash flow turns positive within the term, the label reads
  "Nearest to positive cash flow". The sentence is the model's and unchanged.
- **The ending values are not printed.** The analysis's table of ending values
  restated, in millions and unattributed, the figures section five prints to
  the dollar against each property's name. Three rows in the order the
  properties run everywhere else read as theirs, an attribution the producer
  cannot give (F4).
  A capital-growth block holding only those values is no longer a block
  (`toCapitalGrowth`). It used to put a "Capital growth" heading over nothing,
  and open the section for it.
- **The break-even figures stay, said to belong to nobody.** The rate-rise
  margins are nowhere else in the document, so they are printed under a
  sentence saying the analysis gave them without saying which property each
  belongs to. The caption reads "As the analysis stated them, in no property's
  order".

**Memo sections, subheads, paragraphs.**
- The sections are memo sections (`MEMO_CHAPTER_CLASS`), and their subheads are
  set at h3's size (`SECTION_SUBHEAD_CLASS`).
- The model's summary and each property's verdict are set as the paragraphs it
  wrote.
- Model text is cut at a word with an ellipsis (`truncateAtWord`), never part
  way through a word.

**The standfirsts say what follows.** The measures section's standfirst read
"how long each takes to repay what it cost to buy". That misstated the measure
under it: the payback year is when the after-tax cash flow, added up, turns
positive. It reads "when each repays what it cost to hold". The cash-flow,
analysis and basis standfirsts no longer point at "the tables above".

**The cover lists the properties only when its title cannot.** At three or
fewer, the "Properties" line repeated the title word for word directly beneath
it. It is listed only where the title says "and N more".

**A heading is never left at the foot of a page.** A property's "Score given"
line is the second line of its heading. The heading and its score kept each
other and nothing more (`css.pure.ts`). So 30 of the 51 three-property
documents, and 22 of the five-property ones, ended a page on "1. 14 Wattlebird
Grove / Score given: 84", with the verdict overleaf.

At three properties that page also carried section 7's title and standfirst.
The score line refuses the break after itself now (`SCORE_LINE_CLASS`), and
none of the 153 documents ends a page on it. The cost is the white space the
stranded opener stood in, and one more page in 12 of the 51 three-property
designs. The sections run on, so the kept group can never be a chapter's tail
on a sheet of its own.

**The downloads are named.** The modal's own downloads saved as
`cash-flow-comparison-3-properties-2026-10-01.pdf` and
`ai-cash-flow-analysis-2026-10-01.pdf`, which say neither which comparison nor
which document. They take the typeset document's name, qualified:
`Cash Flow Comparison - legacy layout - <the properties> - 1 Oct 2026.pdf`, and
`… - written analysis, legacy layout - …` for the written analysis.

The flattened copies take the same names, and the flatten button adds
"-flattened". It also stopped the 10 Year Cash Flow's flattened copy saying
"flattened" twice (`COMPARISON.md` §15).

### Not changed

The AI generation is unchanged (`COMPARISON.md` §14). The prompt, the schema
and the model are as they were, and so is every sentence the model wrote.
Only the labels and the structure around them changed. Nothing the producer
named by `propertyNumber` is newly attributed (F4).

### Recorded and left

- **A section that opens on a table kept whole** can leave the page before it
  part empty. A ten-row table split to fill a page reads as two tables. This is
  the same class Audits 2, 5 and 7 recorded.
- **The landscape sheets.** At two properties each landscape sheet holds one
  section, about 59% of it. Two do not fit one sheet. Setting the years as rows
  in portrait would change the table's orientation with the property count,
  and two different-looking documents for one report type is the outcome
  `COMPARISON.md` §13 records against.

**Tests.**
- `normalise.spec.ts`: the two absences, the one property that repays, the
  sum as said, and the lead in the strip's precision.
- `render.spec.ts`:
  - the subhead class, with nothing marking the opened property;
  - both matrix classes;
  - the leaderless words and the points;
  - the nearest-to-positive label;
  - no ending values, and no heading over nothing;
  - the break-even lead-in, paragraphs, the cover meta and the standfirst;
  - the qualified file names.
- `charts.spec.ts`: one ring, one key and one centre; the right "nobody"; and
  the axis stepping on round figures.
- The shared rule: `reportPrimitives.spec.ts` (`isPhrase`, `wrapPhrases`
  through the portrait matrix) and `reportCss.spec.ts` (the one exception to
  "a figure never wraps").
