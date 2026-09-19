# Investment Property Report — contradiction register

**RF-7.2A. Surfaced, NOT repaired.** Rule 18: approval comes before remediation.
Nothing in this document was changed in production. Every figure below was
measured by execution against the live database on 2026-09-11.

---

## §1 — `demographics_data` labelled "ABS Census 2021" is GENERATED, not retrieved

**The most serious finding of RF-7.2A.**

| | |
| --- | --- |
| **Fact** | Population, median household income, median rent, unemployment rate, population growth |
| **Source A (what the report claims)** | `demographics.*.source = "ABS Census 2021 estimates"`, `dataSource = "ABS Census Estimates"` — **855 reports** |
| **Source B (the real thing)** | `public.abs_census_poa` — 2,643 rows of genuine ABS Census 2021 data, keyed by POA |
| **Current production choice** | Source A. It is stored on the row and was injected into the generation prompt. |
| **Canonical choice** | Source B where the postcode resolves; otherwise **unavailable**. |

### The evidence that it is generated rather than retrieved

616 reports can be joined to the real table on their own resolved postcode:

| Measure | Result |
| --- | --- |
| Population exact matches | **0 of 616** |
| Median rent exact matches | **0 of 616** |
| Median household income within one week's income | **0 of 616** |
| Unemployment exact matches | 6 of 616 |
| Mean absolute population error | **18,519 people (197.1%)** |
| Mean absolute median-rent error | **$246/week (78.4%)** |
| Mean absolute income error | **$34,768/year** |

Four independent checks rule out every benign explanation:

1. **Correlation with the real figure is ~zero** — population **r = 0.0394**,
   median rent **r = 0.0620**. Real data at a coarser grain (SA2, LGA, SA3)
   would still correlate strongly: a populous postcode sits in a populous SA2.
2. **The error is symmetric** — 310 rows higher, 306 lower. A grain difference
   is systematically one direction; a vintage difference likewise.
3. **The ranges are generator ranges** — stored population spans 10,900–49,530
   against a real 91–129,888; stored median rent 416–728 against a real 75–850.
   The stored values sit inside a narrow band the real data exceeds at both ends.
4. **The same postcode yields different values** — **87 of 206** postcodes carry
   more than one stored population. Real census data for one postcode is one
   number.

### Client impact — it reaches the page

| Measure | Reports |
| --- | ---: |
| Print the generated population verbatim in the body | **238** |
| Print the generated median rent | **80** |
| Print the generated median household income | **119** |
| Print at least one of population or income | **272** |
| Cite "ABS Census" in the prose | **262** |
| **Print a generated figure AND cite ABS Census in the same document** | **104** |

| | |
| --- | --- |
| **Safe to fix now?** | **No.** Correcting the stored blob would rewrite historical reports (rule 18 forbids it) and the prose is already written. |
| **Required future stage** | RF-7.2B+: (a) stop the generated values reaching new reports; (b) route to `abs_census_poa` where the postcode resolves; (c) decide with the owner what to do about 855 delivered documents — a disclosure, a reissue, or neither. **That is a business decision, not an engineering one.** |

## §2 — `annualOutgoings`' fallback is inert, and the two totals differ by land tax

| | |
| --- | --- |
| **Fact** | Total annual outgoings |
| **Source A** | `financial_calculations.annualCosts.totalAnnualExcludingLandTax` — 173 rows |
| **Source B** | `financial_calculations.annualCosts.total` — **0 rows**. `calculateAnnualCosts` has never emitted this key. |
| **Also present** | `annualCosts.totalAnnual` — 208 rows, **includes land tax** |
| **Current production choice** | A, then B. B can never fire, so 35 rows resolve the fact as **absent**. |
| **Canonical choice** | A, with its basis stated. |
| **Client impact** | None today. The accidental outcome is the correct one. |
| **Safe to fix?** | **Not as written.** Pointing the fallback at `totalAnnual` would silently change a published figure's basis from ex-land-tax to inc-land-tax. |
| **Required future stage** | A labelled `BasedMetric`-style answer, not a second path. |

## §3 — The RBA cash rate is a hardcoded constant, and it is now 75bp wrong

| | |
| --- | --- |
| **Fact** | RBA official cash rate |
| **Source A** | `economic_data.cashRate.current = 4.35`, `source = "RBA Official Cash Rate (estimated)"` — **1,035 reports**, a single constant |
| **Source A′** | `source = "RBA Official Cash Rate (via Perplexity real-time search)"` — 78 reports, values 4.1 and 4.35. **An LLM web search labelled as the RBA.** |
| **Source B** | `public.rba_observations` — 433 cash-rate observations, 1990-08 to 2026-08 |
| **Current production choice** | A |

