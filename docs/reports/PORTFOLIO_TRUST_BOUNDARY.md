# The Portfolio trust boundary — what the model may author, and what it may not

*Traced against `main` at `befd44423` on 2026-09-07, before any change.*

The governing rule: **if a figure can be produced deterministically from the
system record, the model is never asked to calculate, guess, transcribe or
recreate it.**

---

## 1. The flow, and where the boundary sits today

```
client_properties ─┐
clients            ├─→ generate-portfolio-analysis/index.ts
borrowing_capacity ┘        │
                            ├─ portfolioMetrics      ← DETERMINISTIC (computed in the function)
                            ├─ propertyAnalyses      ← DETERMINISTIC (computed in the function)
                            └─ analysis              ← MODEL, and today that includes arithmetic
                                    │
                                    ├─→ portfolio_analysis_reports.report_data (jsonb)
                                    │
                                    ├─→ PortfolioAnalysisPDFGenerator.tsx   (pdf-lib, browser)
                                    └─→ _shared/reports/portfolio/normalise.pure.ts
                                            └─→ payload → render → WeasyPrint
```

The deterministic half is already separated and already correct. The defect is
entirely in the third branch: the model's JSON schema asks for numbers.

## 2. Consumers of every field in question

Searched across `src`, `supabase`, `scripts`, `docs`.

| field | consumers | notes |
| --- | --- | --- |
| `analysis.interestRateSensitivity` **(object)** | `PortfolioAnalysisPDFGenerator.tsx` only | KPI boxes at ~2545-2585 and the on-screen block at ~3609 |
| `…investmentProperties.currentMonthlyCashflow` | same, 1 file | |
| `…ownerOccupiedProperties.currentMonthlyRepayment` | same, 1 file | |
| `…plusOnePercentImpact` / `plusTwoPercentImpact` | same, 1 file | |
| `analysis.riskAssessment.interestRateSensitivity` **(string)** | `normalise.pure.ts:663`, PDF `2511` | **A DIFFERENT FIELD.** Prose, not a number. Must not be conflated. |
| `projections.projectedPortfolioValue` | `normalise.pure.ts:412`, PDF, 4 test/fixture files | |
| `projections.projectedEquity` | `normalise.pure.ts:417`, `render.pure.ts`, `payload.pure.ts`, PDF, tests | |
| `projections.projectedMonthlyCashflow` | `normalise.pure.ts:418`, `render.pure.ts`, `payload.pure.ts`, PDF, tests | |
| `executiveSummary.healthScore` | `normalise/render/payload`, `portfolioProjection.pure.ts`, PDF, template catalogue | also an unrelated marketing `healthScore` in 6 files — different feature |
| `compositionAnalysis.diversificationScore` | PDF only | |
| `borrowingCapacityUtilisation.*` | `normalise.pure.ts`, PDF, tests | the function already fetches the deterministic assessment |

**Two shapes must not change**, because live consumers read them: the
`analysis.interestRateSensitivity` object as the PDF generator types it, and
the `projections` object as `toProjection` reads it. The fix therefore changes
*who produces* the numbers, not the persisted shape.

## 3. What the record genuinely carries per loan

`client_properties`, measured over all 52 rows / 47 loans:

| field | populated | verdict |
| --- | --- | --- |
| `loan_remaining` | 47/47 | authoritative |
| `interest_rate` | 47/47 | authoritative |
| `repayment_type` | 46/47 (`interest_only`, `principal_and_interest`) | authoritative |
| `monthly_interest_repayment` | 43/47 | see below |
| `loan_repayment_frequency` | only value present is `monthly` | no frequency variety exists to normalise |
| `interest_only_period_years` | 6/47 | too sparse to drive anything |
| `loan_repayment_amount` | **0/47** | the column exists and has never been populated |
| **loan term (original or remaining)** | **no such column exists** | — |

Two facts settle the mathematics.

**`monthly_interest_repayment` equals `balance × rate ÷ 12` for 20 of 20
interest-only loans, and for 0 of 21 principal-and-interest loans.** So on an
IO loan it is the interest *and* the whole repayment, exactly; on a P&I loan it
is something else and is not derivable.

**There is no loan term anywhere in the schema.** Not original, not remaining,
not on the property, not on any related table.

## 4. The discrepancy — and it is load-bearing

The brief lists "remaining/original term" among the fields to find. **It does
not exist**, for any loan, anywhere in this data model. That is not a gap in
population; there is no column.

