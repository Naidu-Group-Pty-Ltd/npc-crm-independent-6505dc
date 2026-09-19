# Why the scores cluster near 60

**S5/S6 §5.** Eight hypotheses, each tested rather than assumed, against real
production records and by executing the scorers. Prepared 18 September 2026 on
`claude/adoring-hopper-g02tdt`.

The instruction that shapes this document: *"Treat these as hypotheses to test.
Do not assume every existing penalty or conservative benchmark is a defect.
Correct implementation and data defects first. Measure their effect separately
from any subsequent calibration change."* So each hypothesis below carries a
verdict, and the verdicts are not all "defect" — three are, one is a defect
already fixed, and four are the method working as intended.

---

## 1. What was actually observed

Seven production report rows are held as verification fixtures. Their stored
`investment_score` records read:

| property | score | grade | dimensions scored |
| --- | ---: | --- | ---: |
| 1/27D Mitchell Street (×4 — one property, four report rows) | **62** | B | 3 of 5 |
| 23 MACKAY Street, Moranbah QLD 4744 | **58** | B | 3 of 5 |
| 48 Redfern Street, Cowra NSW 2794 | withheld | — | 1 of 5 |

Two distinct properties, two scores, both in the high 50s / low 60s, both on
three dimensions. (The Mitchell Street repeat is the fork/regeneration pattern
§6 warns about — deduplicating by property gives **two** observations, not
five, and any calibration set has to group them the same way.)

That is a small sample and it is not presented as a distribution. What makes it
diagnostic is that **the mechanism producing both numbers is derivable, and the
derivation reproduces them to the point**.

## 1a. CORRECTION, 18 September 2026 — there are TWO cohorts, not one

*Raised by the platform owner and confirmed by execution against the stored
records. The correction matters because the original §3.1 generalised one
cohort's shape to the whole corpus, and the two cohorts fail in opposite
directions.*

**"Growth is unmeasured on every record" is false.** Growth is measured, and is
the DOMINANT weight, on the two S5 subjects:

| record | measured | excluded | weight covered | growth | composite |
| --- | --- | --- | ---: | ---: | ---: |
| **18 Annabelle Cr, Kellyville NSW** | growth · yield · demand | location · risk | 0.70 | **56** | 39.71 → **40** (F) |
| **262 Pallas St, Maryborough QLD** | growth · yield · demand | location · risk | 0.70 | **77** | 62.86 → **63** (C) |
| 48 Redfern St, Cowra NSW | yield only | the other four | 0.15 | — | withheld |
| 1/27D Mitchell St, Muswellbrook NSW | location · yield · risk | growth · demand | 0.45 | — | 62.22 → **62** |
| 23 MACKAY St, Moranbah QLD | location · yield · risk | growth · demand | 0.45 | — | 57.56 → **58** |

Every composite above is reproduced to the point from the record's own stored
component scores, so the two patterns are established rather than inferred:

| pattern | records | weight covered | the dimension that dominates |
| --- | --- | ---: | --- |
| **A** | Annabelle, Pallas | 0.70 | **Growth at 57.1%** (0.40 ÷ 0.70) |
| **B** | Mitchell St, Moranbah | 0.45 | **Location at 55.6%** (0.25 ÷ 0.45) |

Three consequences, each correcting something stated below:

1. **The 55.6% takes BOTH absences.** Location reaches 0.5556 only because
   Growth *and* Demand are excluded (0.25 ÷ 0.45). With Growth alone absent the
   remaining weight is 0.60 and Location is **41.7%**. Any sentence attributing
   the 55.6% to Growth's absence on its own is wrong.
2. **The corpus is not clustered at 60.** Deduplicated by property, the four
   graded records are **40, 58, 62, 63** — a 23-point spread. The clustering is
   real *within pattern B* and is not a property of the corpus.
3. **Growth evidence does arrive for some properties**, so the operational
   question in §3.1 is not "is the register populated" but "for which
   geographies". Both cohorts span NSW and QLD, so **state alone does not
   explain the split** — §3.1a states the query that would.

