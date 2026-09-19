# RF-7.2B.1 — Forward-Safe Data Activation

**Scope: the Investment Property Report only. Forward-only. No historical report is
rewritten, re-narrated or re-rendered.**

RF-7.2B built the Client-Safe Gate, the safe fact projection, the visibility policy
and the safe narrative bundle — and wired **none** of them. A report generated the day
that merged received exactly what it had received before. That distinction is what this
phase closes, and it is the reason several of the proofs below are source-level
assertions against the real Edge Functions rather than unit tests of pure modules: a
unit test cannot tell you whether production calls the thing it is testing, and "the
gate exists" was precisely the claim that turned out not to mean what it sounded like.

---

## 0. Status — infrastructure vs production path

These are answered separately on purpose, because collapsing them is what went wrong last time.

| | Infrastructure exists | Production path activated |
| --- | --- | --- |
| Client-Safe Gate | YES (RF-7.2B) | **YES** — `generate-investment-report` and `regenerate-report-qualitative` |
| Generated demographics blocked | YES | **YES** |
| Trusted ABS POA admitted | YES | **YES** — and cross-checked against the subject's own postcode |
| Unsafe Location trio + transport score blocked | YES | **YES** |
| Hardcoded / LLM cash rate blocked | YES | **YES** |
| Current RBA cash-rate target ingested | **NEW** | **CODE YES / DATA PENDING A LOAD** (§4) |
| Report-time market-fact snapshot | **NEW** | **YES** — individual valued facts, ABS and RBA |
| Market-claim reconciliation | YES (RF-7.2B) | **YES** — a fault makes the report non-clean at `high` severity |
| Pre-generation geography resolution | **NEW** | **YES** — from this run's own coordinate, before the gate |
| Delivery gate on a flagged report | — | **NO — documented, deliberately not added** (§6a) |
| RBA current effective date (vs last-changed) | **NEW** | **YES** — four distinct facts |
| "Narrated implies snapshotted" enforced | **NEW** | **YES** — by measurement (§5) |
| Legacy scorer | untouched | cannot publish a grade (`PRODUCTION_SCORING_AUTHORITY = 'unavailable'`) |
| Visibility policy as Viewer/PDF authority | YES | **NO** — RF-7.2C |
| Chart-null policy in production charts | YES | **NO** — RF-7.2C |
| Rent-basis production capture | contract only | **NO** (§8) |

**Code activation: READY. Production source load: NOT YET VERIFIED** — see §9c, the
post-deploy activation check. RF-7.2B.1 is not operationally complete merely because
it fails closed.

**Ready for RF-7.2C: YES for data integrity; the Viewer/PDF adoption is RF-7.2C's own work.**

---

## 1. The live generation path, as traced

Callers of `generate-investment-report`, all verified:

- **Browser** — `InvestmentReportGenerator` (×3), `ClientPropertyInvestmentReport`,
  `ReportGenerationProgress`, `InvestmentReportModal`, `ErrorLogs`,
  `useChunkedRegeneration`.
- **Server** — `resume-investment-reports` (the watchdog), `auto-report-sync`,
  `auto-report-webhook`, `generate-bulk-reports`, `ai-dashboard-agent`.

Where each fact enters:

| Concern | Where |
| --- | --- |
| Enhanced-data fan-out | phase-1 parallel block, seven services |
| Demographics → prompt | `demographicsStatBlocks(enhancedData)` |
| `economics.cashRate` → prompt | `macroEconomicBlock(enhancedData)` |
| `location_intelligence` → prompt | inline `${enhancedData.locationIntelligence?…}` in the base prompts |
| Prompt built | four base prompts — suburb / postcode / statewide / property — selected by `reportScope` |
| `report_content` stored | early, progressive and final writes |

**The finding that shaped the design: there are two narrative paths, not one.**
`regenerate-report-qualitative` is a second, fully-featured copy — its own fan-out, its
own `buildEnhancedDataContext`, its own prompt. Gating only the main generator would
have left an unguarded route to the model carrying every disowned fact. It also
hard-coded the header `**DEMOGRAPHIC DATA (ABS Census):**` regardless of what the
payload actually was; that label now comes from the payload's own source.

**Two things checked and found NOT to be defects**, recorded so nobody re-investigates:
the resume path's `existingEnhancedFields` is write-path only (a guard against
overwriting persisted values) and never merges into `enhancedData`, so there is no
prompt bypass; and no `XX` or bracket placeholder appears in any stored report body
since 2026-08-01.

---

## 2. Where the gate sits, and why there