The consequence is exact and splits the portfolio cleanly:

- **An interest-only loan is fully determinate.** Its monthly repayment is
  `balance × rate ÷ 12`, verified exactly against 20 of 20 such loans, and a
  +Δ shock changes it by `balance × Δ ÷ 12`. **No term is required and nothing
  is assumed.**
- **A principal-and-interest loan is indeterminate.** The payment is the
  amortisation formula, which needs a term. Without one, neither the current
  payment nor the shocked payment can be computed. The brief forbids assuming
  a term, and rightly — a 30-year guess on a loan with 8 years left overstates
  the balance of the payment and understates the shock.

Per §4's own rule ("do not calculate a partial portfolio sensitivity and
present it as though it covers every loan"), a portfolio containing any P&I
loan therefore has **no defensible sensitivity figure at all** until a term is
captured.

Measured across the 23 clients who hold loans:

| | clients | |
| --- | --- | --- |
| interest-only only → **exact sensitivity** | **15** | 65.2% |
| contains a P&I loan → **unavailable** | **7** | 30.4% |
| contains a loan with no recorded structure → **unavailable** | 1 | 4.3% |

$12,488,000 of principal-and-interest debt cannot be modelled without a term.

**This is the correct outcome, not a regression** — and what the stored
reports actually show is worse than an accuracy problem.

Every client holding a stored sensitivity block holds interest-only loans, so
the true monthly interest step is exact (`balance × Δ ÷ 12`) and needs no term.
Measured against those loans, over the 13 blocks whose loans carry a recorded
repayment structure:

| the stored figure is… | blocks |
| --- | --- |
| the LEVEL after the rise | 4 |
| the CHANGE caused by the rise | 3 |
| **neither — wrong under both readings** | **6** |

**`plusOnePercentImpact` does not hold one quantity.** In four blocks it is the
monthly amount *after* the rise — `2508.33 → 2425 → 2341.67`, an exact $83.33
step on a $100,000 interest-only loan. In three it is the change itself —
`1010 / 2020`, exact on $1,212,000. Both are drawn under the same PDF label, so
neither a reader nor a downstream consumer can tell which one is on the page.

The remaining six satisfy neither convention. Their best-case error is a median
of $718 a month and $10,611 at worst, and one report's +2% figure ($0.15) is
*smaller* than its +1% ($1,010.15) — which no rate rise can produce. Judged
purely internally, with no reference to the loans at all, 5 of 18 informative
blocks fail that test outright while 8 read as levels and 5 as changes.

**No prompt wording repairs a field that means two things.** Replacing it with
a figure produced by code — exact for 15 clients, honestly absent for 8 — is a
strict improvement, and the sign convention becomes a property of the code
rather than of whichever sentence the model read last.

> **Correction.** An earlier revision of this document, and the two commits
> that carried it, said the model's +1% figure was “out by $2,137 a month on
> average and $9,090 at worst”. That comparison measured every stored value as
> though it were a change, which charges the level-encoded blocks with an error
> they do not have under their own convention. The measurements above replace
> it: each block is judged under whichever reading suits it best, and the
> finding is the inconsistency rather than the magnitude.

**The real remedy is a data one**: capture a loan term on `client_properties`.
That is named here as the thing which would restore the feature for the other
third, and is deliberately out of scope for this change.

## 5. The boundary this change establishes

**Model authority — judgement, interpretation, prose:**
`healthScore`, `diversificationScore`, health/risk/cashflow/equity/
serviceability classifications, strengths, concerns, strategic roles,
recommendations, market and portfolio commentary, projection narrative.

**System authority — never asked of the model:**
portfolio value, debt, equity, monthly cashflow, monthly repayments, rental
income, expenses, LVR, yield, every rate-sensitivity figure, projected value,
projected equity, and the deterministic borrowing-capacity figures already
present in the assessment record.

**Assembly order:** deterministic facts are computed first and supplied to the
model as authoritative context; the model returns judgement and prose only; the
persisted object is assembled from both. Deterministic fields overwrite nothing,
because the model was never permitted to author them.

## 6. One rendering change is required

`PortfolioAnalysisPDFGenerator.tsx`'s `formatCurrency(null)` returns **`'$0'`**
(line ~266) and `safeNumber(null)` returns **`0`**. An unavailable sensitivity
would therefore print `$0/mo` — the precise failure this work exists to end.
The renderer must distinguish absent from zero. `normalise.pure.ts` already
does this correctly (`toProjection` returns null rather than a zeroed block),
and that is the philosophy being extended rather than replaced.

