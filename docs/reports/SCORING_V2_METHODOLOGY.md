# Scoring V2 — the methodology, in one place

**Methodology version `3.0.0` · the production grade engine since `2026-09-15`
(activation ME-8, recorded in `scoringV2Production.pure.ts`).** A spec test
(`src/lib/reports/__tests__/scoringMethodology.spec.ts`) pins every
load-bearing number in this document to the modules that enforce it, and
asserts the engine is reached by exactly one production entrypoint
(`investment-scoring-service`) through the activation module and nothing else
— so this document cannot quietly disagree with the code, and no second
caller can quietly reach the engine.

The governing doctrine, unchanged: **a figure the system record can produce is
never asked of a model**, absent is absent (never 0, never 50, never neutral),
and configuration is not reachability. This scoring engine is deterministic
end to end: same inputs, same output, no HTTP, no model, no clock beyond an
injected `now`.

Status honestly stated: the methodology below is **complete on synthetic
proof and unvalidated against real market evidence**. The genuine historical
backtest (ME-7) still waits on real QLD + WA Growth evidence; every threshold
here is subject to evidence-based calibration under the calibration rules
(defects only, never grade-distribution targets), and any change bumps a
version. Activation did not close ME-7 — it made the first real evidence the
engine scores a production reading rather than a shadow one, which is why the
activation condition below is conservative.

**SCORING V2 CORE FROZEN (2026-09-11, audit §68).** The structure this
document describes survived its closure review and is settled; edits require
a demonstrated defect and a version bump. The `-shadow` suffix came off the
version at activation; the composition did not change.

## Activation — ME-8, 15 September 2026

On 15 September 2026 the platform owner instructed that the grading system be
rectified: since 11 September every new report had read *"Grade withheld — no
scoring system is currently authorised to issue an overall grade"*, because
`PRODUCTION_SCORING_AUTHORITY` is `unavailable` (V1 is not trusted to grade)
and this engine was frozen but never wired. The activation is
`SCORING_V2_ACTIVATION` in
`supabase/functions/_shared/reports/market/scoringV2Production.pure.ts` —
a constant, not configuration, because activating an engine is a decision
with a review behind it and an environment variable is not that decision.

What it does: `investment-scoring-service` answers every property scoring
request by running this engine through `scoreForProduction`, which projects
the canonical output (§8) onto the record every reader already understands —
`totalScore`, `grade`, `breakdown`, `coverage`, the SWOT lists — under a stamp
whose `authority` is `v2` and whose `scoringSystem` is `scoring-v2`. The
legacy V1 path stays in the service as the recorded methodology of the stored
corpus and for area scoring; it is never reached for a property while the
activation is approved, and it still cannot spell `v2`
(`LegacyScoringAuthority`).

What it does not change: no weight, anchor, ceiling or rule in this document;
nothing about the forward-only input policy (Location's three inputs stay
`requires_repair` and count only when declared verified for the run — see IPV
1.1.0 below for how that declaration is now made); and no stored row — a
score issued under V1 keeps its stamp, a withholding keeps its stamp, and the
next run of a report is the first to carry `v2`.

### Location verification — IPV 1.1.0, 16 September 2026

The input policy's own header required "the repair of the location service,
with a decision behind it" before `verifiedInputs` could reach the live path.
Both arrived. The repair is the measured location chain: every geocode goes
through the granularity-gated provider chain
(`GEOCODING_WITHOUT_GOOGLE.md` — a state centroid is refused whoever answered),
amenities are measured at the verified coordinate from the local OSM amenity
register or Places, the commute is a real route from that coordinate (OSRM or
the Distance Matrix), and RF-7.2B stamps every acquisition with the subject
it describes and whether each stage ran. The decision is the platform owner's
instruction of 16 September 2026 that a measured run stop scoring as partial
(the reported case: 85 Bronze Street, Maryborough — grade C at 64 with
`3 of 5 dimensions`, the C being the delivered-points ceiling on 70% weight).

The wiring is a derivation, never a request field.
`investment-scoring-service` reads the enrichment's own acquisition stamp
(`locationInputVerification.pure.ts`): an input is verified exactly when the
stamp's `subjectKey` equals the key of the subject the generator restates on
the request (`locationSubject` — same address, postcode and state under the
canonical normalisation), the stage that produced the reading ran (`places:
complete` for the walk score and school count, `commute: measured` for the
commute), and the reading is a finite number on the stamped object. A
stampless enrichment — every row persisted before RF-7.2B — verifies nothing
and scores exactly as before; the remedy is regeneration, which re-acquires
with a stamp. A caller-asserted `verifiedInputs` on the request body is still
never read, because evidence travels with the object that carries the
readings. Wiring Location moves the composite either way, and that is the
proportional score's meaning rather than a defect: a genuinely weak location
(a regional property three hours from its capital) now measures instead of
being excluded, and a property assessed on four dimensions is scored on the
four it has. What may never happen is a dimension being dropped because of
what it would do to the result, which §3 pins by execution. Risk stays null under the
recorded Model D decision (`propertyRiskSchema.pure.ts`): the platform holds
no property-level risk evidence, and 95 of 100 nominal points keeps every
grade to A+ reachable.

