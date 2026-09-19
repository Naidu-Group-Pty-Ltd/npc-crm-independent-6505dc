# Scoring input integrity — the Trusted Evidence Gate

**READ-ONLY SHADOW ANALYSIS.** No production score changed, no client-facing
output altered, no historical report rewritten, no data purchased, no Scoring
V2 methodology modified, no eligibility rule relaxed, no three-dimension
minimum touched.

The previous closeout established that Scoring V2 is correct and that V1's
grades were not evidence-backed. This one answers the question in front of
that: **can the inputs V2 currently marks as available be trusted?**

The answer is no, and the reason is specific: Location's three scoring inputs
are synthetic by construction. The corpus's own provenance register already
said so; nothing had ever gated on it.

---

## 1. Baseline

| | |
| --- | --- |
| main SHA | `090da6c7cd82078f06f0e5c2320bb453b9b72e0a` (after #2592 merged) |
| corpus | 1,006 reports carrying a production V1 score |
| engine | `2.1.0-shadow` frozen, eligibility `2.0.0`, contract `1.0.0` |
| gate | `trustedInput.pure.ts` `1.0.0` (new, pure, unwired) |
| replays | `corpusReplayV2.spec.ts` (initial), `corpusTrustedReplayV2.spec.ts` (trusted) |
| exports | `scripts/scoring/export-scored-corpus.sql`, `export-trust-map.sql` |

## 2. Trusted-input classification

Four classes, defined in `trustedInput.pure.ts`:

- **trusted** — source, provenance and semantics verified. May score.
- **recovered** — deterministically recoverable from another trusted record
  already held. May score; the route travels with the value.
- **untrusted** — a known default, a fabricated value, a contaminated
  measurement or a semantically ambiguous one. **Never scores.**
- **unavailable** — does not exist. Never scores.

`untrusted` and `unavailable` are deliberately distinct: both keep a value out
of the composite, but one needs the data repaired and the other needs it
acquired, and collapsing them sends an operator to the wrong remedy.

The rule doing the real work is **`inheritTrust`**: a walk score, a commute and
a school count are facts about a *coordinate*, so if the coordinate is not the
property's, none of them is either. A derived value can never be more
trustworthy than its basis.

## 3. Coordinate and default audit

| coordinate class | reports | classification |
| --- | ---: | --- |
| ASGS point-in-polygon resolved | 741 | **trusted** |
| Sydney CBD geocoder failure value `-33.8688, 151.2093` | 62 | **untrusted** |
| address not placeable in Australia (`corrupted_unrecoverable`) | 172 | **untrusted** |
| no geography row at all | 31 | **unavailable** |

The sentinel was **already rejected** by `resolve-report-geography`: of 64 rows
carrying it across the whole table, **zero** were resolved. That is the system
working. What had never happened is anything downstream *consulting* that
verdict — 61 of the 62 scored sentinel reports carry a walk score and all 62
carry a school count, and the first replay scored Location from them. Those
numbers describe Sydney's CBD; several of the properties are Western
Australian, and many carry no resolvable address at all (`Unknown Property
(rec…)`, `Property from www.realestate.com.au`, `Preview`).

## 4. Geography recovery routes

Suburb, postcode and state are stored on **zero** report records. Every value
present is therefore already a recovery:

| route | reports | status |
| --- | ---: | --- |
| ASGS 2021 point-in-polygon from a trusted coordinate | 741 | in use, deterministic |
| trusted sibling via `canonical_property_key` | 5 | available, no scoring benefit (§7) |
| `client_property_id` | 0 | no untrusted report carries one |
| parent report | 3 | parent is itself untrusted |
| operator override | — | overrides carry no geography field |

`report_geography` (1,114 rows) is the recovery layer, populated by
`resolve-report-geography` against ABS ASGS 2021 boundaries via the published
ArcGIS REST service. This closeout reads its verdict and does not rebuild it.

## 5. Trusted geography coverage

**741 of 1,006 (73.7%)** trusted. 234 untrusted, 31 unavailable — 265 (26.3%)
cannot be placed.

## 6. Location provenance audit — the finding

`LOCATION_PROVENANCE_MATRIX` (ME-5.1 item 9) classified every field in
`location_intelligence` against the live corpus. It contains **exactly one**
`genuine_measured` entry: the coordinate. Every field Location actually scores
from is marked `admissibleToV2: false`:

| input | class | the measurement behind it |
| --- | --- | --- |
| `walkScore` | `state_template_synthetic` | 30 of its 100 points **are** a per-state transport constant; reconstructing the formula reproduces the stored score on **1,109 of 1,114** objects |
| `commute.durationMinutes` | `fabricated_estimate` | 438 of 1,114 are straight-line distance × 1.5 with no route, **mean 10,125 minutes** |
| `commute.durationMinutes` | `wrong_destination` | 494 non-NSW reports carry a real transit query sent to **Sydney**, because `getCBDCoordinates` defaulted — Bentley WA, 8 km from Perth, stored 3,283.6 km |
| `schools.schoolsWithin3km` | `state_template_synthetic` | `min(actual, 10)` off a Places page slice; **851 of 1,114** sit at the ceiling |
| `transport.*` | `state_template_synthetic` | five per-state constants; **822** name Sydney's Central Station 450 m away, across all eight states |
| `amenities.*`, `healthcare.*`, `lifestyle.*` | synthetic / missing | capped counts and scores derived from them |

So a trusted coordinate does not make the measurements trusted. The register
already said this; the gate is what finally enforces it.

## 7. Rebuilt Location coverage

| | reports | of 1,006 |
| --- | ---: | ---: |
| initial replay "available" | 975 | 96.9% |
| **trusted** | **0** | **0.0%** |

Every stored Location input is refused by the register. Recovering geography
for the remaining 265 would not change this, because the inputs are synthetic
independently of the coordinate — which is why the 5 sibling-recoverable
reports yield no scoring benefit today.

This is not a performance result. It is the honest coverage: the platform has
never held a Location measurement it can defend.

## 8. Commute audit

Measured over the 911 non-zero stored values:

| reading | value |
| --- | ---: |
| median stored "minutes" | **1,279** (21 hours) |
| 75th percentile | 4,925 |
| maximum | **26,155** (18 days) |
| plausible as minutes (≤120) | 171 of 911 |
| plausible only if the unit were seconds | 583 |
| implausible under either reading | 157 |
| exactly 0 (a field nobody filled) | 64 |

The current writer is correct — `location-intelligence-service` stores
`Math.round(element.duration.value / 60)`. These values predate it or come from
the estimate branch. **The unit cannot be established per row**, so the field is
semantically ambiguous and `untrusted` by definition; guessing a unit would be
exactly the inference this gate exists to prevent.

The methodology requirement stands and is unmet: commute is to the **nearest
relevant employment centre**, and 494 non-NSW reports were measured to Sydney.

## 9. Yield provenance audit

| | reports |
| --- | ---: |
| price — stored in `financial_calculations` | 185 (**trusted**) |
| price — recovered from the operator's `purchasePrice` override | 273 (**recovered**) |
| price — unavailable | 548 |
| rent — stored in `financial_calculations` | 166 (**trusted**) |
| rent — recovered from the operator's `weeklyRent` override | 25 (**recovered**) |
| rent — unavailable | 815 |

**Basis is settled by evidence, not assumption:** the override key is literally
`purchasePrice`, and where both it and `initialCosts.propertyValue` exist they
are equal on **every** report. The basis is therefore the purchase price, and
yield is computed on it through the canonical metrics module.

Overrides never contradict the stored block — **0 disagreements on price and 0
on rent across 1,006 reports** — which is what makes the override safe to read
as the calculation's source rather than as a competing opinion.

**Trusted Yield coverage: 188 of 1,006 (18.7%)**, up from 164. Yield needs both
figures; 191 reports have a usable rent and 3 of those have no price.

## 10. Rent snapshot / contradiction review

Ten addresses carry more than one rent. Timing classifies them:

| classification | addresses | basis |
| --- | ---: | --- |
| **Unexplained contradiction** | 9 | two rents for the same property at the same price with a span of 0–1 days |
| **Possible legitimate snapshot variation** | 1 | a 10-day span (Cockburn Central, $590 → $650) — though it moved the V1 grade from C+ to B |

Seven have a span of **zero days**: same property, same price, same calendar
day, two different rents. A rental appraisal does not move within a day.

Each report is internally consistent — its own rent fed its own calculation —
so this does not void any individual report's Yield. What it shows is that
**the corpus has no canonical property-level rent**. For new reports the
precedence should be: operator override → stored calculation → verified current
estimate, with the chosen source and its as-of date recorded. No historical
report is rewritten.

## 11. Growth

**0 of 1,006. Unchanged and correct.** No stored blob carries a `marketData`
key of any kind. No V1 constant, no state average, no ABS higher-geography
substitution, no proxy, no interpolation.

## 12. Demand

**0 of 1,006. Unchanged and correct.** No vacancy, days-on-market, auction
clearance, vendor discount, sales count, listing activity or population-growth
figure exists on any row. Nothing unrelated was backfilled to manufacture a
grade.

## 13. Risk

**0 of 1,006.** No record answers any Model D property-risk category (site
hazard, planning, condition, strata, supply concentration, delivery), so
`MINIMUM_INDEPENDENT_CATEGORIES = 2` is never reached. Model D is unaltered.
Buyer LVR, buyer cash flow, serviceability and property-type points remain
structurally incapable of entering it.

## 14. The trusted input contract

`trustedInput.pure.ts` (`1.0.0`), pure and **not activated in production**.
Every qualified value carries: `value`, `semantic` (what it means), `source`,
`provenance` (the exact path), `asOf`, `level`, `acquisition` footing,
`verification` (the check actually run), `trust` class and `reason`.

`gated()` is the only accessor and returns `null` for anything not `trusted` or
`recovered` — so a caller cannot read an untrusted value by accident. The
classification helpers are `classifyGeography` (reads the resolver's verdict),
`classifyOverride` (operator entries) and `inheritTrust` (derived values).

## 15. Trusted corpus replay

| dimension | trusted coverage | % |
| --- | ---: | ---: |
| Growth | 0 | 0.0% |
| Location | **0** | 0.0% |
| Yield | **188** | 18.7% |
| Demand | 0 | 0.0% |
| Risk | 0 | 0.0% |

| measured dimensions | reports |
| ---: | ---: |
| 5 | 0 |
| 4 | 0 |
| 3 | 0 |
| 2 | 0 |
| 1 | 188 |
| 0 | 818 |

**Overall-grade eligible: 0 of 1,006. Overall-grade unavailable: 1,006.**
Every one states the reason. The three-dimension minimum was not changed.

## 16. Initial vs trusted replay

| Dimension | Initial Replay | Trusted Replay | Difference | Reason |
| --- | ---: | ---: | ---: | --- |
| Growth | 0 | 0 | 0 | No market evidence exists in any record |
| Location | 975 | **0** | **−975** | Every scoring input refused by the Location provenance register as synthetic, fabricated or wrong-destination |
| Yield | 164 | **188** | **+24** | Operator-entered price and rent recovered where the calculation block carried none |
| Demand | 0 | 0 | 0 | No demand measure stored on any row |
| Risk | 0 | 0 | 0 | No property-risk category answerable |

Quantified:

- **scores lost to untrusted inputs:** 975 Location readings, of which 234 were
  additionally measured at a coordinate that is not the property's;
- **inputs recovered deterministically:** 273 purchase prices and 25 weekly
  rents from operator entries; 741 geographies from ASGS point-in-polygon;
- **Location records corrected:** 975 (all of them);
- **Yield records corrected:** 24 added, 164 confirmed;
- **reports becoming more complete:** 24;
- **reports becoming less complete:** 975, of which 818 now measure nothing.

The gate moves in both directions, which is what distinguishes a qualification
from a filter.

## 17. Scoring correctness conclusion

**No Scoring V2 methodology defect was found — in either replay.** Every
invariant held across 1,006 real records under the gate: no NaN, no Infinity,
nothing outside 0–100, unavailable never a zero, unmeasured dimensions at
effective weight 0, weights reconciling to 1, and no Location reading produced
without trusted geography.

The engine is correct. The **inputs** were not, and the defects are in the data
and its acquisition rather than in the scoring:

1. Growth and Demand scored the constant 50 on 1,005 of 1,006 V1 reports.
2. 62 reports carry a geocoder failure coordinate and were scored from it.
3. `walkScore` is a state template reproducible by formula on 1,109 of 1,114.
4. `commute` is fabricated on 438 and sent to the wrong city on 494; its unit
   cannot be established per row.
5. `schools.schoolsWithin3km` is `min(actual, 10)`, at the ceiling on 851.
6. `transport.*` is five per-state constants; 822 name Sydney's Central Station.
7. Nine addresses carry same-day contradictory rents.
8. 172 reports carry an address that cannot be placed in Australia.
9. Suburb, postcode and state are stored on zero report records.

## 18. Proposed forward-only production policy

**Not deployed. Recommended.**

> Aurixa publishes an overall property score and grade only where at least
> three dimensions carry verified evidence and all frozen V2 eligibility
> requirements are met.

**Eligible property** — show the overall score, the grade, evidence coverage,
per-dimension results, and the availability/provenance disclosure.

**Ineligible property** — show **no overall letter grade**; show the measured
dimension assessments, the evidence coverage, the unavailable dimensions and
why each is unavailable. No scoped letter grade is invented.

The wording must carry the meaning plainly: *the absence of an overall grade
does not mean the property is poor. It means insufficient verified evidence
exists to grade it.*

On today's data this would publish no overall grade on any report until Growth,
Demand and a defensible Location measurement are connected. That is the honest
consequence of the finding, and the reason this stops at a recommendation.

## 19. Historical policy

Keep the historical report snapshot. Keep the historical V1 score. Stamp
methodology and version forward-only where compatible. Allow an internal V1/V2
comparison. **No automatic retrospective score substitution, and no rewriting
of the 1,006 stored reports.**

Any client notification or disclosure question is separate commercial and legal
governance, and is not decided here.

## 20. Remaining calibration limitations

Empirical market calibration remains **deferred** and is unchanged by this
work: it needs representative licensed, open or trial suburb Growth evidence
for QLD and WA, which does not exist at $0. It no longer blocks correctness or
Reporting.

Two limitations belong specifically to this closeout:

- **A defensible Location measurement does not yet exist.** `locationEvidenceV2`
  and the GTFS transport work are the route to one, and until it is connected
  Location is honestly zero rather than quietly synthetic.
- **The gate is designed and unwired.** It classifies and withholds correctly in
  analysis; activating it in production is part of ME-8 and is not authorised.