**Pattern A's Location exclusion is a defect already diagnosed and closed.**
`S5_CORRECTIONS.md` §3a records it: the Client-Safe Gate strips `walkScore`,
`commute` and `schools.schoolsWithin3km`, the generator persisted the gated
object while the acquisition stamp survived untouched, and `assessEnrichmentReuse`
re-served the stripped copy on every resume. Both halves are closed and **the
repair reaches a row only on its next generation** — so Annabelle and Pallas are
the *pre-repair* cohort for Location, and their 3-of-5 is expected to become
4-of-5 when §10 regenerates them. That is a prediction this release can be
measured against.

## 2. The dominant mechanism in pattern B, derived and then checked

*This section describes **pattern B** — Mitchell Street and Moranbah. §1a above
records why it is not the whole corpus.*

With Growth and Demand unmeasured, the surviving nominal weights are Location
0.25, Yield 0.15 and Risk 0.05, summing to 0.45. Renormalised:

| dimension | nominal | effective when growth + demand are absent |
| --- | ---: | ---: |
| location | 0.25 | **0.5556** |
| yield | 0.15 | 0.3333 |
| risk | 0.05 | 0.1111 |

**A dimension worth a quarter of the matrix becomes 56% of the answer.** And
Location is centred by construction — §3.2 below measures its median at 52
across 224 realistic input combinations, with 62.5% of them landing between 40
and 70.

Put the two together and the composite is pinned:

```
0.5556 × (a Location centred near 52)
  + 0.3333 × Yield
  + 0.1111 × Risk
```

Checked against the two real records, using their own stored component scores:

| property | location | yield | risk | derived | stored |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mitchell Street | 58 | 65 | 75 | 62.2 → **62** | **62** |
| Moranbah | 39 | 80 | 83 | 57.6 → **58** | **58** |

Both to the point. Moranbah is the instructive one: an **exceptional** yield of
6%+ and a strong risk reading still produce 58, because Location at 39 carries
56% of the weight.

The same arithmetic over the measured Location grid gives p25 **47**, median
**54**, p75 **61** — a 14-point interquartile range for the entire spread of
realistic Australian properties. That is the compression, and it is structural
rather than a matter of where any single anchor sits.

## 3. The eight hypotheses

### 3.1 Lost or mis-mapped evidence — **CONFIRMED, and it is the largest single cause**

Growth carries 0.40 of the matrix and is **unmeasured on the three pattern-B
records and measured on the two pattern-A ones** (§1a). Where it is absent that
is not a calibration problem; it is the input not arriving for that property.

The code path is correct and wired: `generate-investment-report` reads
`market_sales_medians` through `readSalesRegister` for the trusted geography's
LGA, postcode, suburb or state, and reports its own failure precisely —
*"the register holds no rows for &lt;grain&gt; &lt;area&gt; (load it with
market-sales-ingest)"*. Pattern A proves the path delivers: Growth 56 and 77
are real readings, so the register is populated for **some** geographies.

### 3.1a ANSWERED 18 September 2026 — the register is populated; the split is by EVIDENCE PATH

*The platform owner authorised the database checks and was right that "both
cohorts span NSW and QLD" disproves a state split without establishing
geography grain. It does not: **the geography-grain hypothesis this section
previously carried is wrong**, and production's own function logs say why.*

`execute_sql` is not exposed on this session's Supabase connector, but
`query_logs` is, and the generator logs the register's answer per call. Read
from project `dduzbchuswwbefdunfct` (NPC Property Dashboard), `function_logs`:

**Pattern A — 17 September 2026. The register answers, in both states:**

```
✓ Open-data sales register (nsw_dcj_rent_sales) for postcode 2155:
    10 evidence points to 2026-03          ← Kellyville — 18 Annabelle Crescent
✓ Open-data sales register (qld_qgso_rlda) for lga Fraser Coast (R):
    11 evidence points to 2026-03          ← Maryborough — 262 Pallas Street
```

