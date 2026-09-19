# Investment Property Report — master data dictionary

**RF-7.2A. Read-only. No production behaviour changed.**

RF-7.1 proved **current-path parity**: the Report Fact Contract reproduces what
the platform already produces, 896 of 896 comparisons. This document asks the
different and harder question — **is what the platform produces what its label
says it is?**

A value can match production perfectly and still be semantically wrong. Six of
the facts below are exactly that, and they are marked **NOT CLIENT SAFE**.

## Legend — client-safe classification (§17 of the mandate)

| Class | Meaning |
| --- | --- |
| **A — AUTHORITATIVE** | Observed, owned, trusted. Display with confidence. |
| **D — DERIVED** | Computed deterministically from A-class inputs. Its basis must travel with it. |
| **C — CONTEXTUAL** | Valid, but its geography, grain or date must be disclosed or it misleads. |
| **X — NOT CLIENT SAFE** | Untrusted, ambiguous, or semantically not what its label claims. |
| **U — UNAVAILABLE** | No evidence held. Absent, never substituted. |
| **F — FUTURE SOURCE** | Planned provider/open-data integration. Not held today. |

Temporality: **S** = snapshot (stored at generation, never recomputed),
**R** = derived on read, **L** = live column.

---

## 1. Property

| Field | Client meaning | Owner | Source | Source path | Unit | Geography | As-of | Basis | Trust | Fallback | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `address` | The property's address | `listingAddress` / operator | operator entry or import | `investment_reports.property_address` | text | property | generation | free text, **not composed from parts** | operator-stated | none | **A** |
| `propertyType` | House / unit / townhouse / land | `propertyRecord.pure.ts` | operator or listing | `property_specs.property_type` → `manual_overrides.propertyType` | enum | property | S | `meaningfulPropertyType`; **never defaulted** | operator-stated | none — absent stays absent | **A** |
| `normalisedType` | The engine's class | `propertyRecord.pure.ts` | derived from the above | — | enum | property | R | `normalisePropertyType`; undefined rather than guessed | derived | none | **D** |
| `bedrooms` | Bedroom count | `propertyRecord.pure.ts` | operator or listing | `property_specs.bedrooms` → `manual_overrides.bedrooms` | count | property | S | — | operator-stated | none | **A** |
| `bathrooms` | Bathroom count | `propertyRecord.pure.ts` | operator or listing | `property_specs.bathrooms` | count | property | S | — | operator-stated | none | **A** |
| `carSpaces` | Parking spaces | `propertyRecord.pure.ts` | operator or listing | `property_specs.parking` → `manual_overrides.carSpaces` | count | property | S | spelled `parking` in specs, `carSpaces` in overrides | operator-stated | none | **A** |
| `landSize` | Land area | `propertyRecord.pure.ts` | operator or listing | `property_specs.land_size_sqm` | m² | property | S | — | operator-stated | none | **A** |
| `buildingSize` | Building area | `propertyRecord.pure.ts` | operator or listing | `property_specs.building_size_sqm` | m² | property | S | — | operator-stated | none | **A** |
| `yearBuilt` | Year of construction | `propertyRecord.pure.ts` | operator or listing | `property_specs.year_built` | year | property | S | — | operator-stated | none | **U** — present on **0** of the 32-row cohort; no writer has captured it |
| `zoning`, `councilArea` | Planning context | `propertyRecord.pure.ts` | operator or listing | `property_specs.zoning`, `.council_area` | text | property/LGA | S | — | operator-stated | none | **A** |
| `images` | Photographs of the property | `prepare-report-hero-images` / storage | operator upload or listing harvest | storage refs; `{{property.images.0..2}}` | — | property | S | — | operator-supplied | placeholder banner | **A** |

