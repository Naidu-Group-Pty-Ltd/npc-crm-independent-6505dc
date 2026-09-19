# Derived figures — one definition, and a check that the document keeps it

*Measured 2026-09-07 against the production corpus (1,072 stored reports with
readable prose; 193 carrying a `financial_calculations.keyMetrics` block).*

A generated report states three numbers a client acts on that nothing in the
property record contains: the **gross rental yield**, the **net rental yield**
and the **loan-to-value ratio**. Each is derived, each was computed in several
places, and until this work none of them was checked against anything after the
model wrote it. `runQAValidation`'s seven rules are page band, keyword
presence, placeholders, editorial labels, duplicate headings and section
counts — every one of them structural. No rule in the product had ever compared
a number.

Read this before touching:

- `supabase/functions/_shared/reports/metrics/propertyMetrics.pure.ts`
- `supabase/functions/_shared/reports/investment/factReconciliation.pure.ts`
- the `reconcileFacts` call site in `generate-investment-report/index.ts`
- `src/lib/reports/__tests__/derivedFigureDefinitions.spec.ts`

---

## 1. The divergence was mostly not a bug

Gross yield is computed independently in six places, net yield in four, LVR in
eight. The obvious reading is that seven of the eight LVRs are wrong. They are
not.

`liveProjectionRow.ts` divides the **settlement loan** by the **purchase
price**. The strategy and review surfaces divide the **remaining balance** by
the **current value**. Both are correct, because they are *different
quantities*: origination LVR and current LVR. At settlement they coincide;
across a ten-year projection they diverge every year. The same is true of
yield — `financialEngine.pure.ts`'s `propertyValue` is the purchase price (it
pairs with `deposit` and drives land tax), so its yields are yield-on-purchase,
while the portfolio and review surfaces divide by current value.

Consolidating onto one yield would have destroyed a real distinction and
silently changed documents. **What the codebase lacked was not a single
definition — it was a NAME for each quantity and a way to state which one you
meant.**

So in `propertyMetrics.pure.ts` the basis is not a default. It is part of the
call:

```ts
grossYield({ annualRent, basisAmount: purchasePrice, basis: 'purchase' })
grossYield({ annualRent, basisAmount: currentValue,  basis: 'value' })
originationLvr({ loanAtSettlement, purchasePrice })   // fixed for the life of the loan
currentLvr({ loanBalance, currentValue })             // moves with growth and amortisation
```

You cannot compute a yield or an LVR through this module without saying what it
is on, and the answer carries its basis back with it (`BasedMetric`), so a
figure cannot be re-labelled downstream. `labelFor` is what a surface prints:
"Gross yield (on purchase price)", never a bare "Gross yield".

Two more rules the module holds.

**Absent, not zero.** Every existing call site is shaped
`value > 0 ? (loan / value) * 100 : 0`. A zero LVR is not the absence of an
LVR — it is the claim that a property is unencumbered, and a zero yield is the
claim it earns nothing. Every function returns `null` where the figure cannot
be formed. This is not hypothetical: **84 of 1,072 stored reports print a
`0.00%` yield**, 206 times between them, in shapes like
`| Gross Rental Yield | $0 ÷ $390,000 × 100 | 0.00% |` — the rent was unknown
and the document told a client the yield was zero.

**Net yield is unlevered; cash-on-cash is not.** Net yield is rent less
*operating* costs over a property basis: two owners of the same property with
different loans have the same net yield. Cash-on-cash is rent less operating
costs *and debt service*, over the cash actually invested.
`useReviewWizard.ts` computes rent less costs-including-interest over current
value and calls it `netYield`; that is neither. It is a screen figure and
reaches no report, but it is why `netYield` here takes `annualOperatingCosts`
explicitly rather than a pre-netted cashflow — the shape of the input makes the
error hard to repeat. A test pins the size of it: on one worked example the
correct figure is 3.39% and the interest-inclusive one is −1.73%.

---

## 2. Reconciliation, extended to the figures the prompt orders

`reconcileFacts` already compared the prose against the record for bedrooms,
bathrooms, car spaces, purchase price, weekly rent and land size. It now also
compares the three derived figures, and they are the **strongest possible
targets**, because the prompt does not merely supply them — it orders their
use:

> PRE-CALCULATED FINANCIAL VALUES (USE THESE EXACTLY - DO NOT RECALCULATE)

A divergence is therefore not a difference of opinion about method. It is the
model having overridden an explicit instruction.

The call site passes the exact variables the prompt interpolates
(`preCalculatedGrossYield`, `preCalculatedNetYield`, `effectiveLvr`) rather
than recomputing them. Recomputing would only prove that two formulas agree.

### The rule is unchanged: disclose, report-level, never gate

