# Scoring accuracy — the zero-cost closeout

**READ-ONLY SHADOW ANALYSIS. No production score was changed, no client-facing
output was altered, no historical report was rewritten, no data was purchased,
and the Scoring V2 methodology was not modified.**

This is the measurement that settles what "scoring accuracy" means for this
platform, using only records the database already holds. It answers a question
that never needed market evidence: **what were the scores clients actually
received built from?**

---

## 1. Baseline

| | |
| --- | --- |
| main SHA | `4e815b66d29ac5faed39a0ff060c76755c4fe238` |
| corpus measured at | 2026-09-11 02:55:45 UTC |
| scoring engine | `2.1.0-shadow` (frozen, audit §68), eligibility `2.0.0`, contract `1.0.0` |
| replay harness | `src/lib/reports/__tests__/corpusReplayV2.spec.ts` |
| corpus export | `scripts/scoring/export-scored-corpus.sql` |

The corpus itself is production client data and is deliberately not committed.
The query and the harness are, so the measurement reproduces for anyone with
database access.

## 2. Corpus size

**1,006 reports carry a production V1 investment score**, out of 1,207 live
(non-archived) `investment_reports` rows, spanning 2025-09-16 to 2026-09-08.
All 1,006 were replayed; none was sampled away.

## 3. What the V1 scores were built from