**Phantom keys.** `property_specs.price`, `.weeklyRent`, `.state` and
`.propertyType` are read by some historical code and **written by nothing, ever**
(`PHANTOM_SPEC_KEYS`). JSONB returns `undefined`, `Number(undefined)` is `NaN`,
and a `||` chain silently takes the next rung. The Report Fact Contract reads
none of them.

## 2. Acquisition and finance — the BUYER's position, never property quality

| Field | Client meaning | Owner | Source | Source path | Unit | As-of | Basis | Trust | Fallback | Class |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `purchasePrice` | Contract price | `historicalFactAuthority` | operator | `manual_overrides.purchasePrice` → `financial_calculations.initialCosts.propertyValue` | AUD | S | the override IS the calculator's input; the finance block is its derivative | operator-stated (measured 140/140 agreement) | derived block | **A** |
| `weeklyRent` | Rent per week | `historicalFactAuthority` | operator / appraisal | `manual_overrides.weeklyRent` → `financial_calculations.income.weeklyRent` | AUD/wk | S | **appraisal or achieved is NOT recorded** — see contradictions §4 | operator-stated (150/150) | derived block | **C** |
| `annualRent` | Rent per year | `rentBasis.pure.ts` | derived | — | AUD/yr | R | `weeklyRent × 52` | derived | none | **D** |
| `deposit` | Cash contributed | `financialEngine` | calculator | `financial_calculations.initialCosts.deposit` | AUD | S | — | derived | none | **D** |
| `loanAmount` | Loan drawn at settlement | `financialEngine` | calculator | `financial_calculations.loanDetails.loanAmount` | AUD | S | **never reconstructed as `price − deposit`** (identity breaks on 21 rows) | derived | none | **D** |
| `lvr` | Loan-to-value ratio | `historicalFactAuthority` | operator / calculator | `manual_overrides.loanToValueRatio` → `financial_calculations.keyMetrics.lvr` | % | S | **origination**, on purchase price | operator-stated (153/153) | derived block | **D** |
| `stampDuty` | Transfer duty | `stampDuty/engine.pure.ts` | calculator at generation | `financial_calculations.initialCosts.stampDuty` | AUD | S | state schedule at generation date; intent/concession **not recorded**, so never recomputed on read | derived | none | **C** — its schedule vintage is not stored |
| `acquisitionCosts` | Legal, inspection, fees | `stampDuty/engine.pure.ts` | calculator | `financial_calculations.initialCosts.*` | AUD | S | `estimateOtherAcquisitionCosts` | derived | none | **D** |
| `totalUpfront` | Total cash to complete | `financialEngine` | calculator | `financial_calculations.initialCosts.totalUpfront` | AUD | S | deposit + acquisition lines; re-derived on read when it does not foot | derived | re-derivation | **D** |

## 3. Yield

| Field | Owner | Basis | Expenses | Class |
| --- | --- | --- | --- | --- |
| `grossYield` | `propertyMetrics.grossYield` | **purchase price** (`BasedMetric.basis`) | none — before every cost | **D** |
| `netYield` | `propertyMetrics.netYield` | **purchase price** | operating costs **excluding land tax** and **excluding debt service** — unlevered by design | **D** |
| `cashOnCash` | `propertyMetrics.cashOnCashReturn` | cash invested | levered — **not** comparable with net yield | **D** |
| `originationLvr` | `propertyMetrics.originationLvr` | purchase price, settlement loan | — | **D** |
| `currentLvr` | `propertyMetrics.currentLvr` | present value, remaining balance | — | **U** — neither input is stored on an investment report |

**The rule that must travel:** origination LVR and current LVR are different
quantities that coincide only at settlement; a purchase-price yield and a
current-value yield likewise. `labelFor()` prints the basis into the label, and
that label is the fact.

## 4. Cash flow