A figure is contradicted only when the recorded value **never** appears in the
prose in that figure's vocabulary **and** a different value appears at least
twice. Findings become `validation_flags` entries (`type: 'fact'`) surfaced in
the viewer's coverage note. A report that never finishes is worse than one
carrying a named warning.

### Tolerance is absolute for a percentage

The existing band is relative: `tolerance × max(1, |expected|)`. On a gross
yield of 4.83 a 2% relative band is ±0.097, which rejects the entirely ordinary
prose rounding "5%". Percentages therefore carry an **absolute** band:

| figure | band | accepts | rejects |
| --- | --- | --- | --- |
| gross / net yield | **0.25 points** | 4.83 written as `4.8` or `5` | `5.5` |
| LVR | **0.5 points** | 80 written as `80.0` | `85` |

An LVR is quoted whole or to one place, and the ratios a lender actually
distinguishes are five points apart, so a wider band stops separating 80 from
85.

### The vocabulary was measured, not guessed

Every pattern was written against the phrasings the corpus actually uses. The
most common way this product states a gross yield is a **working column** —
543 of 2,153 gross mentions look like

```
| Gross Rental Yield | $33,800 ÷ $700,000 × 100 | 4.83% |
```

so the pattern has to cross arithmetic to reach the answer. It is bounded three
ways: it cannot cross a newline (a table header never reaches the row beneath
it), it cannot cross a `%` (the first percentage after the label is the one
read, so a comparison column is out of reach), and it cannot cross a second
`yield` — which is what keeps *"the gross yield of 4.83% and net yield of
3.39%"* from filing 3.39 under gross. `\byield\b` also excludes the plural:
"suburb gross yields sit below 4%" is a statement about the market.

**A wide gap alone is not enough, and the long tail is what proved it.** These
are verbatim production strings that a gap-only rule read as the figure:

- `gross rental yield provides substantial buffering against interest rate increases. A 1%` → read 1
- `net rental yield reflects the balance between rental income ($27,500 annually at 96%` → read the occupancy
- `gross yield necessitates leverage for returns. Sensitivity to RBA cash rate (4.35%` → read the cash rate
- `net yield is substantially higher than comparable metropolitan properties (1.5-2.0%` → read −2.0

All four are sentences, not statements of the figure. So the gap is admitted
two ways and no others:

- a **working** gap may be long, but has to hand the value over with a
  delimiter — a table pipe, a label's colon, or an equation's `=`. That is what
  `$33,800 ÷ $700,000 × 100 | ` and `[($450 × 52) − ($1,500 + …)] / $590,000 = `
  both do.
- an **adjacent** gap has room for `of`, `at`, `is`, a bracket or nothing at
  all, and no room for a clause.

Every prose false positive dies on the same rule: **a verb cannot introduce the
number.**

### LVR is the one place a value-after-label rule had to be refused

LVR prose is not like yield prose. The value the reader is being given sits
*before* the label far more often than after it — `a $560,000 loan (80% LVR,
6.5% interest)` — and the ordinary connectives point at something else
entirely:

| written | what the number actually is |
| --- | --- |
| `LVR, 6.5%` | the interest rate |
| `LVR at 6.5%` | the interest rate |
| `banks cap LVR at 95%` | lending policy, not this loan |
| `would result in an LVR of 65%` | a projection after growth |
| `\| Final LVR \| 52% \|` | the **current** LVR at year 10 — correct, and a different quantity |

A value-after-label rule with prose connectives read **22 of 57** reports as
contradicted, and almost all of it was the detector. The label-first form is
therefore admitted only through a **structural** connector — `:`, `|` or `=` —
which is a table cell or a labelled field and never a sentence, with a
qualifier check in front of it so `Final LVR` and `Year 10 LVR` are left alone.
Coverage doubled (57 reports → 115) and disagreement fell to 10.

### What the detectors find on the existing corpus

| figure | reports with readable mentions | disagreeing with the record |
| --- | --- | --- |
| gross yield | 157 | **4** (2.5%) |
| net yield | 154 | 23 (14.9%) — see below |
| LVR | 115 | **10** (8.7%) |

The gross-yield fires are real. On one, prose and record differ by exactly the
ratio 49⁄52 on both yields — the model recomputed on its own occupancy
assumption instead of the 52 weeks it was handed. On another the record says
3.89% and the document says `0.00%` twice.

The **net-yield number is measured against the wrong expectation and is an
upper bound.** The corpus check compares against
`keyMetrics.netRentalYield`, which is *not* the figure the prompt supplies —
`preCalculatedNetYield` is, and it is computed from a different cost base in a
different module. The proof is in the spread: of 147 reports where both figures
are readable, the gross yield agrees with the record in 141, and in **23 of the
25 where gross agrees but net does not, the gross-minus-net spread also
differs** — the document is netting a different set of costs. That two stored
net yields exist at all is the disease this module names; the live wiring
passes the one the prompt orders.