---

## 7. What the implementation did

**`_shared/reports/portfolio/deterministicFacts.pure.ts`** is the arithmetic,
pure and independently testable. It needs no Supabase, no HTTP and no model.

**The model-facing schema no longer contains a single deterministic field.**
Removed from model authority — not computed-then-compared, *not asked*:

| block | fields removed |
| --- | --- |
| `interestRateSensitivity` | `currentMonthlyCashflow`, `currentMonthlyRepayment`, and both `plusOnePercentImpact` / `plusTwoPercentImpact` pairs (6) |
| `projections` | `years`, `projectedPortfolioValue`, `projectedEquity`, `projectedMonthlyCashflow`, `assumptions` (5) |
| `borrowingCapacityUtilisation` | `totalDebtDeployed`, `estimatedCapacity`, `availableCapacity`, `utilisationPercentage` (4) |

Retained as model authority: `healthScore` and `diversificationScore` — both
bounded to 0–100 on the way out, and **dropped rather than clamped** when out
of range, because clamping 250 to 100 publishes an excellent rating the model
never gave. Every classification, strength, concern, strategic role,
recommendation and commentary field is untouched.

**Assembly order.** Facts are computed before the prompt, supplied to the model
in a block headed *"THESE ARE AUTHORITATIVE. EXPLAIN THEM; DO NOT RECALCULATE"*,
and written into the persisted object after the model returns. Nothing is
overwritten, because nothing was ever requested.

**One authority for cashflow.** `interestRateSensitivity.investmentProperties.
currentMonthlyCashflow` is assigned `portfolioMetrics.netMonthlyCashflow`
directly. There is no second derivation, so the two cannot disagree — asserted
by a test that reads the generator's source.

**Persisted shape unchanged.** Both renderers keep reading the same paths; only
the producer changed. New fields are additive (`available`,
`unavailableReason`, `unavailableExplanation`, `loansCovered`,
`balanceCovered`, `projectedDebt`, `assumptionDetail`).

**Historical rows are untouched and still render**, verified by execution over
the whole corpus rather than by reading the guard. The renderer hides a figure
only on an explicit `available === false`, and across all **26** stored reports:
**0** carry an `available` flag, so every one takes the legacy label and the
legacy path; **26 of 26** hold a numeric `projections.projectedPortfolioValue`;
**14 of 14** with a capacity block hold a numeric `utilisationPercentage`; and
**14 of 14** with a sensitivity block hold a numeric `plusOnePercentImpact`.
Nothing stored loses a figure. No backfill was run and no migration was
written.

**Rendering — and this component draws the block twice.**
`monthlyFigureOrUnavailable` replaces `formatCurrency(x) + '/mo'` at the six
sensitivity KPI boxes; the projection boxes distinguish "Not available" from
"Not projected". The unavailable explanation is drawn beneath the boxes so a
reader learns *why* rather than seeing a blank.

The first attempt fixed only the pdf-lib path. `PortfolioAnalysisPDFGenerator`
also renders the same block **on screen**, from the same object, through the
same `formatCurrency` — so an unavailable figure went on printing `$0/mo` in
the review a client is shown before the PDF is made. Both paths go through the
helper now, and the invariant is stated over the whole file rather than over
one call shape, because that is what the first version missed. An absent
cashflow is also no longer painted green: `safeNumber(null)` is `0`, and `>= 0`
coloured "Not available" as a healthy position.

**And the label says which quantity it is.** "IF RATES RISE +1%" is true of a
level and of a change alike, which is precisely why it could sit over either
without looking wrong — the corpus above is what that costs. A calculated row
now reads "+1%: MONTHLY CHANGE". A historical row keeps the wording it shipped
with: relabelling it would be a second guess about which quantity it holds, and
this change exists to stop guessing.

## 8. Known limitations

- **Sensitivity is unavailable for any portfolio holding a principal-and-interest
  loan** — 8 of 23 clients — until a loan term is recorded. This is the single
  data change that would restore it.
- **`projectedMonthlyCashflow` is never calculated.** It is typed `null` so it
  cannot be set. Restoring it requires a named rent-growth and expense-growth
  assumption, which this repository does not have for a portfolio.
- **Debt is held constant across the projection.** Exact for the 15 clients
  whose loans are interest-only; stated openly for the rest.
