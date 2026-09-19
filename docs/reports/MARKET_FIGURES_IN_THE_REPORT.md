# What a report may state about the market, and what it may not

**Status:** implemented 17 Sep 2026, not yet exercised through a model run.

## 1. The defect

`MarketEvidence` reached `investment-scoring-service` and nothing else. The
generator builds `marketPoints` from Domain and the open-data sales registers,
posts it, takes the grade back — and **no prompt has ever been handed a
median**.

So the prose supplied its own. From the Compass for 18 Annabelle Crescent,
Kellyville, generated 17 Sep 2026:

> Kellyville house medians are consistently **reported** around the
> **high-$1.8m to ~$2.0m range**, with annual house price growth **called in**
> the **low single digits** …
>
> Recent data sets **report** **median house prices in the order of $1.96m**,
> **unit medians in the high-$700k to low-$800k range**, and **median weekly
> house rents around $900** …
>
> a price guide around **$1.55m** … That guide positions the property **below
> the prevailing Kellyville house median**

Six market figures. `market_fact_snapshot` — the governed ledger that report
was built on — holds **27 ABS and RBA facts and not one market price**: no
median, no rent, no growth rate, no sale count, no days on market. Not `absent`
with a ruling; no such fact at all.

Three things make this the same class as §8 of
[`PLANNING_CONTROLS_IN_THE_REPORT.md`](./PLANNING_CONTROLS_IN_THE_REPORT.md),
where *"`planning-data-service` has worked since 2026-09-06 … and the zoning
section read none of it"*:

- The service **answered**. The growth dimension scored 56 at confidence 81,
  *"Measured on 100% of this dimension's methodology"* — so the register held a
  series for Kellyville and the grade was computed from it.
- The answer was **used**, for the grade.
- The section that needed it **read none of it**, and filled the space itself.

**The grammar is the tell, and it is diagnosable.** *Is consistently reported.
Data sets report. Is called.* An agentless passive is what a sentence uses when
it has no source to name: a model with a figure names where it came from; a
model without one reaches for a construction that does not require one.

And the Executive Verdict's central claim is a comparison between two of them —
a $1.55m guide "below the prevailing Kellyville house median" of $1.96m. Two
unsourced numbers, compared, as the valuation framing of the whole document.

## 2. The rules

1. **A market figure is stated only where the record holds it**, with the
   geography it describes, the dwelling split, the period and the publisher —
   the same standard the planning controls answer to.
2. **An agentless attribution is not a source.** The rule names the
   constructions: *is reported*, *is generally around*, *is called*, *recent
   data sets report*, *market commentary suggests*, *multiple sources*.
3. **A licence decides what a client may be shown.** `mayReachClientReport` is
   the gate and it is applied **here** rather than trusted downstream, because
   "downstream" is a model. Domain's rights are `unverified` pending the
   follow-up, so its points score the grade and are named on the page as held
   and not published — a third state, distinct from never measured.
4. **A benchmark never borrows the subject's authority.** Benchmarks are drawn
   in a second table under a heading saying they describe a different
   geography, because a state figure printed beside a suburb one reads as the
   suburb's.
5. **An absence says which kind it is.** A provider asked that could not answer
   is named with its reason (*"Domain: the key's project has no API package
   attached (403)"*); a measure nothing published is listed as not held.
   Neither is an invitation to supply one.
6. **Nothing here is a valuation.** A median describes a market, not this
   property. The rule forbids "below the median", "above market" and
   "under-priced" by name, because that comparison is what the report made.

## 3. What it draws

| Measure | Figure | What it describes | Published by |
|---|---|---|---|
| Median sale price | $1,960,000 | Kellyville — houses, 62 sales, year to 2026-Q2 | NSW Department of Communities and Justice — Rent and Sales Report |

…then the benchmark table under its own heading, then the three absences, then:

> **What these are, and what they are not.** Each figure above describes a
> MARKET over a stated period, at the geography and dwelling split named beside
> it. None of them is a valuation of this property, an estimate of what it would
> sell for, or a forecast. A median is the middle of what sold; the property may
> sit anywhere relative to it for reasons no median carries.

## 4. Two things that had to change beyond the module

**The evidence is recorded before it is scored.** `marketPoints` existed only
as an argument to the scoring `fetch`, so it survived nowhere — not on the row,
not for the resume worker, not for the prose. It is assigned to
`enhancedData.marketEvidence` **before** the scoring call, because a scoring
failure must not take the evidence with it: what was measured was measured
whether or not a grade came back.

**It rides the pin.** The base prompt measured 92,129 bytes on 262 Pallas
Street and every section trimmed it to ~52,830 (62% head, 38% tail). Anything
that is the AUTHORITY for a figure must come off the budget before the base
prompt is measured and be concatenated after the trim — §6's rule — so the
market table and its rules join `pinnedPlanningContext`. A rule that survives
while its evidence is cut is exactly the defect that produced a report naming
no source, because it had none to name.

## 5. What is not claimed

The rules are **implemented and pinned by 19 assertions; they have not been
exercised through a model run.** What can be shown deterministically is that
the evidence now reaches the prompt, that a licence-withheld point does not
reach the page, that a benchmark is drawn apart, and that both absence branches
render. Whether a model handed a real median stops writing an unsourced one is
a question only a generation answers, and it is on the list for the isolated
run (`S5_ISOLATED_RUN_REQUEST.md`).

Nothing here retrieves a new figure. Where a register holds no median for a
market, the rules forbid every market number and give the permitted form — a
qualitative market discussion — rather than only a prohibition, which is the
lesson the Compass document contract already records.