---

## 3. The other half: does the record agree with itself?

Reconciliation asks whether the prose agrees with the record. `financeIdentityBreaches`
asks whether the record agrees with **itself**, and the corpus says it often
does not. Three identities:

1. `deposit + loan = purchase price` (±$1)
2. the LVR is stated once, not twice (`keyMetrics.lvr` vs `loanDetails.lvr`, ±0.5)
3. the stated LVR matches `loan ÷ price` (±0.5)

**14 of 143 stored reports break at least one.** A verbatim row:

| field | value |
| --- | --- |
| `initialCosts.propertyValue` | $672,000 |
| `initialCosts.deposit` | $134,400 — 20% of the price |
| `initialCosts.loanAmount` | $604,800 — **90%** of the price |
| `keyMetrics.lvr` | 80 |
| `loanDetails.lvr` | **90** |
| `manual_overrides.loanToValueRatio` | 80 |
| `manual_overrides.loanAmount` | $537,600 |

The deposit and the loan come to **$739,200 against a $672,000 purchase** — the
client is shown two lines that together exceed what they are buying by $67,200.
The customer's own override says 80% and names the right loan; the record
carries the 90% one. And the written analysis says "90% LVR" **nine to twelve
times**, because the loan block is what the model was given. All ten LVR
divergences the reconciliation found are this same defect, on both sides
(nine reports say 90 where the record says 80; one says 80 where it says 90).

This is deliberately *disclosed and not repaired here.* Repairing it means
finding which write path produced these rows — the engine itself is
self-consistent (`loanAmount = propertyValue − deposit`, `lvr` derived from the
same pair), so a later merge is putting the two halves out of step — and that
is a change to how a report is generated, which belongs in its own work with
its own evidence. What this delivers is that it can no longer happen silently.

---

## 4. What stops this coming back

`src/lib/reports/__tests__/derivedFigureDefinitions.spec.ts` is a **ratchet**,
not a ban. It fixes the set of modules that define a yield or an LVR inline —
22 modules, 53 occurrences on 2026-09-07 — and fails on a new module or a new
occurrence in an existing one.

It does not forbid the copies that exist, because most of them are the real
distinction described in §1. It fixes their number, so the next one has to be a
decision somebody makes rather than a line somebody adds. Stamp duty had
exactly this shape and reached four *different* answers before anyone compared
them.

Raising a number is not automatically wrong. It is a question with an answer:
could this have called the canonical module? If it genuinely could not — the
quantity is different, or the inputs are shaped differently — say which in the
commit and move the number.

---

## 5. The `0.00%` yield: two rents, in two scopes

*Diagnosed and fixed 2026-09-07. See
`_shared/reports/investment/rentalEvidence.pure.ts`.*

**83 stored reports print a `0.00%` rental yield**, in shapes like
`| Gross Rental Yield | $0 ÷ $390,000 × 100 | 0.00% |`. 74 of them had no rent
supplied by the customer. The zero flowed onward: the annual income line
printed `$0`, the *net* yield printed a confident negative number that was
really just the costs, and the model was then told to "USE THESE EXACTLY - DO
NOT RECALCULATE".

### Why it happened

The generator resolved the rent **twice**, and only one of them could see a
looked-up value.

| variable | resolved from | who reads it |
| --- | --- | --- |
| `effectiveWeeklyRent` | `overrides.weeklyRent \|\| propertyDetails.weeklyRent \|\| 0` | every prompt line, both pre-calculated yields |
| `calcWeeklyRent` | `effectiveWeeklyRent \|\| weeklyRent \|\| 0` | the calculator, the projections, every stored figure |

`weeklyRent` — the SQM market lookup — is declared **inside the enrichment
block** and is out of scope by the time the prompt is assembled. So a report
whose rent came from the lookup had correct projections beside a document that
said the yield was zero. Four prompt lines had already been patched by hand
with `effectiveWeeklyRent || enhancedData.financials?.income?.weeklyRent ||
'XXX'` — someone had seen the symptom — but the yields, the annual income and
four further lines were not, and a per-line patch cannot fix a figure computed
once from the wrong variable.

**A third consumer had the same defect**: the investment scoring service was
handed `weeklyRent: effectiveWeeklyRent || 0`, so it derived a yield from zero
and scored the property as earning nothing. Measured impact is modest — mean
score 47.5 on the affected reports against 48.9 elsewhere — but it is the same
bug in a figure that reaches the reader.

### The rule

**There is one rent.** It is resolved once, from the same chain the calculator
used, and it carries whether it is established at all. When it is not, every
figure derived from it is ABSENT rather than zero, and the prompt says so
instead of handing the model a nought to reason from.

Three things make the change safe to adopt on a path that runs on every
investment report ever generated:

- **Ordering is the calculator's own** — override, then listing, then the rent
  the projections actually used. Where a rent was typed or carried, this
  returns the same number the old expression did, so a report with rental
  evidence is unchanged to the digit. The spec asserts that against the old
  expression rather than against an idea of it.
- **Arithmetic keeps its zero.** Management fees are a percentage OF the rent,
  so no rent means no fee exactly as before. Only the figures a reader is
  *shown* become absent.
- **The `%` sign moved inside the formatter.** Every call site read
  `${preCalculatedGrossYield}%`, so a null there would have printed `null%` —
  the shape of a defect rather than a disclosure.

### The directive that travels with an absent yield

A model handed a blank where a number should be will fill it; that is what it
is for. `absentRentDirective` therefore forbids the estimate AND says what to
write instead, because a prohibition with no permitted action is one a model
routes around. It explicitly still allows qualitative discussion of the rental
market — what it forbids is attaching a number to *this* property's rent.

### One thing deliberately NOT adopted

The pre-calculated yields keep their `.toFixed(2)`; they are not routed through
`propertyMetrics.grossYield`. Swept over **2,207,223 realistic (rent, price)
pairs**, `Math.round(x * 100) / 100` and `toFixed(2)` disagree on **2,763** of
them — half-way values like `1.105` printing as `1.10` one way and `1.11` the
other. That is 0.125% of documents shifted by a hundredth of a point for no
reader's benefit. The canonical module owns the *definition*; the generator
owns the *presentation*, and the difference is recorded here so nobody
"unifies" them later without knowing it moves documents.

---

## 6. The deposit/loan contradiction: healed on read, not migrated

*Diagnosed and fixed 2026-09-07. See `healFinanceIdentity` in
`_shared/reports/investment/financialEngine.pure.ts`.*

**21 stored reports** carry a finance block that describes two different deals:
a deposit taken at one LVR beside a loan taken at another. The clearest row —

| field | value |
| --- | --- |
| `initialCosts.propertyValue` | $672,000 |
| `initialCosts.deposit` | $134,400 — 20% |
| `initialCosts.loanAmount` | $604,800 — **90%** |
| `keyMetrics.lvr` | 80 |
| `loanDetails.lvr` | **90** |
| `manual_overrides.loanToValueRatio` | 80 |
| `manual_overrides.loanAmount` | **$537,600** |

— shows a client a deposit and a loan that together exceed what they are buying
by **$67,200**, while their own recorded input names the right loan. The
written analysis then repeats "90% LVR" nine to twelve times, because the loan
block is what the model was handed.

### The live path is already fixed

The cause was the pre-rework override splat: a writer that wrote some leaves of
a recomputed block and left others stale. `manage-investment-reports` now
recomputes through the engine before every save. That is not an assumption —
**17 reports carried an LVR override in August and September and all 17 are
consistent**, against 10 broken out of 33 in April–June.

### `keyMetrics.lvr` is the arbiter

What remained was the history, and the naive repair — "the loan is stale,
re-derive it from price minus deposit" — is wrong: on one row it is the
*deposit* that is stale, and that repair would have invented a third figure.

The engine derives `keyMetrics.lvr` as `(propertyValue − deposit) /
propertyValue` from the inputs it was actually given, so it is a witness to
which half is sound. Whichever of the deposit and the loan agrees with it
survives; the other is re-derived from the identity. Where **neither** agrees,
nothing is healed — a repair that cannot say which figure is sound is just a
third opinion, and `financeIdentityBreaches` discloses it instead.

Verified against all 21 rows: **17 heal the loan, 1 heals the deposit, 3 are
left alone.** Of the 13 that carry an independent witness — the customer's own
`manual_overrides.loanAmount` — **13 agree with the healed figure and none
contradict it.**

### Healed on read, so nothing is overwritten

The heal lives in `reconcileStoredFinancials`, which the register, the PDF
renderer, the comparison and both cash-flow projections already call. So the
repair reaches every reader of all 21 rows **without a migration and without
overwriting a single stored byte** — and it is reversible by deleting code
rather than by restoring a backup. A spec asserts the input object is not
mutated.

Two placement rules matter. It runs **after** the series heal, because the
projections' ROI denominator is the stored deposit and re-basing a ten-year
table on a healed one would rewrite rows this repair has no business touching.
It runs **before** the upfront total, because that total *is* the deposit plus
the acquisition lines and must follow.

The same function also runs at the **write** boundary in
`manage-investment-reports`, on the two paths where the recompute is skipped
(display-only overrides, or a calculator that could not be reached) and the
client's own object is stored. A record that is right at rest is worth more
than one that is right only when something remembers to reconcile it.

### What is left

Three rows stay broken at rest and are disclosed rather than repaired: two
where neither half agrees with the stated LVR, and one whose stored purchase
price is **$3**. Nothing here will guess for them.
