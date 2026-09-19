# Investment Property Report — source provenance map

**RF-7.2A. Read-only.** The end-to-end path for every material fact, and the
points at which a fact can be lost, renamed, defaulted or changed.

```
SOURCE → INGESTION → STORED FIELD → NORMALISER → CALCULATION
       → REPORT FACT CONTRACT → PRESENTATION BINDING
```

---

## §1 Property and finance — operator-originated

| Stage | What happens | Loss / rename / default risk |
| --- | --- | --- |
| **Source** | An operator types the deal, or a listing is imported (`scrape-property-listing`, `parse-property-pdf`) | Rent basis (appraisal vs achieved) is **never captured** — contradictions §4 |
| **Ingestion** | `generate-investment-report` normalises `propertyDetails` aliases | Historical rows used `\|\| 0` defaults; removed forward-only |
| **Stored field** | `manual_overrides` (operator parameters), `property_specs` (specs), `financial_calculations` (the calculator's answer) | `property_specs.{price,weeklyRent,state,propertyType}` are read by legacy code and **written by nothing** — `PHANTOM_SPEC_KEYS` |
| **Normaliser** | `readPropertyFacts` reads BOTH stores because snake_case and camelCase are two spellings of one fact | Reading only one is how 127 land sizes went missing |
| **Calculation** | `financialEngine` — annual costs, projections, key metrics; `stampDuty/engine` — duty and acquisition costs | `deposit + loan = price` breaks on **21 rows**; healed **on read**, never written |
| **Contract** | `buildReportFactContract` via `historicalFactAuthority` (override = observed, finance block = derived) | Measured zero disagreement on 443 paired rows |
| **Binding** | `projectInvestmentReport` → `{{financials.*}}`, `{{property.*}}` | `put()` refuses `undefined`/`null`/`''`, which is the whole "absent stays absent" guarantee |

**Verdict: sound.** This is the part of the report that is genuinely
evidence-based, and RF-7.1 proved it reproduces exactly.

## §2 Geography — deterministic, and the strongest chain in the report

| Stage | What happens |
| --- | --- |
| **Source** | ABS ASGS 2021 boundaries |
| **Ingestion** | `resolve-report-geography`, point-in-polygon against the coordinate |
| **Stored field** | `public.report_geography` — 1,114 rows, **867 resolved** |
| **Normaliser** | none needed; the resolver writes canonical ASGS identifiers |
| **Contract** | `contract.geography.*`, sourced from the table alone |
| **Binding** | not currently bound by any active template |

**The free-text address is never consulted** (`ADDRESS_COMPOSITION.md`).
`status` and `flags` name a sentinel coordinate rather than hiding it — 64 rows
carry `geocode_failure_value`.

**Verdict: sound, and under-used.** The grain the report needs to disclose is
already resolved and stored; nothing reads it at render time.

## §3 Market data — where the chain breaks

### 3.1 Demographics

```
ABS Census 2021  →  load-abs-census (POA)  →  abs_census_poa (2,643 rows)   ← GENUINE
                                                     │
                                                     └── reaches 8 of 1,207 reports

[no source]      →  a generator                →  demographics_data          ← GENERATED
                     labelled "ABS Census 2021 estimates"
                                                     │
                                                     └── reaches 855 reports
                                                     └── injected into the prompt
                                                     └── printed verbatim in 272 bodies
```

**The break is between ingestion and the stored field.** The genuine table
exists, is loaded, and is bypassed. Contradictions §1 has the proof.

### 3.2 Economics

```
RBA F1.1 / F5   →  rba ingest  →  rba_observations (433 cash-rate obs)       ← GENUINE
                                        └── reaches 8 reports

hardcoded 4.35  →  —           →  economic_data.cashRate                     ← CONSTANT
                                        └── 1,035 reports, 50–75bp wrong
                                        └── printed in 422 bodies

Perplexity      →  LLM search  →  economic_data.cashRate                     ← LLM SEARCH
                                        └── 78 reports, labelled "RBA"
```

### 3.3 Crime, climate, SEIFA, transport, schools

| Source | Table | Rows | Reaches |
| --- | --- | ---: | --- |
| BOCSAR / QPS / SAPOL / NT | `crime_reference` | 23,145 | 12 reports |
| SILO (BoM-derived) | `climate_normals_cache` | **2** | ~nothing |
| ABS SEIFA 2021 | `abs_seifa_poa` | 2,627 | 12 reports |
| State GTFS feeds | `transport_stops` | 185,177 | via `public-transport-service` |
| — | `schools_directory` | **29** | cannot cover the corpus |

`data_sources` records `crimeStatistics`, `climate`, `seifa`, `employment`,
`economics` on **12 of 1,207** reports.

**Verdict: the loaders work and the wiring does not.** Every genuine source
acquired by the R/C/M/G programmes is present in the database and absent from
the report.

### 3.4 The legacy Location trio

`location_intelligence.{walkScore, commute, schools}` — generated, measured
defective (audit §69), excluded from scoring, **still stored and still readable**
on 1,114 rows. `transport.qualityScore` likewise on 1,108.

## §4 Scoring

```
investment-scoring-service  →  investment_score (+ policy stamp)
                                  │
                                  ├── historical rows: no stamp → legacy_snapshot, rendered as issued
                                  └── new rows: authority = 'unavailable' → grade withheld
                            →  contract.scoring (reads the stamp, decides nothing)
                            →  {{recommendation.*}}, {{assessment.*}}
```

**Verdict: sound since audit §69.** The contract reads the stamp and never
re-decides.

## §5 Narrative — the model's path

```
row + enhancedData  →  prompt (facts interpolated as pre-formatted markdown tables)
                    →  model writes report_content
                    →  compassPostProcessor (strips editorial labels)
                    →  runQAValidation (7 STRUCTURAL rules)
                    →  reconcileFacts (9 NUMERIC facts)
                    →  validation_flags on the row
```

`reconcileFacts` compares the prose against `CanonicalFacts`:

| Reconciled (9) | Not reconciled |
| --- | --- |
| bedrooms, bathrooms, carSpaces | **every market statistic** |
| purchasePrice, weeklyRent, landSizeSqm | population, income, median rent, unemployment |
| grossYieldPct, netYieldPct, lvrPct | cash rate, inflation, crime, climate |
| | transport, schools, growth, vacancy |
| | every projection value |

**Verdict on narrative factuality: the architecture is right and the inputs are
wrong.**

The model is instructed not to invent figures (`"never invent exact figures"`,
`"NO FABRICATED PRECISION"`), the deterministic finance figures are injected with
an explicit order — *"USE THESE EXACTLY — DO NOT RECALCULATE"* — and nine of them
are reconciled against the output afterwards.

**So the model is not originating these numbers.** It is faithfully reproducing
numbers the platform handed it. The defect in contradictions §1 and §3 is
upstream of the model, and no narrative guard could have caught it: a reconciler
that compares the prose against the injected facts will find perfect agreement,
because the prose and the facts are both wrong in the same way.

That is the single most important structural lesson of RF-7.2A: **reconciling
the narrative against the injected facts proves faithfulness, not truth.**

## §6 The eleven points where a fact can change meaning

| # | Point | Current risk |
| --- | --- | --- |
| 1 | Intake — rent basis not captured | **live** |
| 2 | Spec phantom keys | mitigated (contract reads none) |
| 3 | snake_case vs camelCase spellings | mitigated (`readPropertyFacts` reads both) |
| 4 | `deposit + loan ≠ price` | mitigated (healed on read, 21 rows) |
| 5 | Generated demographics bypassing `abs_census_poa` | **live — 855 reports** |
| 6 | Hardcoded cash rate bypassing `rba_observations` | **live — 1,035 reports** |
| 7 | POA grain presented as suburb | **live** |
| 8 | No `referencePeriod` on 1,077 of 1,085 demographics rows | **live** |
| 9 | `cashRate.current` scalar-vs-object | **live (latent)** |
| 10 | Formatter turning `null` into `0` | **live (latent)** — masked by `put()` |
| 11 | Inline expressions permitted in templates | **live (latent)** — 0 in use |

## §7 What would make the chain sound

Recorded for RF-7.2B+, not built here, in the order that removes the most risk:

1. Route demographics to `abs_census_poa`; refuse rather than generate.
2. Route the cash rate to `rba_observations`; carry `publicationDate`.
3. Disclose grain and as-of beside every market statistic.
4. Extend `reconcileFacts` beyond the 9 property/finance facts — but only once
   the injected facts are sound, since reconciliation proves faithfulness rather
   than truth.
5. Null-check before filtering in `bindingResolver`.
6. Refuse `{{=` in production-safe templates.
7. Decide, with the owner, what is owed to the 855 delivered reports.