Measured directly from the stored `investment_score` JSON, reproducibly (the
query is in the export file's footer):

| finding | count | of 1,006 |
| --- | ---: | ---: |
| Growth scored **exactly 50** | 1,005 | 99.9% |
| Growth `hasData: true` | **0** | 0.0% |
| Demand scored **exactly 50** | 1,005 | 99.9% |
| Demand `hasData: true` | **0** | 0.0% |
| Location `hasData: true` | 26 | 2.6% |
| Yield `hasData: true` | 26 | 2.6% |
| Risk `hasData: true` | 26 | 2.6% |
| Risk narrative cites the buyer's **LVR** | 235 | 23.4% |
| Risk narrative cites the buyer's **cash flow** | 167 | 16.6% |
| Risk narrative awards a **property-type bonus** | 418 | 41.6% |

Growth carries **0.40** of the composite and Demand **0.15**. So **55% of every
grade this platform has issued is the constant 50** — the exact placeholder the
governing doctrine forbids ("absent is absent, never 0, never 50, never
neutral"). The V1 scorer's own `hasData` flag recorded the absence correctly on
every single report and scored 50 regardless.

Grades issued on that basis: **C 656, C+ 207, D 101, B 39, B+ 3.**

A verbatim example, from a report generated 2026-09-08 (a Moranbah, QLD report printed **B+**): growth score `50` with empty details; risk
details reading *"Moderate LVR (70-80%). Minor negative cash flow. Mitigating
Factors: House typically offers better long-term capital growth."* Two buyer
facts and a property-type bonus are the entire content of that property's Risk
reading — and "better long-term capital growth" is a growth claim scored inside
Risk.

Three further defects surfaced in the same pass:

- **62 reports carry the coordinate pair `-33.8688, 151.2093`** — Sydney CBD,
  the classic hardcoded default. At least one is a Western Australian
  property sitting on Sydney's coordinates.
- **The same property is stored with different rents across reports.** Eight
  addresses carry multiple reports at an identical purchase price with
  different weekly rents (one Cockburn Central, WA property at $540,000 carries
  rents of both $590 and $650), and two of those produce **different
  V1 grades for the same property** (B and C+).
- **31 reports have no `location_intelligence` at all**, and 64 carry a
  commute of "0 minutes to the CBD", which is a field nobody filled rather
  than a property that commutes instantly.

## 4. V2 dimension coverage on the real corpus

Every stored record replayed through the frozen engine, using only what the
record genuinely contains. Nothing substituted, nothing inferred, no
state-level figure standing in for a suburb one.

| dimension | available | % | evidence source | geographic level | acquisition footing |
| --- | ---: | ---: | --- | --- | --- |
| Growth | **0** | 0.0% | none in the record | — | none |
| Location | **975** | 96.9% | `location_intelligence` (walk score, commute, schools) | property | internal, open-derived |
| Yield | **164** | 16.3% | `financial_calculations` (price, rent, outgoings) | property | client-supplied record |
| Demand | **0** | 0.0% | none in the record | — | none |
| Risk | **0** | 0.0% | no property-risk question is answerable | — | none |

Growth and Demand are zero **structurally, not strictly**: the stored blobs
contain no `marketData` key of any kind — no median price series, no vacancy
rate, no days on market, no auction clearance, no vendor discount, no listing
activity, and no population growth. `demographics_data` holds ABS Census
population/employment/income/housing; `economic_data` holds national RBA
inflation and cash-rate figures. Neither is suburb-level market movement, and
ABS is benchmark-only by rule.

Risk is zero because no property-risk question (site hazard, planning,
condition, strata, supply concentration, delivery) is answerable from any
stored record — which is Model D behaving exactly as designed.

**Evidence coverage across the corpus: minimum 0.00, maximum 0.40.** At best,
40% of the composite's nominal weight was ever measured.

## 5. Measured-dimension distribution

| measured dimensions | reports |
| ---: | ---: |
| 5 | **0** |
| 4 | **0** |
| 3 | **0** |
| 2 | 156 |
| 1 | 827 |
| 0 | 23 |

No report in the corpus reaches three measured dimensions. The ceiling is
arithmetic: only Location and Yield are measurable at all, so two is the
maximum any record can attain.

## 6. Grade eligibility under the frozen V2 rules

| | reports |
| --- | ---: |
| Overall-grade **eligible** | **0** of 1,006 |
| Overall-grade **unavailable** | **1,006** of 1,006 |

Reasons, verbatim from the engine:

- 827 × *"Only 1 of 5 scoring dimensions could be measured; at least 3 are required before a grade is stated."*
- 156 × *"Only 2 of 5 …"*
- 23 × *"Only 0 of 5 …"*

No eligibility rule was relaxed to raise this number, and the three-dimension
minimum was not touched. Every one of these is the `MIN_DIMENSIONS_FOR_GRADE`
floor, reached before any A/A+ evidence rule was even consulted.

## 7. V1 vs V2 blast radius

| outcome | reports |
| --- | ---: |
| V1 had a grade, V2 cannot honestly grade | **1,006** (100%) |
| Both graded | 0 |
| Same grade | 0 |
| Moved one band | 0 |
| Moved two or more bands | 0 |
| V2 materially higher than V1 | 0 |
| V2 materially lower than V1 | 0 |

**The movement is not a disagreement about value — it is the difference between
a grade and no grade.** V1 produced a letter for every report because it
substituted 50 for the two dimensions it had no data for. V2 produces no letter
for any report because it refuses to. There is no band-movement distribution to
report, and that absence is the finding.

This is not a claim that these properties are poor investments. It is a claim
that **the overall letter grade was never evidenced**. The rest of each report —
the financial modelling, the location intelligence, the demographics, the
projections — is unaffected by this analysis.

## 8. State-level distribution

State is parsed from the free-text address label for this breakdown only; it is
never used as geography for evidence.

| state | reports | V2 graded | Yield measured | Location measured |
| --- | ---: | ---: | ---: | ---: |
| (no state token in label) | 777 | 0 | 29 | 772 |
| VIC | 74 | 0 | 45 | 57 |
| WA | 73 | 0 | 49 | 71 |
| QLD | 65 | 0 | 29 | 59 |
| NSW | 17 | 0 | 12 | 16 |

**777 of 1,006 address labels carry no state token at all** — many are
placeholders like `"Properties in <postcode>"` or a bare street name. This is the
same finding `backtestInput.pure.ts` records: suburb, postcode and state are
stored nowhere structurally, on any row.

## 9. Representative real-record traces

A stratified sample across state, metro/regional, yield, leverage, cash flow,
dwelling type and record completeness. Every row is a real stored report,
unmodified.

| stratum | state | property | V1 | V2 measured | coverage | V2 grade | finance reading |
| --- | --- | --- | --- | --- | ---: | --- | --- |
| QLD | QLD | Gympie, QLD | 51 C | location 42, yield 50 | 0.40 | none | under pressure |
| WA | WA | Tuart Hill, WA | 61 B | location 70, yield 81 | 0.40 | none | stretched |
| VIC | VIC | Truganina, VIC | 49 C | location 55, yield 18 | 0.40 | none | under pressure |
| NSW | NSW | Kellyville, NSW | 47 C | location 62, yield 23 | 0.40 | none | stretched |
| metro (short commute) | WA | East Perth, WA | 64 B | location 83, yield 87 | 0.40 | none | stretched |
| regional (long commute) | ? | (postcode-only label) | 41 D | location 60 | 0.25 | none | stretched |
| high yield | QLD | Gympie, QLD | 51 C | location 42, yield 100 | 0.40 | none | under pressure |
| low yield | NSW | Kellyville, NSW | 50 C+ | location 62, yield 23 | 0.40 | none | stretched |
| high LVR (≥90) | ? | (lot-only label) | 45 C | location 50, yield 35 | 0.40 | none | under pressure |
| positive cash flow | QLD | Moranbah, QLD | 66 B+ | location 34, yield 97 | 0.40 | none | manageable |
| negative cash flow | ? | (postcode-only label) | 41 D | location 0 | 0.06 | none | under pressure |
| house | ? | (lot-only label) | 53 C+ | location 50, yield 35 | 0.40 | none | stretched |
| attached dwelling | WA | Midland, WA | 61 B | location 69, yield 70 | 0.40 | none | stretched |
| land only | QLD | Bowen, QLD | 39 D | location 4 | 0.25 | none | — |
| complete record | QLD | Gympie, QLD | 51 C | location 42, yield 45 | 0.40 | none | under pressure |
| sparse record | ? | (postcode-only label) | 41 D | (none) | 0.00 | none | — |
| placeholder type | WA | Rockingham, WA | 54 C+ | location 55, yield 60 | 0.40 | none | stretched |

Two things read straight off the table. **V1's ordering is not V2's**: the Moranbah positive-cash-flow report is V1's best sampled report (66, B+) while its measured location
is 34 — its V1 grade was carried by two constants and a property-type bonus.
And **no low-LVR stratum exists**: no report in the corpus states an LVR at or
below 60%.

## 10. Why evidence is unavailable, by dimension

- **Growth** — no suburb median price series exists in any stored record, and
  none can be acquired at $0 for the states that matter. Re-verified
  2026-09-11: Queensland's open data portal publishes no median residential
  sale price series (best matches are social-housing performance indicators and
  cadastral boundaries); Western Australia's only candidate, Landgate's Sales
  Evidence data, is `Custom (Other)` licensed with terms unestablished; and none
  of the 1,227 published ABS dataflows carries suburb-level price. QLD and WA
  are 71% of the sealed ME-7 population.
- **Demand** — no vacancy, days-on-market, auction clearance, vendor discount,
  sales count, listing activity or population-growth figure is stored on any
  row.
- **Risk** — no property-risk question is answerable from the record;
  `MINIMUM_INDEPENDENT_CATEGORIES = 2` is never reached.
- **Yield** — absent on 842 rows because no rent, no price, or neither is
  stored; `financial_calculations` is present on only 210 of 1,207 live rows.
- **Location** — absent on 31 rows that carry no `location_intelligence` block.

## 11. Mathematical and invariant checks

All executed over the full 1,006-record replay, all passing:

| check | result |
| --- | --- |
| No `NaN` anywhere in any result | pass |
| No `Infinity` anywhere | pass |
| No dimension score outside 0–100 | pass |
| Unavailable is `null`, never 0 | pass (every unavailable dimension asserted null) |
| Unmeasured dimension carries effective weight 0 | pass |
| Effective weights sum to 1 wherever a composite exists | pass |
| Printed grade never better than the score's own grade | pass |
| Below the three-dimension floor there is no grade, with a stated reason | pass |
| Buyer finance does not alter the property score | pass — every record re-scored with the buyer block emptied is **byte-identical** on the property side |
| Output contract reconciles to the scorer | pass |
| Identical stored input replays identically | pass |

## 12. Scoring V2 defects discovered

**None.** Every behaviour observed is the frozen methodology operating as
specified. The zero-grade outcome is `MIN_DIMENSIONS_FOR_GRADE` refusing to
state a headline on one or two measured dimensions — the rule working, not
failing.

## 13. Correctness conclusion

**Scoring correctness at $0: achievable and now demonstrated, but not yet
shipped.**

The frozen V2 engine, run against 1,006 real production records, never
substituted a constant, never let an absence become a zero, never let the
buyer's position touch the property score, and never stated a grade it could
not support. It is correct. What it reveals is that **the evidence base behind
the live grade does not exist** — which is a data problem, not a methodology
problem, and it is the same problem whichever engine is running.

The live V1 score, by contrast, is structurally wrong on 100% of the corpus: it
publishes a letter grade in which 55% of the weight is a hardcoded 50, and on
41.6% of reports it awards property-quality points for the dwelling type while
on 23.4% it moves the grade with the buyer's own borrowing ratio.

## 14. Empirical market calibration — explicitly deferred

Calibrating V2's thresholds against real market outcomes still requires
representative licensed, open or trial suburb Growth evidence for QLD and WA,
which does not exist at $0 (§10). **That limitation no longer blocks
correctness work or Reporting work**, and it must not be allowed to again: the
two questions are independent, and this closeout answers the first without the
second.

Domain and PropTrack conversations may continue in parallel. No data is to be
purchased.

## 15. Recommended policy — new reports

**Publish an overall letter grade only when the frozen V2 eligibility rules are
satisfied. Where they are not, publish the measured dimensions, the evidence
coverage and the explicit unavailable reasons instead — and no letter.**

Concretely, the report would carry:

> **Overall Investment Grade — unavailable.** Insufficient measured evidence.
> Rental yield: measured. Location: measured. Capital growth: not assessed.
> Market demand: not assessed. Property risk: not assessed. Evidence coverage:
> 40%.

No scoped or partial letter grade is invented, per direction. The dimensions
that were measured remain individually reportable, because they are real.

This is a significant change to what a report looks like, and on today's
evidence it would remove the headline grade from effectively every new report
until Growth and Demand evidence is connected. That consequence is the reason
this document stops at a recommendation.

## 16. Recommended policy — historical reports

**Leave every historical V1 score exactly as stored. Do not rewrite, do not
recompute, do not backfill.** An issued report is a record of what was sent to
a client on a date, and altering it destroys that record.

Two things are worth doing instead, when directed:

1. **Stamp, don't change.** Historical scores carry no methodology version
   (`investment_score` has no version field). A forward-only marker recording
   that a score predates the correctness standard costs nothing and makes the
   corpus self-describing.
2. **Decide the disclosure question separately.** Whether clients holding a
   report with an unevidenced grade should be told is a commercial and legal
   judgement, not a technical one. This document does not make it.

## 17. Exact criteria required before production activation

Activation (ME-8) should require **all** of:

1. A genuine Growth evidence source connected, with a recorded acquisition
   footing that is not `commercial_upgrade_required`, reaching QLD and WA.
2. Suburb geography resolvable for the corpus — coordinates mapped to suburb
   through the canonical mapping, so evidence attaches to the right property.
   Today suburb, postcode and state are stored on **zero** rows.
3. A real ME-7 historical backtest executed on that evidence, with the
   dimension breakdowns, A/A+ audits and fairness tests.
4. Calibration performed only against demonstrated defects, each recorded in
   before/defect/correction/after form, with the backtest re-run after any
   change.
5. The new-report policy (§15) explicitly approved, because it changes what a
   client sees.
6. A feature flag with a tested rollback, shadow-vs-live comparison available
   to developers only, and **no mass backfill of historical reports**.
7. Trial-footed evidence never reaching a client-facing report.

Until all seven hold, Scoring V2 remains shadow-only and the production score
is unchanged.