`activateSafeGenerationInputs` is called **once per run, on the object**, after the
enhanced-data fan-out and before the first prompt is composed. Gating the object rather
than each prompt is what makes it structural: a fact that is not on `enhancedData`
cannot reach a prompt that interpolates `enhancedData`, whichever of the five prompts
it is and however it is written later.

It is deliberately placed **after** the scoring calls. `investmentScoreEngine` reads
`walkScore`, `commute.durationMinutes` and `schools.schoolsWithin3km`; sanitising before
it would silently move every new report's score. That is the scoring programme's
territory, with its own forward-only closeout, so it is a **named carry-forward** rather
than a change taken quietly under this mandate — per the mandate's own instruction to
stop and report rather than broaden scope.

Placement therefore yields: **scoring on its existing inputs; narrative and stored
snapshot on gated facts.**

### What is withheld

`walkScore` · `transport.qualityScore` · `commute` · `schools.schoolsWithin3km`, plus
demographics that are not a recognised ABS postal-area retrieval, plus a cash-rate
target the gate refuses.

Two judgement calls, stated rather than buried:

- **The whole `commute` block goes, not just its duration.** The measured defect was
  destination routing and the live service has since fixed it — but a resumed run, a
  stored blob and a fresh call are the same shape, so nothing at this boundary can tell
  a repaired value from a legacy one. Blocking all of them cannot under-block; admitting
  the shape can. The cost is a loss of detail, not of accuracy.
- **Only the schools COUNT is disowned.** `nearestSchool` and `distanceToSchool` already
  pass through `reconcileNearestSchool` / `reconcileSchoolDistances`; removing a working
  reconciliation would be widening the phase.

### The ABS data must describe THIS property

A genuine ABS source is not enough if it describes somewhere else. The gate now
requires `demographic POA === trusted report_geography postcode`: a real POA 3338
retrieval attached to a property in 3024 is authoritative about somebody else's
suburb, and is **blocked with an explicit reason** naming both postcodes. SEIFA
goes with it, because it describes the same postal area. Untrusted or absent
geography withholds rather than vouches. Nothing is estimated, synthesised or
borrowed from a neighbour.

### Geography is resolved BEFORE the gate (C2)

The ordering defect this phase first reported, now closed. `resolve-report-geography`
self-selects reports whose `location_intelligence` is **already persisted** — which
happens at the generator's own write — so a **first** generation had no geography row
and its demographics failed closed, while a regeneration of the same property received
area statistics. Same property, two documents, decided by whether a batch job had been
past.

The order is now:

```
PROPERTY / TRUSTED COORDINATE
  → GEOGRAPHY RESOLUTION      (resolveOneReportGeography, from this run's coordinate)
  → TRUSTED POSTCODE / ASGS IDENTITY
  → ABS LOOKUP                (re-queried on the trusted POA where it disagrees)
  → CLIENT-SAFE GATE
  → REPORT-TIME SNAPSHOT
  → NARRATIVE
```

**There is no second geography algorithm.** The sweep's per-report body was lifted into
`_shared/geography/resolveOneReportGeography.ts` and the sweep now calls it too, so the
batch and both generators resolve through one `resolveGeography` over the same ASGS 2021
boundaries. It runs immediately after location intelligence — the first point at which a
verified coordinate exists — and takes an injected `lookupPoint` so the boundary service
is never reached from a test.

Four things it does **not** do, each because the mandate names it:

- it never reads the free-text suburb or postcode (that string is what produced the
  untrusted postcode in the first place);
- POA equality is unchanged — a resolution that disagrees still withholds;
- no geography is borrowed from a neighbour, and none is synthesised;
- an unresolved coordinate leaves `subjectGeography` null and the gate withholds
  exactly as before.

**The ABS re-query, and all THREE payloads move together.** Where the trusted POA
differs from the address-derived one, the phase-1 payloads describe somebody else's
postal area, so demographics, SEIFA **and employment** are re-fetched for the subject's
own. Employment is in that list because `abs-employment-service` projects the same
`abs_census_poa` row and `industryTable` prints from it independently: re-keying two of
the three would put a 3024 population table beside a 3338 industry mix on one page, and
the gate would admit it, because `demographicsKept` is true. The employment call also
takes a suburb, and it takes the **boundary's** suburb — never the free-text one, which
belongs to the postcode we have just stopped believing. Where a re-fetch cannot be made,
the wrong-area payload is **dropped rather than kept** — the gate would refuse it on the
cross-check anyway, and carrying it forward would store a figure about the wrong place
in the snapshot.