Measured against the RBA's own published figure on each report's generation date:

| Error band | Reports |
| --- | ---: |
| Exact | 37 |
| ≤ 25bp | 47 |
| 25–50bp | 2 |
| **50–75bp** | **1,035** |
| **Total disagreeing** | **1,084 of 1,121** |
| Worst error | **0.75 percentage points** |
| **Print the wrong rate in the report body** | **422** |

### Correction to the first reading of this finding

RF-7.2A's first write-up said the rate "moved 4.35 → … → 3.60; the constant was
right only at the start." **That was backwards**, and RF-7.2B's semantic check of
the series established the true shape. The counts above are measured and stand;
the direction did not.

What actually happened, by report generation month:

| Month | Reports | Stored | RBA target | Signed error |
| --- | ---: | ---: | ---: | ---: |
| 2025-10 | 9 | 4.35 | 3.60 | **+0.75** |
| 2025-11 | 96 | 4.35 | 3.60 | **+0.75** |
| 2025-12 | **695** | 4.35 | 3.60 | **+0.75** |
| 2026-01 | 235 | 4.35 | 3.60 | **+0.75** |
| 2026-04 | 7 | 4.10–4.35 | 3.96 | +0.21 |
| 2026-05 | 28 | 4.35 | 4.10 | +0.25 |
| 2026-06 | 14 | 4.35 | 4.31 | +0.04 |
| 2026-07 | 6 | 4.35 | 4.35 | **0.00** |
| 2026-08 | 12 | 4.35 | 4.35 | **0.00** |
| 2026-09 | 19 | 4.35 | 4.35 | **0.00** |

The target was **3.60** through the months that produced 1,035 of these reports,
and rose back to 4.35 by mid-2026. So the constant **overstated** the cash rate
by 75 basis points on the bulk of the corpus, and is **accidentally correct
today**.

That makes the finding worse rather than better. A hardcoded constant that
happens to be right is the most dangerous kind: nothing in the product will
reveal it, and it becomes wrong again silently at the next RBA move.

### The series semantics, established before any wiring

`rba_series_meta` for `FIRMMCRT`:

| field | value |
| --- | --- |
| title | **Cash Rate Target** |
| description | **"Cash Rate Target; monthly average"** |
| frequency | Monthly |
| table_code | f1.1 |
| last_observation | 2026-08-31 |
| publication_date | 01-Sep-2026 |

It is a **monthly average of the target**, not a spot rate. In a month with no
change the average equals the target (3.60, 3.85, 4.10, 4.35 are on the 25bp
ladder); in a month containing a change it does not (4.31, 3.96, 3.83, 3.70 are
transition-month averages).

So the honest label is *"RBA cash rate target, monthly average for &lt;month&gt;,
published &lt;date&gt;"* — **not** "the current cash rate". A change in the
current month is not yet in this series, which is precisely the kind of
substitution §4 of the RF-7.2B mandate forbids.

| | |
| --- | --- |
| **Client impact** | Material. The cash rate frames the interest-rate assumption a client reads beside a ten-year projection. |
| **Safe to fix?** | Forward-only, yes — read `rba_observations`. Historical rows must not be rewritten. |
| **Required future stage** | RF-7.2B: point the economic block at `rba_observations` and carry `publicationDate`. |

## §4 — Weekly rent does not record whether it is an appraisal or an achieved rent

| | |
| --- | --- |
| **Fact** | `weeklyRent` |
| **Source A** | `manual_overrides.weeklyRent` — an operator-stated figure |
| **Source B** | `financial_calculations.income.weeklyRent` — its derivative |
| **Contradiction** | Neither records **what kind of rent it is**. An agent's appraisal, a current lease and a market estimate are three different facts, and every yield in the report is built on whichever it was. No `rentalAppraisalDate` is stored anywhere. |
| **Client impact** | A gross yield presented as fact may rest on an appraisal nobody has tested. |
| **Safe to fix?** | No — the information was never captured; it cannot be recovered from the record. |
| **Required future stage** | Capture rent basis and appraisal date at intake. Until then the report should disclose that rent is as-supplied. |

## §5 — Demographic data is POA-grain and the report reads as suburb