**Growth was required, and is not any more** (S5/S6 §8, 18 September 2026).
The rule read: the engine's floor is three measured dimensions, three can be
reached without Growth on the evidence this deployment holds, and a grade
formed that way answers to the delivered-points ceiling — with Growth's 40
points unmeasured the best deliverable is 60 of 100, so the printed letter
would be a B at most and typically a C, a statement about missing data wearing
the shape of a statement about the property.

Every step of that was true, and the premise was the ceiling. §8 removed the
ceiling as a missing-dimension penalty, and the requirement falls with it:
`requiredDimensions` is now `[]`, and three dimensions without Growth receive
a qualified score across the three they have. The field is kept rather than
deleted so the supersession is legible, and because an evidence-based
requirement, if one is ever justified, has somewhere to go that is not a
second gate.

What still holds is the safeguard that was doing the real work: the
Growth-centred evidence ceiling (§3). With no capital-growth evidence the
printed letter cannot exceed **B+** however strong the assessed dimensions
are — so the badge a client reads is still a claim the evidence can carry,
while the score they read is a real finding about what was measured.

**Absence is named.** A withheld grade carries `gradeGaps` — one entry per
unmeasured dimension with the client sentence (`NOT_ASSESSED_REASON`), the
operator detail (which provider refused and what it said, which input is
unrepaired, or that the geography never resolved to a trusted suburb and
postcode) and the remedy. The Generated Reports card and the report page
render the same list.

**Where the evidence comes from.** Domain's v2 suburb-performance series
(`domain-data-service`, `domainEvidence.pure.ts`: the growth horizons are
computed from twelve annual medians, never read from a growth field; days on
market, sales, listings, rent and clearance from the latest period) and the
ABS estimated resident population series for the property's SA2
(`populationGrowthEvidence.pure.ts`, a demand driver). Both are asked for the
subject the boundary service resolved from the verified coordinate — never
the typed suburb or the parsed postcode — so an unresolved geography seeks no
evidence and says so. Domain's licensing for client documents is `unverified`
(`DOMAIN_SUBURB_PERFORMANCE_LICENSING`) until the rights follow-up in
`docs/integrations/DOMAIN_ACTIVATION_REQUEST.md` is answered: the engine
scores on the points and the client-facing evidence statement withholds their
provenance, exactly as §7 has always said.

---

### Growth providers, 15 September 2026 (evening)

Domain's suburb-performance series answers 403 on this key (the project has
no API package attached), so the growth evidence the activation requires
comes from the open-data sales registers loaded by `market-sales-ingest`
and adapted by `openDataSalesEvidence.pure.ts`: the Queensland Government
Statistician's dwelling-sales series by local government area (quarterly
since June 2008) and the NSW DCJ Rent and Sales Report by postcode and LGA
(one workbook a quarter since 2017), both CC BY 4.0, both measured
reachable from the production egress. Every point carries the publisher's
grain (`lga` or `postcode`), which the Growth confidence's geography factor
prices at 55 and 80 against 100 for a suburb, `licensingStatus: 'open'`
and `acquisition: 'open_public'`. Domain remains a provider: when its
package is attached, `mergeEvidence` prefers its suburb-grain points per
measure and the register becomes the second, corroborating source
(`sourceIndependence` 55 → 85). Western Australia has no open series and
withholds; Victoria's is walled to scripted clients. The measurements,
licences and what remains are in `OPEN_DATA_GROWTH_EVIDENCE.md`.

## 1. The composite

One composition function: `scoreInvestmentV2Shadow`
(`supabase/functions/_shared/reports/market/shadowScorer.pure.ts`).

| dimension | nominal weight | scorer | version |
| --- | ---: | --- | --- |
| Growth | **0.40** | `growthScoring.pure.ts` | `3.1.0` |
| Location | **0.25** | `locationScoring.pure.ts` | `1.2.0` |
| Income vs its market | **0.15** | `totalReturnScoring.pure.ts` | `1.0.0` (figure: `yieldScoring.pure.ts` `3.0.0`) |
| Demand | **0.15** | `demandScoring.pure.ts` | `4.1.0` |
| Risk | **0.05** | `riskModelD.pure.ts` (Model D, variant D2) | `1.0.0` |