Two publishers, two different grains (postcode and LGA), the same current
period. **`market_sales_medians` is populated and delivering.** The question
the original §3.1 left open — *has `market-sales-ingest` populated the
register?* — is answered **yes**.

**Pattern B — 11 September 2026. The register was never asked:**

```
Fetching Domain data for: cowra, NSW, 2794
Domain API request URL: …/v1/suburbPerformanceStatistics/NSW/cowra?…
⚠️ Domain API: Suburb not found (404) - cowra, NSW
Error details: { "status": 404, "suburb": "cowra", "lastSuccess": "Never" }
```

…and the same for `muswellbrook, NSW 2333`. **No `Open-data sales register`
line appears anywhere in that run — neither a success nor a "holds no rows".**
Growth was sought from Domain alone, Domain answered 404 with
`lastSuccess: "Never"`, and there was no open-data fallback to fall back to.

| | pattern B | pattern A |
| --- | --- | --- |
| generated | 11 Sep 2026 | 17 Sep 2026 |
| growth evidence path | Domain only | open-data register (Domain is now the tail) |
| register consulted? | **no call at all** | yes, answered |
| outcome | growth unmeasured | growth **56** / **77** |

**So the cause is the evidence path and the generation date, not the
geography.** `OPEN_DATA_GROWTH_EVIDENCE.md` records the register being
measured and wired on 15 September — between the two cohorts. Pattern B
predates it.

Three consequences:

1. **No ingest work is outstanding.** The register holds current series for
   both states at two grains. Nothing in the calibration work is blocked on
   loading data.
2. **Regenerating a pattern-B property today should give it Growth**, because
   the path that failed for it no longer exists in that form. Combined with
   §1a's Client-Safe Gate prediction for Location, both cohorts should reach
   4-of-5 or 5-of-5 on regeneration. **§10 is what tests both**, and they are
   stated here in advance so the run can confirm or refute them.
3. **The compression measured below is a property of the pattern-B evidence
   path, not of the scoring method.** Calibrating anchors against it would fit
   the anchors to a superseded acquisition path.

**Access standing, stated precisely.** The Supabase connector authenticates
and reaches the intended project: `list_projects`, `get_project` and
`query_logs` all succeed. `execute_sql` **is not exposed** in this session's
toolset — not an authentication failure, not a permission denial, not a query
or schema error; the tool is simply absent from the connector's surface, so
`select` against `market_sales_medians` itself cannot be run here. It was not
routed around: the Lovable `query_database` tool is present and was
deliberately not used. The row-level coverage table in the queries below
therefore remains unrun, and **the finding above does not depend on it** —
production's own logs answered the question that mattered. The smallest
remaining action is to expose the Supabase `execute_sql` tool (the connector's
database group) if a row-level breakdown is still wanted.

### 3.1b The prepared statements, for when `execute_sql` is exposed

```sql
-- Coverage of the growth register, by publisher, state, grain and currency.
select   source, state, area_grain, dwelling_type,
         count(*)                        as rows,
         count(distinct area_code)       as areas,
         min(period_start)               as earliest,
         max(period_end)                 as latest,
         count(*) filter (where median_price is null) as suppressed
from     market_sales_medians
group by source, state, area_grain, dwelling_type
order by state, area_grain, source;

-- The five subjects' own areas.
select   area_grain, area_code, area_name, state, dwelling_type,
         count(*) as periods, min(period_start), max(period_end)
from     market_sales_medians
where    lower(area_name) in
         ('the hills shire','fraser coast','cowra','muswellbrook','isaac')
group by area_grain, area_code, area_name, state, dwelling_type
order by area_name;
```

### 3.2 Wrong units, periods, geographies or direction — **PARTLY CONFIRMED (geography)**

No unit or direction error was found. Growth anchors are in per cent per annum
and read the right way; yield is per cent gross; commute is minutes; schools a
count. Direction is correct throughout (higher growth scores higher, longer
commute scores lower).

The **geography** half is a real finding. `COMMUTE_ANCHORS` measures minutes to
the capital-city CBD, carries `cbdAccess: 0.40` — the largest of Location's
three weights — and reaches 0 at 110 minutes. Measured, holding everything else
fixed:

```
same property, walk 72, 6 schools within 3 km
  commute  25 min  -> location 66   (cbdAccess 81)
  commute 150 min  -> location 33   (cbdAccess  0)
```

A 33-point swing on one input. Because Location is 56% of the composite when
Growth is absent, **cbdAccess alone is 22% of the entire investment score**,
and it is measured against a geography that describes a metropolitan commuter
property. A regional or mining-town investment is not a failed metropolitan one
— it is a different market with a different thesis — and scoring it against the
distance to a capital city it has no relationship with is the cross-market
comparison §3.7 asks about, landed inside Location.

This is a genuine finding and it is **not** a licence to soften the anchor: the
correct treatment is for the commute component to be measured against the
relevant employment centre, or to carry less weight where no metropolitan
relationship exists, and either is a calibration question for §6 with a
benchmark behind it — not a number to move here.

### 3.3 Defaults or unintended deductions — **CONFIRMED IN V1, ALREADY FIXED IN V2**

The stored V1 records carry `growthScore: 50` and `demandScore: 50` with
`hasData: false, excluded: true`. A **placeholder 50 for a dimension nobody
measured**, sitting on the record beside the real ones. In those rows it
carries `weight: 0` so it did not reach the composite — but it is on the record,
and any reader that averages the breakdown is pulled to the middle by it.

V2 does not do this: an unmeasured dimension scores `null`, carries effective
weight 0, and is named in `unavailable`. `scoringScenarios.spec.ts` and the new
`scorePublicationPolicy.spec.ts` both pin it. **No change needed; recorded
because the stored corpus still contains these 50s and any backtest reading
historical rows must not treat them as measurements.**

### 3.4 Double-penalising one weakness — **CONFIRMED IN V1, ALREADY FIXED IN V2**

The Mitchell Street record's risk detail reads *"Moderate LVR (70-80%). High
negative cash flow ($200-300/week)"*. Both are facts about **the buyer's
financing decision**, not the property, and both were deductions against
Property Risk — one financing choice counted twice, against a dimension it does
not belong to.

V2 separates them structurally: `financeSuitability` and `holdingCashFlow` sit
beside the score rather than inside it, and `scoringV2Production.spec.ts`
asserts by execution that changing LVR from 60 to 95 and weekly cash flow from
+120 to −900 leaves the grade, the total and the whole breakdown identical.
**No change needed.**

### 3.5 Benchmarks from a selected sample treated as market-representative — **CONFIRMED, twice, in the code's own words**

§6 states the rule: *"the platform's own sample median must not define 'average'
or 'strong'."* Two anchor sets are calibrated on exactly that.

**Yield.** `GROSS_YIELD_ANCHORS`' own header: *"Calibrated to the corpus rather
than to intuition: the measured median gross yield across the stored reports is
**4.36%**, p75 **5.49%**"* — and the 50-point anchor is placed at 4.36%.

**Location walkability.** `WALK_ANCHORS`' own header: *"The anchors put the
corpus median (94.5) near the middle of the OUTPUT range."*

In both cases the reasoning given is sound on its own terms — an input scale
that puts two thirds of a corpus in one band carries no information, and
stretching the anchors where the data lives is the right instinct. What is
wrong is **which** distribution was used. NPC's stored reports are not a sample
of the Australian residential market; they are the properties NPC was asked to
write about, which is a selected book weighted toward the stock this business
sources. Anchoring the middle of the output scale to the middle of that book
**forces the typical NPC property to score 50 by construction**, whatever it is
actually like — which is a compression mechanism in the most literal sense.

Measured, the Yield anchors discriminate perfectly well *once you accept where
the centre sits*: 2.84% → 21, 4.36% → 50, 6.07% → 81, 8.67% → 99. The curve is
fine. **The question is only whether 4.36% is the market's middle or this
book's middle**, and that is answerable only against an external published
benchmark. §6 requires the benchmark to carry its geography, dwelling type,
period and sample limitations, so **no anchor moves here** — sourcing that
benchmark is the first task of the calibration work, and the same applies to
the walk-score distribution.