**The suburb-directory cross-check is PERFORMED, not declared.** See §3 — it was the
eighth defect, and the one that made every otherwise-perfect resolution read
`resolved_with_warning`.

**The stored-row read survives as a fallback**, for the one case the resolution cannot
cover: a run where the resolution itself failed. Reading a row an earlier sweep wrote is
the behaviour this function already had, so the fallback cannot make a report worse than
it was. Which route was taken is recorded on the snapshot (`geography.source`:
`pre_generation` | `stored_row` | `none`), because a reader of a stored report cannot
otherwise tell.

### Trust is asymmetric

A source must be **recognised** to pass. The live payload stamps
`ABS Census 2021 (POA 3338)`; the generated corpus stamped `ABS Census 2021 estimates`
and several variants. `isCensusProjectionSource` is exported **beside its producer** in
`absCensusProjection.pure.ts`, because a recogniser written separately from the thing it
recognises is how the two come to disagree.

---

## 3. Eight defects this phase found in itself

Both were found by proofs, not by review, and both are pinned by tests.

**A skeleton table asking the model to invent a Walk Score.** The suburb prompt carried
a hand-written table with literal `XX` cells for Walk Score, CBD commute and "access
scores" — no `enhancedData` interpolation at all, so the gate could never have reached
it. Found by a source-level assertion; the rows are gone and the prompt now forbids
stating any of them.

**The gate's refusal did not reach the prompt.** `macroEconomicBlock` renders
`economics.cashRateTarget` straight off the payload. Recording the refusal in the fact
list while leaving the value in place printed a "current" cash-rate row, with an
effective date, from an LLM-sourced series. Found by the forward cohort — which is
exactly why the cohort runs against the **sanitised** object, as production does, rather
than against the inputs. The activation now removes a refused target from the payload,
so the block fails closed onto the monthly average under its own label.

### `report_geography` has never held a row, and not for the reason assumed

Lifting the sweep's body out exposed why the table is empty. The batch wrote
`method: 'point_in_polygon'`; the table's CHECK constraint admits
`'asgs_point_in_polygon'` or `'none'`. **Every upsert violated it and every write
failed** — and the failure was swallowed into a per-report `write_failed:` string in a
`results` array nobody reads, under HTTP 200 throughout. "The backfill has not run yet"
was the wrong diagnosis of a silent constraint violation. Fixed in the one module that
now writes, and pinned by a test that asserts the written `method`.

### The geocoder's country fallback would have been placed in the desert

`components=country:AU` does not fail on an unmatched address: it answers the centre of
the continent with HTTP 200. That point is inside the bounding box, on land, and a
boundary query places it in a **real remote locality with a real postcode** — so the
cross-check would have compared a genuine POA against a genuine POA and admitted area
statistics for the Simpson Desert. `resolveGeography` now refuses it, through
`isAustraliaCentroid` — the check `auPointTrust.pure.ts` already uses, imported rather
than re-implemented — under a new `geocoder_country_fallback` flag.

### Three figures reached a client's page and nothing recorded them

Found by the §C5 coverage probe on its first run, each closed:

- the four **SEIFA deciles**. `seifaTable` prints score *and* decile; only the score was
  snapshotted, and a decile is a separately published figure rather than a rounding of
  the score beside it, so it could not be re-derived.
- **`decisionsSinceChange`** — the macro table prints "unchanged at 2 Board decisions
  since", and nothing stored the 2.
- the **industry workforce shares** — up to five named industries with a measured share
  each, printed under their own heading.

### The gate had a third payload from the same table, ungated

The worst of the seven, and the probe found it rather than review. `industryTable` reads
`employmentData`, which `abs-employment-service` projects from the **same
`abs_census_poa` row** keyed on the **same address-derived postcode** — and it prints
**independently** of the population table. So a report whose demographics were refused
for describing postal area 3338 while the property resolves to 3024 still printed 3338's
industry mix, under its own heading, as a client-visible table. `employmentData` is now
withheld on the same geography ground as `demographics` and `seifaData`, and re-queried
with them when the POA moves: one rule, three payloads, one table — enforced at both
ends, because gating them together while re-keying only two would have reintroduced the
same mismatch through the front door.

### "Not checked" was indistinguishable from "not found"

The eighth, found in review of the seventh's own output, and the one that explains a
reading the first cohort recorded as merely honest.

`resolveGeography` interprets `directoryMatches: []` as **the directory was checked and
this suburb is not in it** — and every caller, the sweep and both generators, passed
`[]` without opening the directory. So every resolution this module has ever produced
carried `suburb_not_in_directory` and read `resolved_with_warning`: a warning about a
check nobody ran, on a geography that was correct.