Weights are the live composite's, unchanged on purpose: this release fixes
what each dimension *measures*, and re-weighting at the same time would make a
backtest unable to attribute any change to either.

**Composition rules, each pinned by test:**

- A dimension that could not be measured is **absent, never zero** — it leaves
  the composite entirely; the remaining weights renormalise, and the
  renormalisation is published (`effectiveWeight` per dimension,
  `evidenceCoverage` overall).
- Fewer than **3** measured dimensions → no composite, no grade, a stated
  reason (`MIN_DIMENSIONS_FOR_GRADE`).
- The composite is **proportional over the ORIGINAL weights of the valid
  dimensions** (S5/S6 §7): `Σ(score × original weight) / Σ(original weights of
  valid)`. Never divided by five, never zero-filled, never an equal-weight
  average. It is computed at full precision and rounded **once**, in
  `proportionalWeighting.pure.ts`, which the engine and the publication policy
  both compose with so they cannot disagree.
- A dimension counts only where it produces a **finite score from 0 to 100**.
  A genuinely measured zero counts; missing, null, defaulted, fabricated, NaN,
  infinite and out-of-range values do not, and a `scored: true` flag alone is
  never sufficient — the flag is a claim and the value is the evidence for it.
- `nominalMeasuredScore` — Σ (measured score × nominal weight), the points the
  evidence actually **delivered** over the full 100 — is still computed and
  published as a **diagnostic**. Until 18 September 2026 the printed grade also
  answered to it; that ceiling is removed (§3).
- The buyer never scores into the property (§5).

## 2. Grades

`gradeEligibility.pure.ts`, version `5.0.0`.

| grade | floor |
| --- | ---: |
| A+ | **80** |
| A | **75** |
| B+ | 65 |
| B | 55 |
| C+ | 50 |
| C | 40 |
| D | 30 |
| F | 0 |

These thresholds are not this programme's to move, and no calibration may
target a grade distribution. The one line that has moved was moved by the
platform owner, not by calibration: on 24 September 2026, **A+ from 80**
(it was **85**, the V1 line Scoring V2 kept), so A now spans 75–79. Every
grade issued before `5.0.0` was issued against A+ **85**, and is READ against
it — `gradeThresholdsFor` takes the eligibility version the record carries,
so a stored 82 issued as an A is never re-labelled an A+ that was "held
down".

## 3. A/A+ evidence eligibility — one ceiling, about the evidence

A grade is a claim; the score says how strong, eligibility says whether the
evidence can carry it. Eligibility **never changes the score**. Until `5.0.0`
it capped the printed grade and stated why; from `5.0.0` it never changes the
letter either — the letter is the band of the score, and where the evidence
alone would not carry that letter a **caution** is stated beside it (see
*5.0.0* below). Deliberately not "N of 5 dimensions": a missing vacancy rate
and a missing five-year growth series are nothing alike.

**The tests — Growth-centred and quality-gated** (`ELIGIBILITY_RULES`):

| rule | A | A+ |
| --- | ---: | ---: |
| minimum Growth confidence | **45** | **70** |
| minimum Growth coverage | **0.45** | **0.70** |
| minimum evidence quality over the assessed dimensions | **0.55** | **0.70** |

Growth confidence is itself six measured factors (§4.1): geography precision,
dwelling-type match, sample size, history depth, source independence,
freshness — the checklist a client-facing A/A+ must survive.

Until `5.0.0`, whenever the printed grade was capped at least one reason was
stated, in the operator's words. From `5.0.0` nothing is capped: whenever the
evidence alone would not carry the letter the score gives, the finding is
stated twice — `cautions`, in the operator's words, and `caution`, one
sentence a client may read.

### The delivered-points ceiling, and why 3.0.0 removed it

2.0.0 carried a second cap: the printed grade could not exceed
`gradeFor(nominalMeasuredScore)`. It was found by fixture before any real
evidence was scored, and the arithmetic behind it is real — the renormalised
composite *rises* when a weak dimension drops out (growth 90 / location 80 /
yield 85 / demand 55 composites ≈ 81 with Demand and ≈ 86 without it), so
absence appeared able to buy a badge.

It was the wrong instrument, and S5/S6 §8 removed it. It lowered the grade
**solely because a dimension was unavailable**, which contradicts proportional
scoring: a three-dimension assessment covering 70% of the matrix could not
exceed the grade its 70 delivered points allowed, however strong those three
were — so a qualified score and a qualified grade disagreed with each other by
construction, and the cure for "absence buys a badge" was "presence of
evidence we do not hold costs a badge".