### 3.6 Anchors requiring exceptional outcomes — **NOT CONFIRMED for Growth and Yield; CONFIRMED for walkability**

Growth's `LONG_TERM_ANCHORS` read 6% p.a. → 65 and 8% p.a. → 79. Against
long-run Australian dwelling price growth those are reasonable, arguably
generous, and certainly not a scale that demands exceptional outcomes for a
middling score. Yield, as measured above, reaches 81 at 6.07% and 99 at 8.67%.
Neither is compressed.

Walkability is different: a published walk score of **95 — the top of the
practical range — scores 70**, and 88 scores 50. That is the §3.5 anchoring
expressed as a ceiling, and it is the same finding rather than a second one.

Two anchor sets place a perfectly ordinary reading at exactly 50 —
`TRAJECTORY_ANCHORS` (three-year rate equal to five-year rate → 50) and
`RELATIVE_ANCHORS` (matching the wider market → 50). Those are **correct**: a
property growing exactly in line with its market genuinely is average on that
measure, and 50 is the honest answer. Recorded so a later reader does not
mistake them for placeholders.

### 3.7 Inappropriate cross-type, cross-market or cross-method comparison — **CONFIRMED (same finding as §3.2)**

The commute-to-capital-CBD component is the instance, and it is described
there rather than twice. No cross-dwelling-type defect was found: the evidence
contract carries `dwellingType` and `dwellingTypeMatched`, growth confidence
discounts an unmatched type, and the sales register's grain is priced
explicitly (an LGA point scores 55 on the geography factor, a postcode 80, a
suburb 100).

### 3.8 A genuine fundamentals-versus-suitability distinction — **CONFIRMED, and already implemented**

Some of what looked like harshness is the product correctly declining to score
the buyer's position into the property. `financeSuitability` (leverage, serviceability)
and `holdingCashFlow` are separate readings beside the composite. This is the
distinction the hypothesis names, it is real, and it is why the V1 records'
risk scores read high while their verdicts read cautious. **No change.**

---

## 4. What follows, in order

The instruction is explicit that implementation and data defects are corrected
first and measured separately from calibration. That ordering is not a formality
here — it changes what the calibration work is even looking at.

1. **Establish whether `market_sales_medians` is populated for the states in
   the corpus** (§3.1). This is a production read, not a code change. If it is
   empty or stale, loading it is the single largest correction available and
   every measurement below has to be retaken afterwards, because a
   three-dimension shape and a five-dimension shape are different scales.
2. **Then, and only then, measure the distribution again.** A calibration
   fitted to the three-dimension shape would be fitting the absence of Growth.
3. **Source external benchmarks** for gross yield and for the walk-score
   distribution (§3.5), with geography, dwelling type, period and sample
   limitations recorded. Until those exist, the anchors stay where they are and
   this document says why — which is §6's own instruction: *"If an anchor change
   cannot be justified, retain the existing mapping and explain."*
4. **Treat the commute component as a calibration question** (§3.2), framed as
   "which employment centre, and how much weight where none is relevant" rather
   than "make the penalty smaller".

Nothing in §3.3, §3.4, §3.6's trajectory/relative anchors or §3.8 needs a
change. Recording that is part of the finding: **four of the eight hypotheses
describe the method working**, and treating every conservative reading as a
defect is how a calibration becomes a thumb on the scale.

## 5. What this document does not claim

- **It is not a distribution.** Seven fixture rows, two distinct properties. The
  mechanism is derived and checked against them; the prevalence is not measured
  and needs the production corpus.
- **No anchor was moved.** Every number above is a reading of the code as it
  ships.
- **The external benchmarks are not asserted.** §3.5 establishes that the
  current anchors rest on the platform's own sample and that this breaks the
  stated rule. It deliberately does not supply a replacement figure, because a
  benchmark invented to close an argument is the defect it is complaining about.