| Field | Owner | Source path | Frequency | Treatment | Class |
| --- | --- | --- | --- | --- | --- |
| `weeklyCashFlow` | `historicalFactAuthority` | `financial_calculations.keyMetrics.weeklyNet` | weekly | after interest, after operating costs, **before tax** | **D** |
| `annualOutgoings` | `historicalFactAuthority` | `…annualCosts.totalAnnualExcludingLandTax` → `…annualCosts.total` | annual | **excludes land tax** | **C** — the fallback is inert; see contradictions §2 |
| `totalAnnual` | `financialEngine.calculateAnnualCosts` | `…annualCosts.totalAnnual` | annual | **includes land tax** | **D** |
| `landTax` | `financialEngine.calculateLandTax` | `…annualCosts.landTax` | annual | state thresholds; **owner's total holdings not known**, so this is a single-property estimate | **C** |
| component costs | `financialEngine` | `…annualCosts.{councilRates,waterRates,landlordInsurance,propertyManagement,maintenance,strataFees,lettingFees}` | annual + weekly | — | **D** |
| tax treatment | — | — | — | **not modelled** — no marginal rate, no depreciation in the headline cash flow | **U** |

## 5. Projection

| Field | Owner | Source path | Basis | Class |
| --- | --- | --- | --- | --- |
| `projections[]` | `financialEngine.generateProjections` | `financial_calculations.projections` | stored series, **never regenerated on read** | **D** |
| `capitalGrowth` | stored assumption | `financial_calculations.assumptions.capitalGrowth` | % p.a., flat | **C** — an assumption, and the report must say so |
| `interestRate` | stored assumption | `financial_calculations.loanDetails.interestRate` | % p.a. | **C** |
| `occupancyWeeks` / `vacancy` | stored assumption | `…assumptions.occupancyWeeks`; vacancy derived from it | weeks / % | **C** |
| `cpiGrowth` | stored assumption | `…assumptions.cpiGrowth` | % p.a. | **C** |
| rental-growth assumption | — | — | — | **U** — not separately stored; rent escalates with CPI |
| `taxRate` | — | `cashFlow.taxRate` | — | **U** — null across the sample |
| `sellingCosts`, `loanFees` | — | — | — | **U** — no source |
| projected value / equity | `financialEngine` | series rows | compounds `capitalGrowth` off purchase price | **D** |

**Every projection is an assumption chain.** None of the four assumptions is
evidence; all four are parameters. A precise-looking year-10 figure is only as
sound as `capitalGrowth`, and the report must name it.

## 6. Geography — identity, never Location scoring

| Field | Owner | Source | Grain | Method | Class |
| --- | --- | --- | --- | --- | --- |
| `latitude` / `longitude` | `resolve-report-geography` | geocoder | point | — | **A** where `status='resolved'`; **X** where flagged `geocode_failure_value` (64 sentinel rows) |
| `suburb`, `postcode`, `state` | `report_geography` | **ABS ASGS 2021 point-in-polygon** | locality | free-text address **never consulted** | **A** |
| `sa2_code` / `sa2_name` / `sa3` / `sa4` / `gccsa` | `report_geography` | ASGS 2021 | SA2–GCCSA | — | **A** |
| `remoteness_area`, `urban_centre` | `report_geography` | ASGS 2021 | region | — | **A** |
| `status`, `flags`, `boundary_source`, `source_version` | `report_geography` | resolver | — | — | **A** |
| coverage | — | — | — | 1,114 geography rows; **867 resolved**; 593 Major Cities, 274 regional | — |

## 7. Market data — the section requiring the most disclosure