What replaces it is a rule about **selection** rather than a cap on the
result. §4's publication policy states it: *include every valid dimension
available at the assessment cutoff; never omit a low-scoring dimension to
improve the result.* The engine satisfies it structurally — `measured` is
`raw.filter(isValidDimensionScore)`, a filter on validity with no path that
reads a value — and `scoringV2Closure.spec.ts` pins it by driving the same
evidence from strong to weak and asserting the measured set never moves. That
is a stronger guarantee than the ceiling gave: the ceiling bounded the
consequence of dropping a dimension, while this asserts the engine cannot drop
one.

The third change in 3.0.0 is that the A/A+ coverage gate reads
`evidenceQualityCoverage` (the share of the **measured** dimensions' weight
their evidence covered) rather than `evidenceCoverage` (the share of the
**full** matrix). The old figure mixes two questions — how many dimensions
answered, and how well each was evidenced — so gating on it was a third
missing-dimension penalty: a perfectly evidenced three-dimension assessment
could not reach A because two dimensions were unavailable. Dimension count,
original weight coverage and evidence quality are recorded and disclosed
separately, and none of them stands for another.

Measured consequence today, with Risk structurally unmeasurable (§4.5): the
maximum composite across the four live dimensions is ≈ 89 of 100 (growth
saturates at 91, location reaches 95, yield 100, demand 93), so **A+ remains
reachable on genuinely exceptional evidence**, which is what the badge is
supposed to mean.

### 4.0.0 — the third hiding place of the same penalty

3.0.0 removed the delivered-points ceiling and believed what remained was a
guard on evidence quality. It was not, quite. **Both** A and A+ gates opened
with `hasGrowth &&`, so a property with *no* growth reading failed both
however strong and however well evidenced its other dimensions were, and the
ceiling fell to **B+**. That is the missing-dimension penalty for the third
time: the grade lowered *because a dimension was unavailable*, which is what
proportional weighting already accounts for by renormalising. It was easy to
miss because it reads as a statement about growth evidence, and it is a
statement about the absence of any.

4.0.0 draws the line where the evidence is:

| | what it means | does it cap? |
| --- | --- | --- |
| growth **present**, confidence or coverage under the threshold | evidence this report holds cannot carry the claim | **yes** — unchanged |
| growth **absent** | nothing measured, no weight, no contribution, no growth claim made | **no** (4.0.0) |
| `evidenceQualityCoverage` under the floor | the dimensions that *did* answer are thinly evidenced | **yes** — always |

So the growth thresholds bind **only where growth evidence exists**, and
`evidenceQualityCoverage` binds always. Stated once, plainly: **an absence is
no longer a cap.** The module's opening case is
untouched: growth 93 on 10% coverage at low confidence still cannot print A+,
because that evidence is present and cannot carry the letter.

The consequence is real and intended. A three-dimension assessment whose three
dimensions are strongly evidenced can now reach A. What tells the reader its
scope is the **qualification** — *"based on 3 of the 5 assessment
dimensions"* — carried on every surface by §3a's publication policy. Absence
is disclosed with the result, never deducted from it.

### 5.0.0 — the letter is the band of the number (owner decision, 24 September 2026)

The owner's report list showed **60 Lawley Street, Spalding WA at B+ · 89**
beside **9 Hollow Street, Golden Square VIC at A · 77**: a higher score, a
lower letter. Both were this module working as designed. Measured from the
production run and reproduced through the engine: Lawley's growth came from
the one reading Western Australia publishes openly, the ABS mean dwelling
price for the whole state (`abs_res_dwell`, 8 points, all dwelling types, no
sales count), and that shape scores **44 of 100** on growth confidence at
best —

| factor | weight | score on a state series |
| --- | ---: | ---: |
| geography (state) | 0.25 | 10 |
| dwelling type (not matched) | 0.15 | 0 |
| sample (no count published) | 0.20 | 30 |
| history | 0.20 | 100 |
| source independence (one provider) | 0.10 | 55 |
| freshness | 0.10 | 100 |

— one point under the A test of **45**. So every property whose growth rests
on a state series (all of WA, Tasmania, the NT and the ACT, and anywhere a
finer register is missing) could never print above **B+** however it scored.
The tests were written before the state series existed as a source (§*Growth
providers, 16 September 2026*), and nothing noticed they had become a
jurisdiction rule. Hollow Street's growth is Golden Square's own suburb
series (`vic_vpsr_suburb`, 10 points), which passes the A tests, so its 77
printed the A its score gives.

The concern the tests answer is real and survives: a growth figure for a
whole state is not a finding about one suburb. What `5.0.0` changes is WHERE
that is said. A cap lowered the letter and left the number standing, so a
reader was handed two claims that disagree and no way to reconcile them —
the objection `4.0.0` made of the missing-dimension penalty, one step
further. The owner's decision, 24 September 2026: *the letter follows the
score, and anything from 80 is an A+.*

