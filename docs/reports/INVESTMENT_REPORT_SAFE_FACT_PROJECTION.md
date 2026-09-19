# Investment Report — the safe fact projection

How a fact becomes something a client may read, and what refuses it at each step.

## 1. Demographics

```
report_geography            ASGS 2021 point-in-polygon; status ∈ {resolved, resolved_with_warning}
  → postcode
  → abs_census_poa          2,643 genuine ABS Census 2021 rows
  → contextual facts        grain = postcode, referencePeriod = "2021 Census"
  → CLIENT-SAFE GATE        allow_with_context
```

**Coverage, measured:** 867 of 1,207 live reports have trusted geography, and
**all 867 match** a row in `abs_census_poa` (and in `abs_seifa_poa`). The other
**340 are unavailable** — not estimated, not synthesised, not borrowed from a
neighbouring postcode.

Four distinct refusals, each with its own sentence, because "unavailable" with
no reason sends an operator to the wrong place:

| Condition | Reading |
| --- | --- |
| no geography row | location never resolved; statistics are not estimated from the address |
| status not trusted | location not resolved with confidence |
| no postcode | nothing to match a postcode-area statistic to |
| no ABS row for that postcode | **a neighbouring postcode is never substituted** |

Nine fields are published, each at **postcode** grain: population, median age,
median weekly rent, median weekly household income, median monthly mortgage,
owner-occupier rate, renter rate, unemployment rate, participation rate.

No `clientLabel` contains the word "suburb".

## 2. The cash rate

```
rba_series_meta + rba_observations   series FIRMMCRT only
  → "Cash Rate Target; monthly average", RBA table F1.1, monthly
  → contextual fact                  grain = national
                                     referencePeriod = "August 2026 (monthly average)"
                                     asOf = publication date
```

**The label is the hard part.** The series is a *monthly average of the target*,
not a spot rate. In a month with no policy change the average equals the target
(3.60, 3.85, 4.10, 4.35 sit on the 25bp ladder); in a month containing a change
it does not (4.31, 3.96, 3.83, 3.70 are transition-month averages).

So the client sentence is:

> Reserve Bank cash rate target: 4.35% — August 2026 (monthly average),
> published 01-Sep-2026.

and **never** "the current cash rate", because a change in the current month is
not yet in a monthly series. A test asserts the sentence contains neither
"current rate" nor "today".

Refused: any other series id; a `(estimated)` source; a Perplexity source; a
null reading. Each becomes **unavailable**, and the cash rate is **material**, so
its absence is stated rather than suppressed.

## 3. The disowned Location trio (plus one)

`walkScore`, `commuteDurationMinutes`, `schoolsWithin3km` and
`transportQualityScore` are blocked at the point of use. **Historical rows keep
them** — nothing is deleted — which is what lets the record stay intact while the
document stops repeating it.

Trusted geography remains fully usable. The rule:

> **Geography identity ≠ location assessment.** A trusted suburb, postcode and
> state do not authorise a location score or an amenity conclusion.

## 4. Rent basis — forward-only, optional, non-breaking

`weeklyRent` has never recorded *what kind of rent it is*. A current lease, an
agent's appraisal and a market estimate are three different facts, and every
yield in the report rests on whichever it was.

Two optional fields are now read — `manual_overrides.rentBasis` and
`.rentAsOf` — with the vocabulary `current_lease`, `rental_appraisal`,
`operator_supplied`, `market_estimate`, `other`. An unrecognised value reads as
**absent**, never coerced to the nearest-looking one: a wrong basis is worse than
none, because it makes an estimate look like a signed lease.

**Every historical row reads `unknown`**, and the basis is never inferred from
the value. A test proves that adding the fields changes no pre-existing fact.

## 5. Financial basis — unchanged, and carried

No proven calculation was altered. Purchase-price precedence, loan amount,
origination LVR, the stored stamp-duty snapshot, the yield basis and the
net-yield expense basis are all exactly as they were.

`annualOutgoings` is **not** "fixed" by falling back to `totalAnnual`: the two
differ by land tax, and swapping them would silently change a published figure's
basis. The fact carries **"excluding land tax"** as its basis, and where the
basis is unknown it stays unknown.

## 6. What the narrative receives

Values and labels only, from `narrativeBundle`. No provenance strings, no ruling
sentences, no blocked entries — a model that cannot see a refused fact cannot
describe one.

Afterwards `reconcileMarketClaim` checks **meaning as well as number**:

| Fault | Caught when |
| --- | --- |
| `value_mismatch` | the prose states a different figure |
| `grain_overstated` | postcode evidence described as suburb or property evidence |
| `period_mismatch` | 2021 Census evidence placed in 2026 |
| `source_misattributed` | an ABS figure attributed to another provider |
| `not_client_safe` | the prose states a figure that was never supplied |

Only `grain_overstated` fires on a **finer** claim; describing a postcode figure
as regional is imprecise, not false, and is not reported.

## 7. Sources deliberately left unconnected

Per §8 of the mandate — *do not connect a dataset merely because it exists*:

| Source | Rows | Why not connected in RF-7.2B |
| --- | ---: | --- |
| `abs_seifa_poa` | 2,627 | matches all 867; **no semantic decision yet** on how a SEIFA decile should be described to a client without implying a judgement about residents |
| `crime_reference` | 23,145 | four states only (NSW, QLD, SA, NT); grain is offence-area, not postcode, and SA changed its classification mid-series |
| `climate_normals_cache` | **2** | cannot cover the corpus |
| `schools_directory` | **29** | cannot cover the corpus |
| `transport_stops` | 185,177 | usable, but the reading needs the "no stop found is a fact about the FEEDS" rule carried into the gate first |

Each stays **unavailable** rather than being connected at a grain or date that
cannot be matched honestly.