| Field | Label the report carries | Actual source | Grain | As-of | Class |
| --- | --- | --- | --- | --- | --- |
| `population.total` | "ABS Census 2021" | **generated** (see contradictions §1) | claimed POA | none stored | **X** |
| `income.medianHouseholdIncome` | "ABS Census 2021" | **generated** | claimed POA | none | **X** |
| `housing.medianRent` | "ABS Census 2021" | **generated** | claimed POA | none | **X** |
| `income.unemploymentRate` | "ABS Census 2021" | **generated** — 3 distinct values across 855 reports | claimed POA | none | **X** |
| `population.growth` | "ABS Census 2021" | **generated** | claimed POA | none | **X** |
| the same fields on 8 rows | "ABS Census 2021 (POA nnnn)" | **`abs_census_poa`, genuine** | **POA (postcode)** | `reference_period` present | **C** — POA is a postcode, not a suburb |
| `cashRate.current` | "RBA Official Cash Rate" | **hardcoded `4.35`** on 1,035 rows | national | `lastUpdate` is a cache stamp | **X** |
| `cashRate` on 78 rows | "RBA … (via Perplexity real-time search)" | an LLM web search | national | — | **X** |
| `cashRate` on 8 rows | "RBA statistical table F1.1" | **`rba_observations`, genuine** | national | `publicationDate` present | **A** |
| `inflation.*`, `indicators.*` | "RBA Statistical Bulletin (estimated)" | **generated** on 1,035 rows | national | — | **X** |
| `lendingRates.*` | "RBA" | genuine, 8 rows | national | `publicationDate` | **A** |
| crime | — | `crime_reference` (23,145 rows, NSW/QLD/SA/NT) | LGA / offence area | series-dependent | **C** — reaches `data_sources` on **12 of 1,207** reports |
| climate | — | `climate_normals_cache` (**2 rows**) | station | normals | **U** in practice |
| transport | — | `transport_stops` (185,177 GTFS stops) | point | feed snapshot | **A** where loaded; **U** outside loaded networks |
| `transport.qualityScore` | a transport "score" | **invented**; the current service emits none | — | — | **X** — present on 1,108 stored rows |
| schools | — | `schools_directory` (**29 rows**) + model text | point | — | **X** — 29 rows cannot cover the corpus |
| `walkScore` | a walkability score | per-state constant on **1,109 of 1,114** | state | — | **X** |
| `commute.durationMinutes` | drive time to CBD | fabricated; mean **10,125 minutes**, 494 non-NSW routed to Sydney | — | — | **X** |
| `schools.schoolsWithin3km` | school count | at the ceiling on **851 of 1,114** | — | — | **X** |
| growth, vacancy, demand, comparable sales, infrastructure | — | — | — | — | **F** — no provider entitlement at $0 (audit §64–§66) |
| SEIFA | — | `abs_seifa_poa` (2,627 rows) | POA | 2021 | **C** — reaches 12 reports |

## 8. Scoring

| Field | Owner | Meaning | Class |
| --- | --- | --- | --- |
| `authority` | the run's `policy` stamp | `legacy_snapshot` \| `unavailable` \| `v2` \| `none` | **A** |
| `gradeIssued` | `policy.gradeIssued` | whether a grade was published | **A** |
| `grade`, `totalScore` | `investment-scoring-service` | historical snapshots only | **C** — preserved as issued; withheld on new reports (audit §69) |
| dimension scores | as above | Growth and Demand were a constant `50` on 1,005 of 1,006 | **X** for new reports; **C** as a preserved historical snapshot |
| unavailable reason | `policy.eligibility` | `insufficient_verified_evidence` \| `no_authorised_scoring_system` | **A** |

## 9. Finance Suitability — deliberately separate

`financeSuitability.pure.ts` reads buyer LVR and weekly cash flow and returns a
**band and prose, never a field a composite can read**. It is a statement about
the BUYER'S POSITION, not about the property. It is shadow-only today (unwired).
Keeping it out of §8 is a rule, not a layout choice: a borrowing position is not
a property weakness.

---

## 10. Counts

| Classification | Facts |
| --- | ---: |
| **A — client safe, authoritative** | **24** |
| **D — client safe, derived** | **19** |
| **C — client safe, contextual (grain/date must be disclosed)** | **14** |
| **X — NOT currently client safe** | **13** |
| **U — unavailable** | **9** |
| **F — future source** | **5** |
| **Total material facts audited** | **84** |