| | until `4.0.0` | from `5.0.0` |
| --- | --- | --- |
| printed letter | the score's, or the evidence ceiling if lower | **always the score's** (`grade === scoreGrade`) |
| `capped` / `reasons` | set when the ceiling bound | always `false` / empty |
| evidence short of the letter | the letter was lowered | **`cautions`** (operator) and **`caution`** (one client sentence) state it |
| A+ | from **85** | from **80** |

The caution is composed from the evidence's own facts — the geography and
dwelling type the growth figures describe, the confidence factors' own
details, how much of each method ran — never from a score, so it cannot
disagree with the record beside it. For Lawley it reads: *"Capital growth is
measured for Western Australia as a whole and across all dwelling types, not
for this property's suburb and dwelling type."* It travels on the production
record as `evidenceCaution`, and every surface that prints the grade prints
it beside it: the report list card, the report page, the Method page's
*Grade issued* step, the condensed verdict lines, the evidence statement's
limitations, and the model's own score block.

What `5.0.0` deliberately does not do: it does not discount the NUMBER for a
state series. That would be a calibration of the growth dimension against
real evidence, which ME-7 still waits on, and it would move every WA score
the owner has already read.

## 3a. Publication — when a score and grade reach a client

`scorePublicationPolicy.pure.ts`, version `1.1.0`
(`SCORE_PUBLICATION_GATE`, S5/S6 §4, §7 and §8, 18 September 2026).

| valid dimensions | outcome |
| --- | --- |
| 5 of 5 | issue the score and grade, all five identified as assessed |
| 4 of 5 | issue a **qualified** score and grade from the four valid dimensions |
| 3 of 5 | issue a **qualified** score and grade from the three valid dimensions |
| 0–2 of 5 | no overall score, no grade, no gauge, no score-derived verdict |

Below the floor the substantive report is still produced, and it says briefly
why no score accompanies it — naming how many dimensions were needed and
which were assessed, rather than the generic "insufficient verified evidence"
that read as a fault and sent an operator looking for one.

A qualified score carries its qualification wherever it goes: *"Investment
score: 78/100 — based on 4 of 5 assessed dimensions."* The record names the
included and unassessed dimensions, the reason for each absence, the original
weight coverage and the adjusted weights. Normalising the weights makes the
arithmetic proportional; it does **not** make the evidence complete, and
nothing may imply an unassessed dimension is low-risk or favourable.

This supersedes two earlier rules, and the supersession is recorded rather
than tidied away:

- the **five-dimension completion gate** (18 September 2026), which withheld
  the letter until all five scored — the right answer to "is this assessment
  complete" and the wrong answer to "may a client be told what we measured";
- the **Growth-required publication rule** (ME-8, 15 September 2026), whose
  premise was the delivered-points ceiling above. With no ceiling, three
  dimensions without Growth are scored across the three they have.

  This bullet previously ended *"and the Growth-centred evidence ceiling still
  holds the letter to B+ where no capital-growth evidence exists, which is the
  safeguard that was actually doing the work."* That was wrong, and eligibility
  `4.0.0` corrects it: a ceiling triggered by a dimension being **absent** is
  the penalty this policy removes, not a safeguard it keeps. The safeguard that
  genuinely survives is the quality floor over the dimensions that answered.

## 4. The dimensions