The second half is worse than the noise. The postcode and state comparisons sit in the
`else` branch — the populated one — so with every caller passing `[]`, the two
disagreements this validation exists to catch were **unreachable**:
`suburb_postcode_mismatch` and `state_mismatch` could not be raised by any code path,
ever. A validation that can only ever return one of its four answers is not a validation.

Both halves are fixed, and deliberately both rather than either:

1. **The check is performed.** `readDirectory` queries the same `suburb_directory` the
   listings pipeline uses, by the **stripped** ASGS name (`Springfield (Qld)` carries a
   qualifier no directory holds) with `normalisePlaceName` filtering the rows, so case,
   punctuation and an ABS qualifier cannot cause a false miss. It is a parameterised
   `.ilike`, never a composed `.or()` string — the pattern this repository has been
   bitten by twice.
2. **The API's three states are three facts.** `null`/`undefined` is *not checked* and
   raises no directory flag at all (a note records the absence); `[]` is *checked and
   absent* and still warns; rows are *checked and matched*. Doing only (1) would leave
   the same trap armed for the next caller — and for this one, because the directory read
   can itself fail, and a database fault must never become a finding about somebody's
   suburb.

The ASGS point-in-polygon answer remains the authority in all three states. A test
asserts the suburb, postcode, state and locality code are identical whether the directory
agrees, disagrees or was never opened.

---

## 4. The RBA decision, and what it rests on

**Decision: the Investment Property Report's primary macroeconomic fact is the CURRENT
RBA cash-rate target with its effective date.** `FIRMMCRT` is retained solely as
explicitly-labelled monthly-average trend context.

### The correction: four facts, not two

The first implementation reported `4.35% — effective 6 May 2026`. **That was the
last CHANGE date, not the effective date**, and the difference is three months.

F1's `FIRMMCCRT` records only NON-ZERO changes — measured over the whole published
series, its distinct values are `-0.50, -0.25, -0.15, 0.25, 0.50`, with no `0`
anywhere. The Board met on 17 June 2026 and again on 12 August 2026 and left the
target where it was; F1 has no row for either, so nothing derivable from F1 can
reach the RBA's own published effective date.

The RBA's decision history does record holds, and the four facts are now separate:

| Fact | Value | Source |
| --- | --- | --- |
| Current target | **4.35%** | decision history, cross-checked against F1 |
| Current effective date | **12 August 2026** | decision history (most recent Board decision) |
| Last changed date | **6 May 2026** | decision history |
| Last change | **+0.25 percentage points** | decision history |
| Decisions held since | 2 (17 Jun, 12 Aug) | decision history |

They render as four rows rather than one, and the prompt forbids presenting the
last-changed date as the effective date, or writing that the rate "has been at
this level since" the effective date — it has been at this level since it last
*changed*.

`rba_cash_rate_decisions` stores the history (401 decisions back to January 1990,
300 of them holds). The seven 1990 rows the RBA published as a RANGE — e.g.
`15.00 to 15.50` — are kept with their verbatim text and null numerics rather than
dropped, so a truncated download can never be mistaken for a short history.