| | |
| --- | --- |
| **Fact** | Every demographic statistic |
| **Grain actually held** | **POA — a postcode**, in both `abs_census_poa` and the generated blob's own label (`"ABS Census 2021 (POA 3024)"`) |
| **Grain the report implies** | the suburb named on the cover |
| **Why it matters** | A postcode routinely spans several suburbs of very different character. A postcode median is not a suburb median. |
| **Geography actually available** | `report_geography` carries `suburb`, `postcode`, `sa2_name`, `sa3_name`, `sa4_name`, `gccsa_name` and `remoteness_area` — the grain is known, it is simply not disclosed beside the figure. |
| **Safe to fix?** | Disclosure only — additive, and a presentation change. |
| **Required future stage** | RF-7.2B presentation standard: every market statistic carries its grain. |

## §6 — `transport.qualityScore` is an invented score still stored on 1,108 reports

| | |
| --- | --- |
| **Fact** | A transport "quality score" |
| **Source A** | `location_intelligence.transport.qualityScore` — **1,108 rows** |
| **Source B** | `public-transport-service` today returns **no score and no mode**, deliberately — the invented `qualityScore` is what corrupted the walk score (`TRANSPORT_SOURCES.md`) |
| **Current production choice** | The stored A is still on the row and still readable. |
| **Client impact** | Any surface reading it prints a score the platform has disowned. |
| **Safe to fix?** | Forward-only. Do not rewrite stored rows. |
| **Required future stage** | Stop reading it; it is not in the Report Fact Contract. |

## §7 — `cashRate.current` is a scalar on 1,113 rows and an object on 8

One path, two shapes: `4.35` versus `{"value": 4.35, "period": "2026-08",
"periodLabel": "August 2026"}`. A reader written for either shape produces
`undefined` on the other — and `Number(undefined)` is `NaN`, which a formatter
turns into an empty string with no error anywhere.

**Safe to fix?** Only by reading both shapes. Not changed here.

## §8 — The three Location inputs remain untrusted (carried from audit §69)

| Input | Measured defect |
| --- | --- |
| `walkScore` | reproduces a per-state constant on **1,109 of 1,114** |
| `commute.durationMinutes` | mean **10,125 minutes**; 494 non-NSW reports routed to Sydney |
| `schools.schoolsWithin3km` | at the ceiling on **851 of 1,114** |

Already excluded from scoring (audit §69). **They are still stored and still
readable by a renderer**, and `schools_directory` holds only **29 rows** — far too
few to cover the corpus.

## §9 — Real-source coverage is 12 of 1,207 reports

`data_sources` carries `crimeStatistics`, `climate`, `seifa`, `employment`,
`economics`, `investmentScore` and `riskAssessment` on **12 rows**, against
`demographics` / `financials` / `locationIntelligence` / `marketData` on 1,057.
`climate_normals_cache` holds **2 rows**.

The genuine data acquired by the R/C/M programmes reaches almost no report.
**Not a defect in those loaders** — a wiring gap between them and the generator.

## §10 — Absent becomes zero at the presentation layer (latent)

Proved by execution against `bindingResolver.resolveBindable`:

| Value bound | `{{x \| percent:0}}` | `{{x \| currency}}` | `{{x}}` |
| --- | --- | --- | --- |
| key missing | `""` ✓ | `""` ✓ | `""` ✓ |
| explicit `null` | **`"0%"`** | **`"$0"`** | `""` |
| empty string | **`"0%"`** | **`"$0"`** | `""` |
| genuine `0` | `"0%"` | `"$0"` | `"0"` |

The formatter runs **before** the null check, and `Number(null)` is `0`. Today
this is masked because `reportBindingProjection.put()` refuses `undefined`,
`null` and `''` — so absent facts are missing keys. **The guarantee rests
entirely on that one function**; any adapter that writes a `null` re-opens it.

Note also that a genuine zero and an absence render identically — `$0` either
way — so the output cannot distinguish "no cash flow" from "cash flow unknown".

**Safe to fix?** Yes and small (null-check before filtering), but it is a
production behaviour change and rule 18 defers it.

---

## Summary

| Class | Count |
| --- | ---: |
| Semantic mismatches (label ≠ meaning) | **6** (§1, §3, §5, §6, §8, and the appraisal gap §4) |
| Source contradictions | **4** (§1, §2, §3, §6) |
| Geography-grain mismatches | **2** (§5, §8) |
| Temporal / as-of issues | **3** (§3, plus `referencePeriod` on 8 of 1,085 rows, plus Census 2021 beside 2026 market data undisclosed) |
| Financial-basis issues | **3** (§2, §4, and origination-vs-current LVR, already labelled) |
| Structural / shape | **2** (§7, §10) |
| Coverage gaps | **1** (§9) |

**Production behaviour changed by RF-7.2A: NONE.**