Ownership is exclusive and enforced: every input has exactly one owner
(`dimensionOwnership.pure.ts`), a forbidden list, and one declared exception —
`growth1Year`, which Growth rewards and Risk prices the reversal of, moving
the composite in **opposite** directions (measured ≈ 4:1 in Growth's favour).

### 4.1 Growth (0.40) — capital movement, and only capital movement

- **Permitted**: subject CAGRs over 1/3/5/10 years, the price series (path
  consistency), suburb-vs-benchmark relative movement.
- **Prohibited**: population growth (a demand driver), any demand or yield
  measure, `state`.
- **Missing**: no growth evidence → dimension null; partial horizons → scored
  on what exists with `weightCovered` published.
- **Confidence** (separate from performance, weights in
  `growthScoring.pure.ts`): geography, dwellingType, sample, history,
  sourceIndependence, freshness. Another horizon from one provider raises
  *history*, never *source independence*.
- **Benchmark rule**: ABS regional/state series are benchmark context and are
  refused as subject growth by name (`me7EntryGate.pure.ts`); a benchmark
  swing moves the score by a bounded, published amount and cannot promote a
  whole region.

### 4.2 Location (0.25) — where it is, not how its market performed

- **Permitted**: walkability, commute to the **nearest employment centre**
  (polycentric centre selection, audit §58 — a regional hub commutes to its
  own centre, not to a capital CBD), schools.
- **Prohibited**: `state` (owned by nobody — the 15-point state premium is
  removed and pinned), any market-performance measure.
- **Missing**: no location inputs → null, never a default; the old scorer's
  32-points-for-three-absent-inputs is the recorded defect.

**`1.2.0`, 20 September 2026 — the commute is measured to the property's own
urban centre, and a commute to somewhere else is not scored.** The polycentric
selection this section has promised since audit §58 had no implementation:
`resolveCbdDestination` returns the STATE CAPITAL, so Golden Square — a suburb
of Bendigo — was measured 114 minutes to Melbourne, which `COMMUTE_ANCHORS`
(ending `[110, 0]`) scores **0 of 100** on a property twelve minutes from the
centre it actually belongs to. Two rules close it, and the second works before
any register exists. `resolveCommuteDestination` (`urbanCentre.pure.ts`) reads
the property's Significant Urban Area and measures to that centre where
`urban_centre_register` names one, falling back to the capital exactly where
`resolveCbdDestination` does. And `ownCentre` — `yes` / `no` / `unknown` —
rides the reading: a commute measured to a centre that is **not** this
property's is recorded on the page and **excluded from the score**, because a
figure that describes a journey nobody living here makes is not a measurement
of this location. `unknown` scores as it always did, so an unreachable
geoserver or an unloaded register leaves today's behaviour standing.
`commuteExcluded` names which of the two it was.

### 4.3 Yield (0.15) — the rental return, measured once

- **Permitted**: weekly rent against a **declared basis** (purchase price or
  current value — never defaulted), outgoings for the net figure, market rent.
- **Prohibited**: holding cash flow (disclosed via `holdingCashFlowSignal`,
  never scored — the V1 double-count of negative gearing is the recorded
  defect: 78% of reports scored exactly 10).
- **Missing**: absent rent is absent — null, never the bottom band.

### 4.4 Demand (0.15) — whether the market wants it

- **Permitted**: vacancy, days on market, vendor discount, auction clearance,
  sales count, listing activity, population growth (a demand *driver*).
- **Prohibited to others**: Risk may not re-read vacancy or days on market
  (the V1 double-count); Growth may not read population growth.
- **Missing**: partial measures score with published coverage; none → null.

### 4.5 Risk (0.05) — Model D: what could go wrong that nothing else counted

`riskModelD.pure.ts` (variant `D2_requires_a_peer`), adopted into the
composition at `2.1.0`. Status: **provisional / uncalibrated** — its
own module says so, because no property-risk evidence yet exists to calibrate
against.

- **The property type selects the schema and contributes zero points.** An
  asset-type score was a type bonus wearing a risk label; the placeholder
  `"Residential Property"` resolves to no schema and is reported as a gap in
  the record, not a finding about the property.
- **Buyer LVR and buyer cash flow contribute zero points anywhere** (§5).
- **Permitted**: answered property-risk questions from the per-class schema
  (site hazard, planning, condition, strata, local supply concentration,
  delivery), grouped into independent categories; twelve-month growth as
  overheating, under the declared exception, as a **bounded deduction** (max
  25) that may score only beside a measured property-risk peer.
- **One observation is never the dimension**: fewer than
  `MINIMUM_INDEPENDENT_CATEGORIES = 2` independent categories → Risk is null
  with the observation still reported as evidence. Today no property-risk
  question is answerable from the record, so **Risk is structurally null
  platform-wide** — disclosed on every result, and the door opens by itself
  the moment hazard or strata evidence lands.

## 5. Finance Suitability — beside the score, structurally outside it

`financeSuitability.pure.ts`, version `1.0.0`. The buyer's stated position
(LVR, weekly cash flow) is a reading about **this purchase scenario, not the
property**: 1 Boxer Drive, Wyndham Vale carries two same-day reports at the
same price, one at 80% LVR and one at 90% — under the old model that was 12.8
points of Risk for a number an operator typed. The reading returns no field a
composite can read, takes the worst band rather than an average, and absent
financing means no reading, not a neutral one.

## 6. Missing-data contract

For every dimension, *performance unavailable* is distinguishable from
*performance genuinely poor*:

- unavailable → `score: null`, listed in `unavailable`, `effectiveWeight 0`, a
  printable reason;
- poor → a low number with its evidence.

Missing evidence is never 0, never 50, never neutral, never inferred; it is
never punished as poor performance (the score renormalises over what was
measured) and never selected on its value (the publication policy's
ceiling, §3). Coverage is separately visible from performance at every level.

## 7. Evidence sources and provenance

- Subject Growth precedence: Domain (existing licence at $0) → PropTrack
  trial (shadow-only) → open state suburb series → **unavailable**. ABS is
  benchmark-only, refused as subject growth by name. In production the first
  tier is what `domain-data-service` fetches on the v2 route with the trusted
  postcode; the ABS resident-population series enters Demand as the
  population driver and never Growth.
- Every evidence point carries provider, geography level, as-of date, sample,
  method, **acquisition footing** and licensing status; an undeclared footing
  is `licensing_unverified` and is not production evidence. Trial evidence may
  be shadow-scored and can never reach a client report.
- The canonical output (§8) carries a provenance row per observation.

## 8. The canonical output

`scoreOutputContract.pure.ts`, contract version `1.0.0` — one object every
consumer reads and none recalculates: methodology + component versions, score,
both grades and every cap reason, the caution (`gradeCautions` / `gradeCaution`,
`5.0.0`), eligibility ceiling, evidence coverage,
per-dimension `{performance, confidence, nominalWeight, effectiveWeight,
contributionPoints, coverage, reason}`, provenance, unavailable dimensions,
the evidence statement, Finance Suitability and the holding-cash-flow signal.
Contributions reconcile to the composite within rounding, by test.

`overallConfidence` is **deliberately null**: a blended overall confidence is
a methodology decision that belongs to calibration against real evidence, and
the field says where it will be defined instead of carrying a number nobody
has justified.

## 8b. `2.2.0` — a dimension carries the weight its evidence covers

Renormalising over the dimensions that answered was only half of
"proportional", and the other half was measurable on an issued document.

The Investment Compass issued for **97 Poole Road, Kellyville NSW 2155 on
20 September 2026** scored Demand on two of its five components —
`transactionVolume` (162 sales against a 3-period average of 228) and the
population driver (−0.4% a year) — which is **0.30 of that dimension's own
methodology**. Demand then carried the full 15% of the matrix, renormalised
up to 16% because Property Risk was unavailable. Two amplifications of one
thin reading, stacked.

The same run's own disclosure page told the reader the opposite:

> Evidence coverage 85%. This is finer than the figure above: it discounts
> each scored dimension by how much of its own method actually ran, so a
> dimension scored on part of its inputs counts as part of a dimension rather
> than a whole one.

The engine computed that 85%, published it, and did not weight by it. `2.2.0`
closes the gap between the disclosure and the arithmetic: a dimension's weight
is its **original weight discounted by its own coverage**, and the measured
dimensions renormalise over those.

Four properties, each pinned by test rather than promised:

* **It is symmetric.** A thinly evidenced favourable reading loses exactly the
  influence a thinly evidenced adverse one loses. Nothing in the rule reads a
  score.
* **It can only lower a weight toward the evidence, never raise one.** A
  dimension measured in full keeps its whole nominal weight, so a fully
  evidenced record is untouched — the strong and weak control fixtures score
  82 and 20 before and after.
* **A measured zero is still a measurement.** Coverage is about how much of a
  methodology ran, never about what it found.
* **Absent coverage is 1.** A caller that does not know how much of a
  dimension ran states nothing about it, so every existing caller is
  byte-identical.

The control that shows what it cost: a constructed record evidenced on 42% of
the matrix scored **62 (B)** while 97 Poole Road, evidenced on 85%, scored
**49 (C)**. After `2.2.0` they are 58 and 53.

### Demand `4.1.0` — the driver carries its own weight

`4.0.0` stopped a non-primary driver being the WHOLE of a Demand score
(`DEMAND_PRIMARY`). It did not stop it being most of one: renormalising over
the measured mass gave `populationDriver`'s 0.15 a share of **0.50** on a
record carrying one primary — three and a third times the weight this module
states it holds, and exactly the case 97 Poole Road presented.

`4.1.0` states it in arithmetic: the primaries renormalise among themselves
over the primary mass, and a non-primary component is added at its nominal
weight and never renormalised up. It is a no-op where every component is
present and where no driver is present, and it still cannot invent a score —
with no primary the dimension is `null`, unchanged.

Measured on the same frozen inputs: Demand 21 → 27 on 97 Poole Road, where
the driver read below the primary, and 75 → 74 on a control where it read
above. The same rule, in both directions.

## 8c. `3.0.0` — growth and yield were two halves of one quantity

The grade was flat, and the reason was not where anyone had looked. It was not
that the top of the scale was unreachable; it was that the bottom was not
reachable either.

### The measurement

A 4,000-property population, built to respect the one structural fact of
Australian residential investment — premium metro buys growth with yield,
regional buys yield with growth — scored through the live engine:

```
dimension score spreads        sd
  growth                    16.04
  location                  14.52
  yield                     35.17
  demand                    11.22
  COMPOSITE                  6.28   <- smaller than any part of it
```

A composite whose standard deviation is less than half its smallest
component's is not aggregating information. It is cancelling it, and the
cancellation decomposes exactly:

```
  growth : yield      rho -0.910    variance contribution  -61.6
  growth : location   rho  0.636                           +29.6
  yield  : location   rho -0.603                           -23.1
  growth : demand     rho  0.452                            +9.8
  independent variance 85.0, cross-terms -45.3
  => sd 6.30 predicted, 6.28 measured.   53% of the variance destroyed.
```

### What it cost

On one excellent location, the engine scored:

| property | growth | yield | total return | score |
| --- | ---: | ---: | ---: | ---: |
| premium metro | 9.0% | 2.8% | 11.8% | 69 |
| strong metro | 7.0% | 3.8% | 10.8% | 69 |
| middle ring | 6.0% | 4.4% | 10.4% | 69 |
| regional yield | 3.5% | 6.5% | 10.0% | 68 |
| mining yield | 2.0% | 8.0% | 10.0% | 66 |
| **genuinely poor** | **2.0%** | **3.0%** | **5.0%** | **54** |

Five different investment propositions three points apart, and a property
returning five per cent scoring 54. Every property won one of the two
anti-correlated halves and lost the other.

### The change

**The income dimension scores the yield against what this asset's own market
pays**, rather than against the whole corpus. A 2.80% yield at 9% growth and
an 8.00% yield at 2% growth are both exactly what their market pays; they are
equally fair purchases and now score equally, where the absolute anchors
scored them 21 and 97.

A ladder, best first, and the reading names which rung it stood on:

| rung | expectation | basis |
| --- | --- | --- |
| `market_relative` | `medianRent x 52 / medianPrice` for this market | **measured** |
| `frontier` | the declared national growth/yield trade-off | declared |
| — | neither available: null, and the absolute score stands | — |

**Growth was NOT moved onto total return, and that is a measured decision
rather than a preference.** It was tried: total return and income advantage
are nearly the same linear combination (`g + y` against `y + 0.743g`), the two
dimensions then correlated **+0.808**, and the spread that bought was one
signal counted twice — the `r = 0.97` defect `GROWTH_WEIGHTS_V3_0` records,
arrived at from the other direction. Total return is published beside the
score as evidence and carries no weight.

### The result

```
                      sd    p10  p50  p90  max   growth:yield
  2.2.0              6.28    52   61   68   79        -0.910
  3.0.0             11.51    44   61   76   87        +0.246
```

The median does not move. **This is spread, not inflation** — the tails open
in both directions, and the two dimensions are near-orthogonal instead of
cancelling. On the frozen fixtures: the strong control 82 -> **86 (A+)**, the
weak control 20 -> **17 (F)**, and 97 Poole Road 53 -> **51**, because its
3.47% yield is short of what a 6.2%-growth market pays.

### What is outstanding, and it is load-bearing

`YIELD_FRONTIER` is **declared, not fitted**. Its slope and intercept are a
least-squares line through five market archetypes, and the `frontier` rung of
the ladder rests on them wherever a market publishes no median rent — which
is the common case today. It should be FITTED from the register this platform
already loads: the NSW DCJ Rent and Sales Report publishes median rent and
median sale price for the same postcode, which is both halves. Until it is,
`frontierBasis` reads `declared` on every reading that used it, and no reader
is told a declared line is a measured one.

Nominal weights, grade thresholds, the five dimensions and every publication
safeguard are unchanged.

## 9. Change control

Every module carries its own version; the composition version (`3.0.0`)
bumps whenever composition, weights or component versions change, and is
persisted with every score so a stored result can be reproduced exactly. No
silent changes: a calibration requires the demonstrated defect, the
correction, and the re-run, on the record. The engine is reached by one
production entrypoint through the activation module and by nothing else —
asserted by the guard in the pin spec, not promised — and the activation
record itself (`SCORING_V2_ACTIVATION`) is the one place the conditions under
which a grade is issued may be changed.

### Growth providers, 16 September 2026

Two more register sources and a floor. Victoria (suburb, annual and
quarterly) and South Australia (suburb, quarterly) load through the
Internet Archive's captures of their walled publishers; the ABS state
series (`abs_res_dwell`, the MEAN price of the dwelling stock, `state`
grain) is read only where nothing finer answered and is priced at the
bottom of the geography ladder. The state floor supplies growth and a
series and never a median, so `medianPrice` and `salesCount` stay absent
on a floor-only reading. `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md` §10.