**Fails closed four ways**: no decision history loaded (F1 alone yields *null*,
because F1's last-change date is not a substitute for an effective date); no
non-zero change anywhere in the history; a history of holds alone; or F1
disagreeing with the decision history about the rate in force — two official RBA
sources disagreeing is never something to average.

The two are different facts, and the difference is measurable. `FIRMMCRT` is F1.1's
"Cash Rate Target; **monthly average**": in a month containing a Board change it averages
two targets and equals neither. The series carries 4.31, 3.96, 3.83 and 3.70 — and no
Board ever set any of them. The reading's own `lastMove` on the monthly series reports
"June 2026, from **4.31** to 4.35", which is the artefact in one line.

**Source: RBA Statistical Table F1 — Interest Rates and Yields, Money Market, Daily.**
Official, no LLM, no third party.

| | |
| --- | --- |
| `FIRMMCRTD` | "Cash Rate Target on date", daily |
| `FIRMMCCRT` | "Change in the Cash Rate Target", **as announced** |

The effective date is therefore read from the RBA's own announcement column, never
inferred by differencing values. Measured from the published file on 11 Sep 2026:

> **RBA Cash Rate Target: 4.35% — effective 6 May 2026**, in force as at 10 September 2026.
> Source: RBA statistical table F1, published 11-Sep-2026.

This also confirms RF-7.2B's correction: the hardcoded 4.35 is **accidentally correct
today**, having been wrong by 75bp over the bulk of the historical corpus.

**Fails closed, three ways** — no F1 loaded, no announced change in the window, or the
level column and the change column disagreeing. In every case `cashRateTargetOf` returns
null, the payload carries no target, and the prompt block states plainly that no current
rate is available and that the only figure present is a monthly average. It never
substitutes the average behind a "current" label.

**Preservation finding that shaped the storage.** `rba-data-service` reads a four-year
window capped at PostgREST's 1,000 rows, sized for "~400 rows for the 11 series". F1 is
daily — 3,972 dated rows. Stored whole it would have pushed every monthly and quarterly
observation out of that window and silently emptied the cash-rate, inflation and
lending-rate readings, with nothing reporting an error. So `RBA_PERSIST_POLICY` stores F1
at the grain of the fact: the announced-change dates plus the latest observation. **75
rows instead of ~7,900**, verified by execution; F1.1 is untouched at 433.

**Data status.** The code is complete and verified against the real published file. The
production load needs the updated `rba-tables-ingest` deployed (which happens on merge)
and then `node scripts/rba/load-rba-tables.mjs --table f1`. Until that runs, the reading
fails closed as designed — which is safe, and is why activation does not depend on it.

---

## 5. The report-time snapshot

`investment_reports.market_fact_snapshot` (jsonb, nullable, additive, **never
backfilled**). Per authoritative fact: value, status, source, dataset/series, geography
grain, geography identifier, reference period, as-of/publication date, the gate's
ruling, and the assurance version the snapshot was produced under.

### The correction: actual values, not a marker

The first implementation recorded `market.demographics = "retrieved"` and nothing
else — which cannot answer *which number did the narrative quote*. Every ABS
metric that reaches the prose is now its own fact carrying its own value:

`abs.population` · `abs.medianAge` · `abs.medianHouseholdIncomeAnnual` ·
`abs.medianWeeklyIncome` · `abs.unemploymentRate` · `abs.labourForce` ·
`abs.labourForceParticipation` · `abs.employmentRate`, plus
`abs.seifa.{irsad,irsd,ier,ieo}`, their four `…Decile` twins, and one
`abs.industryShare.<industry>` per printed industry row.

The list is transcribed from `censusPromptBlocks` rather than from the table, so
it records what a **client was shown** rather than what was fetched. The RBA side
is the same: `market.cashRateTargetCurrent`,
`market.cashRateTargetEffectiveDate`, `market.cashRateTargetLastChangedDate`,
`market.cashRateTargetLastChangePoints` and
`market.cashRateTargetDecisionsSinceChange` are five separate values, so a
snapshot cannot preserve the conflation the correction removed.

The snapshot also carries `geography` — the postal area every area fact is keyed on,
the resolver's status, how it was reached, and whether the ABS payload was re-queried
on the trusted POA. The facts say which POA; this says how that POA was established.

### The rule that keeps it complete: narrated implies snapshotted (C5)

> Any market fact admitted to a narrative prompt must have a corresponding snapshot
> fact unless explicitly classified as non-snapshotted static copy.

Enforced by measurement, in `rf72b1SnapshotCoverage.spec.ts`. Every leaf number in a
production-shaped payload is stamped with a unique value, the real gate runs, the real
prompt blocks are composed from the sanitised object, and any stamp reaching the prose
without reaching the snapshot fails the test by name. A source scan was the obvious
alternative and is not equivalent — the blocks read through local aliases
(`emp['laborForce']`), and a scanner that is 90% right on that is worse than none.

It found three real gaps on its first run (§3) and one gate hole. The escape hatch,
`NON_SNAPSHOTTED_NARRATIVE_PATHS`, is **empty**: what would belong in it is static copy
that merely looks like a figure, never a measured value, and an entry costs a written
reason.

The rule: **reopening a report must never re-read today's ABS or RBA tables and quietly
restate the document.** NULL means the report predates the snapshot — not that its
snapshot is empty.

Written on the early, progressive and final writes, so a run killed at the wall-clock
budget still leaves the provenance of what it had already put in front of a reader. A
qualitative regeneration refreshes it, because that path rewrites the prose from
freshly-fetched facts and the two must not describe different runs; reopening does not.

---

## 6. Market-claim reconciliation (§7)

`auditMarketClaims` runs post-generation beside the existing fact reconciliation. That
one asks whether the prose agrees with the record; this asks whether a figure it agrees
with has been given a label the source does not support — which is the half RF-7.2A
named as structural, since reconciling prose against injected facts proves faithfulness,
not truth.

Three faults, each named by the mandate: **grain** (a postal-area figure called a
suburb's), **period** (a 2021 Census figure called current), **source** (a monthly
average called the rate in force).

**Generation completes; client readiness does not.** Findings become
`validation_flags`, which is the report QA mechanism that already exists:
`QualityAssurance.tsx` splits reports into `cleanReports` and
`reportsWithValidationIssues` purely on `validation_flags.length > 0`, so a report
carrying one of these faults is no longer clean and cannot be presented as such
until corrected.

They are raised at **`high`** — the page counts `critical | high | medium`, and a
band it does not count reads as no finding at all. That is deliberately a step
above the `warning` the prose-vs-record reconciliation uses beside it: a yield
disagreeing by a rounding step is a possible discrepancy, whereas these three are
validated semantic errors about what a figure *is*.

It is deliberately narrow: it matches a fact's own value in the prose and reads the
words around it, rather than parsing claims in general. A broad claim parser that is 80%
right generates more noise than signal, and a reviewer who learns to ignore these flags
is worse off than one who never had them. One finding per fact per kind, for the same
reason.

---

## 6a. There is no delivery gate — stated, not hidden

This is the limitation a reader of this document most needs, so it has its own section
rather than a sentence inside another one.

What happens today, exactly:

1. **Generation completes.** A market-claim fault never fails a run. The report is
   written, `status` is set to `completed`, and the prose is whatever the model wrote.
2. **The report leaves the clean set.** A `high` fault lands in `validation_flags`, and
   `QualityAssurance.tsx` splits `cleanReports` from `reportsWithValidationIssues`
   purely on `validation_flags.length > 0`. The report is counted and surfaced as
   carrying an issue, at a severity band the page counts.
3. **Nothing stops it being delivered.** No share, download, email or PDF route
   consults `validation_flags`. A flagged report can be sent to a client exactly as an
   unflagged one can.

That gap is **deliberate in this PR and must not be read as closed.** Adding a delivery
gate is a new operational control — it decides who may override it, what a client sees
while a report is held, and what happens to a report already sent — and that is a
workflow decision rather than a use of the existing mechanism.

**Carried forward as an operational control to settle before broad client rollout.**
Until it is settled, the flag is a *review signal for staff*, not an enforcement
boundary, and the programme's assurance claim must be stated that way.

---

## 7. Forward cohort (§13) and delta ledger (§14)

Nineteen scenarios exercised through the activation against the **sanitised** object,
composing the real prompt blocks: trusted geography + ABS match, unresolved geography,
no ABS match, metro, regional, rent present, rent absent, finance complete, finance
partial, zero cash flow, negative cash flow, historical-location blob present, hardcoded
economic blob present, LLM economic source present, generated demographics present,
empty payload, null payload, genuine zero amenity, target absent with monthly held.

**Result: 19 of 19 clean — no disowned identifier, no `undefined`, no `NaN`, no
technical null token reaches any prompt block.**

Every delta from legacy generation, classified:

| Classification | Where it occurs |
| --- | --- |
| Unsafe fact removed | the four Location fields, wherever a payload carried them |
| Authoritative fact substituted | cash rate: monthly average → in-force target with effective date |
| Grain corrected | demographics stated at postcode grain, with the POA on the snapshot |
| Period corrected | every figure carries its own reference period; the audit flags present-tense restatement |
| Source corrected | the cash-rate row names F1 vs F1.1 explicitly |
| Explicit unavailable state | demographics withheld with a reason; cash rate fails closed |
| Null suppressed | `bindingResolver`'s presence-before-formatting fix (already live from RF-7.2B) |
| Genuine zero preserved | a zero amenity count, and a zero cash rate, survive as zero |

**No unexplained delta.** The two behaviour changes a reader would notice are both
intended and both listed: the four Location facts no longer appear in the narrative, and
the cash rate is now stated as an in-force target rather than a month's average.

### 7a. The FIRST-GENERATION cohort (C3)

The cohort above exercises the gate from an already-assembled payload. It cannot see a
defect of ORDER, which is what §2's geography finding was — so
`rf72b1FirstGenerationCohort.spec.ts` runs the whole chain instead, in production's
order, with the production modules:

```
COORDINATE → GEOGRAPHY → POA → ABS → GATE → SNAPSHOT → PROMPT
```

Eight scenarios, each traced through every step:

| # | Scenario | Geography | Directory | Trusted POA | Gate | What the page gets |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | trusted coordinate + matching ABS POA | `resolved` | checked, matched | 3338 | **admitted** | real figures, sourced |
| 2 | trusted coordinate, regional | `resolved` | checked, matched | 3844 | **admitted** | real figures, sourced |
| 3 | sentinel coordinate (country fallback) | `unresolved` | not asked | — | **withheld** | an honest absence |
| 4 | missing coordinate | `unresolved` | not asked | — | **withheld** | an honest absence |
| 5 | coordinate that cannot resolve (service down) | `unresolved` | not asked | — | **withheld** | an honest absence, retryable |
| 6 | wrong / stale ABS POA (3338 payload, 3024 property) | `resolved` | checked, matched | 3024 | **withheld** | an honest absence naming both |
| 7 | regenerated report with an existing geography row | `resolved` | (stored row) | 3338 | **admitted** | identical to #1 |
| 8 | historical / backfilled row | `resolved_with_warning` | (stored row) | 3338 | **admitted** | identical to #1 |

**The three expectations the mandate set, all met by execution:** a valid first
generation receives valid ABS facts (#1, #2); an unresolved first generation fails
closed (#3, #4, #5); a wrong POA fails closed (#6).

And the inconsistency this closes is asserted directly: on the same property, with the
same coordinate, **the first generation and the regeneration now produce byte-identical
prompt text** (#1 vs #7). Before the resolution moved ahead of the gate they did not.

Across all eight: no disowned Location identifier, no `undefined`, no `NaN`, no `null`
token, no `XX` placeholder, and the cash rate is the in-force target with both dates on
every one — including the five where no area statistics exist at all.

Scenario 8 keeps `resolved_with_warning` deliberately: a suburb the directory genuinely
does not carry is a real state, and a warned row must admit area statistics exactly as a
clean one does — which is what makes `subjectPostcodeOf` accept both, and what scenarios
7 and 8 exist side by side to prove.

**The reading the first version of this cohort recorded as "honest" was a defect**, and
§3 is where it is now written up. Every live resolution read `resolved_with_warning`
because every caller passed `directoryMatches: []` without opening the directory, and the
resolver reads `[]` as "checked and absent". The check is performed now, "not checked" is
a distinct third state, and a good geography resolves clean.

---

## 8. Rent basis (§9)

| | |
| --- | --- |
| Contract support | **YES** — `rentBasis` / `rentAsOf` on the Fact Contract |
| Production capture | **NO** |

The only `rent_basis` writers in the repository are the **commercial lease** forms
(`LeaseFormModal`, `RentRollTable`) — a different feature with a different meaning.
Nothing in the Investment Report's intake captures a residential rent basis.

Per the mandate, no intake was changed and no basis is guessed: historical basis stays
unknown, and the existing frontend is untouched. Adding capture needs a frontend change
and is therefore **put to the owner rather than taken**: the smallest
backwards-compatible version is an optional basis selector beside the weekly-rent field
in `InvestmentReportGenerator` / `ManualDataOverrideModal`, defaulting to unset, with
the contract's existing `normaliseRentBasis` accepting it. Not built here.

---

## 9. Preservation

Unchanged and verified: report creation, all eleven callers, chunked generation, the
resume watchdog, regeneration, versions, fork/derived reports, templates, **template
selection** (`reportTemplateSelection.pure.ts` carries no reference to this phase's
machinery), branding, images, download, share, Q&A, comparisons, automation/bulk and
every frontend route. No visual redesign. No Viewer or PDF migration. No other report
family.

- Edge Function type-check: **339 errors, baseline 339 — no new errors.**
- `src/lib/reports`: **3,985 passing, 0 failing** (163 files, 3 skipped).
- `resolve-report-geography` keeps its contract exactly: same selection, same batch
  size, same response shape. Only the per-report body moved, and it moved into the
  module the generators now share.
- The activation never mutates its input, so nothing it touches can rewrite a stored row.
- The migration is `ADD COLUMN IF NOT EXISTS` only — no UPDATE, no INSERT, no DROP.

---

## 9a. The migration timestamps

`20261119100000_report_market_fact_snapshot.sql` and
`20261119110000_rba_cash_rate_decisions.sql`.

Both are dated after 11 September 2026, and that is **deliberate rather than
accidental**. 98 of the repository's existing migrations already carry versions
between 20260911 and 20261119: the version sequence has drifted ahead of
wall-clock time, and the repo's documented convention is monotonic ORDERING
("must remain later than every…", "unique and later than…"), not calendar
accuracy. Dating these in September would place them behind 97 already-applied
migrations and risk being skipped by version-tracking.

They are therefore anchored immediately after the current maximum
(`20261119093000`), adding no new drift. The first version chosen (`20261121101500`)
was arbitrary and has been corrected.

## 9b. The scoring-authority boundary, proven not altered

This PR touches neither `investmentScoreEngine.ts` nor
`scoringInputPolicy.pure.ts`. The boundary is proven by the existing
`scoringInputPolicy.spec.ts`; RF-7.2B.1 adds only the minimum integration
assertions that it still stands:

- `PRODUCTION_SCORING_AUTHORITY === 'unavailable'`
- `mayPublishOverallGrade('unavailable') === false`
- `mayPublishDimensionScores('unavailable') === false`
- neither the engine nor the policy references this phase's machinery

So even though the legacy scorer still consumes the disowned `walkScore`,
`commute` and `schools` fields, a new report cannot publish an overall grade, a
dimension assessment or a score-derived verdict from that path. V2 is untouched.

## 9c. Post-deploy activation check (required)

RF-7.2B.1 has **two statuses and they are not the same claim**:

- **CODE READY** — all exact-head gates green. This is what this PR can establish.
- **OPERATIONALLY VERIFIED** — established only after deployment, by the check below.

Code activation is ready; **the production source load is not verified**. RF-7.2B.1 is
not operationally complete merely because it fails closed, and **operational closure
must not be declared before every step here passes.**

1. **Load the RBA decision-history source** —
   `node scripts/rba/load-rba-tables.mjs --table cash-rate,f1` — and confirm the run
   reports a row count at or above `CASH_RATE_DECISIONS_MIN_ROWS` (350).
2. **Read the target back** from `rba-data-service`: **4.35%**.
3. **Read the effective date back**: **12 August 2026** — *not* 6 May 2026, which is the
   last-changed date and is the error this correction removed.
4. **Read trusted ABS back** for a known postcode (`abs-data-service`, POA 3338), and
   confirm the payload stamps `ABS Census 2021 (POA 3338)`.
5. **Create one new Investment Report** for a property with a trusted coordinate — a
   FIRST generation, not a regeneration, because that is the path this phase changed.
6. **Inspect `market_fact_snapshot`** on that row: individual valued facts present, each
   with source, dataset, grain, geography id, reference period, as-of and ruling; and
   `geography.source === 'pre_generation'`.
7. **Inspect the final prompt payload** in the function logs.
8. **Verify the disowned Location fields are absent** — no `walkScore`, no
   `transport.qualityScore`, no `commute`, no `schools.schoolsWithin3km`, and no
   livability conclusion derived from them.
9. **Verify no hardcoded or LLM-sourced RBA input** reached the macro block: the
   cash-rate rows must cite `FIRMMCRTD` / the decision history, never a model.
10. **Verify no raw `null`, `undefined` or `XX`** reaches the prose.
11. **Verify the template projection still receives the same report facts** — render the
    same report through its selected template and confirm the figures match the
    snapshot.

Also confirm, on the same run, that `report_geography` now has a row for that report
(it never has had one — §3), and that `method` reads `asgs_point_in_polygon`.

## 10. Carry-forwards — named, not taken

1. **The investment score still reads the disowned Location fields.** Deliberate: the
   gate runs after scoring so this phase cannot move scores. Belongs to the scoring
   programme's forward-only closeout.
2. **`|| 'XX'` placeholders remain on investment-score rows** in the prompt
   (`totalScore`, the five breakdown scores). Pre-existing, outside this phase's fact
   set, and untouched rather than quietly fixed.
3. **F1 is not yet loaded in production.** Code complete and verified against the
   published file; the load runs after deployment. Fails closed until then.
4. **Visibility policy and chart-null policy are still not the Viewer/PDF authority.**
   RF-7.2C.
5. **No delivery gate exists** (§6a). A market-claim fault makes a report non-clean and
   high-severity on the QA page; nothing stops it being downloaded or shared, because
   nothing ever did. Carried to the next operational control, before broad client
   rollout. Documented rather than silently added.
6. **Snapshot coverage is ABS / SEIFA / RBA, and that is COMPLETE for this phase.**
   Crime, climate, planning and regional trends are **not yet covered** — each reaches
   the prompt through its own block carrying its own provenance, and extending "narrated
   implies snapshotted" to them is a data-integrity coverage stage of its own rather
   than a widening of this PR. Declared in `rf72b1SnapshotCoverage.spec.ts` rather than
   omitted, so the gap is a named constant instead of a silence.
