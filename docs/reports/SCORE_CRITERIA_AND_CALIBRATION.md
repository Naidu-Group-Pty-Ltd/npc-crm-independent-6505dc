# What a score means, before any anchor moves

**S5/S6 §6.** The instruction's first requirement, in its own order: *"Define
what weak, adequate, good, strong and exceptional look like for each dimension
before choosing anchors."* This document is that definition, plus a reading of
the anchors that ship today against it, plus the specific external benchmark
each disputed anchor needs before it may be moved.

Prepared 18 September 2026. **No anchor is changed by this document.** §6 also
says: *"If an anchor change cannot be justified, retain the existing mapping and
explain."*

---

## 1. The band vocabulary

Five bands, defined once, in investment terms rather than statistical ones.
They describe **the evidence about the property**, never a probability, a
return or a recommendation.

| band | range | what it asserts |
| --- | ---: | --- |
| **exceptional** | 90–100 | Among the strongest readings this measure produces anywhere in the country. Rare by construction; a scale on which many properties are exceptional is not measuring. |
| **strong** | 75–89 | Supportable fundamentals on this measure — materially better than the market's middle, on evidence that would survive scrutiny. |
| **good** | 60–74 | Better than the middle, without the margin that makes it a reason on its own. |
| **adequate** | 45–59 | The market's middle. Not a criticism: most properties are ordinary on most measures, and a scale that calls ordinary "poor" is as wrong as one that calls it "strong". |
| **weak** | 0–44 | Materially below the market's middle on this measure. |

**What 75–80 does NOT mean**, stated because it is the number a client will
read and the misreading is predictable: it is **not** a 75–80% probability of
anything, **not** a guaranteed or expected return, and **not** a statement that
the property suits this buyer. Suitability is a separate reading
(`financeSuitability`) and is deliberately outside the score.

Grade thresholds are unchanged and are not this programme's to move:
`[85 A+] [75 A] [65 B+] [55 B] [50 C+] [40 C] [30 D] [0 F]`.

## 2. Per dimension: the criterion, then what ships

For each dimension, what each band should mean **in the measure's own units**,
then the measurement the shipped anchors actually place at the 45 / 60 / 75 / 90
boundaries, then the verdict.

### 2.1 Growth (0.40) — five-year CAGR as the primary component

| band | criterion, in the measure's units |
| --- | --- |
| exceptional | ≥ 12% p.a. sustained over five years — a market that has re-rated |
| strong | 7–10% p.a. — materially ahead of long-run national dwelling growth |
| good | 5–7% p.a. — at or a little above the long-run rate |
| adequate | 3–5% p.a. — real growth, below the long-run rate |
| weak | < 2% p.a., or negative |

**What ships** (`LONG_TERM_ANCHORS`): 2% → 30, 4% → 48, 6% → 65, 8% → 79,
10% → 89, 13% → 96.

**Verdict: agrees, no change.** 8% p.a. → 79 sits in *strong*; 6% → 65 sits in
*good*; 4% → 48 sits in *adequate*. The slope discriminates across the range a
real series occupies. Nothing here compresses.

The two zero-centred components are also correct and are recorded so a later
reader does not mistake them for placeholders: `TRAJECTORY_ANCHORS` puts a
three-year rate equal to the five-year rate at 50, and `RELATIVE_ANCHORS` puts
performance equal to the wider market at 50. A property growing exactly in line
with its market **is** adequate on those measures, and 50 is the honest answer.

### 2.2 Location (0.25) — walkability, CBD access, schools

| band | criterion |
| --- | --- |
| exceptional | inner-ring amenity, under ~20 minutes to the employment centre, many schools in range |
| strong | genuinely walkable, a commute most buyers would accept, schools in range |
| good | services within walking distance, a workable commute |
| adequate | car-dependent but serviced, a long but real commute |
| weak | no walkable services, or no practical commute to any employment centre |

**What ships** — walkability (`WALK_ANCHORS`, weight 0.35): 80 → 42, 88 → 50,
93 → 60, 95 → 70, 99 → 90. CBD access (`COMMUTE_ANCHORS`, weight **0.40**):
20 min → 88, 30 → 74, 45 → 53, 60 → 35, 110 → 0. Schools (`SCHOOL_ANCHORS`,
weight 0.25): 3 → 58, 5 → 78, 8 → 93.

**Verdict: two disputes, both recorded in `SCORE_COMPRESSION_INVESTIGATION.md`.**

- **Walkability is anchored on the platform's own corpus median (94.5), by its
  own header.** A published walk score of 95 — the top of the practical range —
  earns 70, which is *good*, not *strong*. That is the §3.5 rule violation and
  it needs an external distribution of Australian walk scores before it moves.
- **CBD access is a metropolitan framing carried at the largest weight.** The
  criterion above deliberately says *"employment centre"*, not *"capital-city
  CBD"*, because that is the question the measure is trying to answer. A
  regional property with a 90-minute drive to a capital it has no relationship
  with is not *weak* on location; it is being measured against the wrong centre.
  Schools and walkability read correctly.

### 2.3 Yield (0.15) — gross rental yield on the purchase price

| band | criterion |
| --- | --- |
| exceptional | ≥ 7.5% gross — a yield play, usually with its own risks |
| strong | 5.5–6.5% |
| good | 4.5–5.5% |
| adequate | 3.5–4.5% |
| weak | < 3% — the property is being bought for something other than income |

**What ships** (`GROSS_YIELD_ANCHORS`): 3.5% → 33, 4.36% → 50, 5% → 62,
5.5% → 72, 6.5% → 87, 7.5% → 95.

**Verdict: the slope agrees; the CENTRE is disputed.** 6.5% → 87 and 5.5% → 72
sit close to the criterion. But the 50-point is placed at **the platform's own
corpus median of 4.36%**, by the module's own header — the §3.5 violation. If
the market's median gross yield is materially below 4.36%, every ordinary
property is scored as below-average on Yield by construction. The curve does not
need reshaping; the question is only where its centre belongs, and that needs an
external benchmark.

### 2.4 Demand (0.15) — vacancy, days on market, discount, clearance, absorption, population

| band | criterion (vacancy / days on market) |
| --- | --- |
| exceptional | vacancy ≤ 1% / selling inside ~15 days |
| strong | vacancy 1–1.5% / ~20–25 days |
| good | vacancy 1.5–2.5% / ~30 days |
| adequate | vacancy 2.5–3.5% / ~40–45 days |
| weak | vacancy > 5% / > 90 days |

**What ships**: vacancy 1% → 90, 2% → 68, 3% → 50, 5% → 20. Days on market
20 → 88, 30 → 70, 45 → 52, 90 → 20. Clearance 60% → 50, 70% → 70. Population
1.5% → 55, 2.5% → 75.

**Verdict: agrees, no change — and it is the dimension that already does this
correctly.** Every one of these anchors cites an **external** reference in its
own comment: *"Australian medians typically sit near 30-35 days"*, *"60% is the
conventional balanced line"*, *"The national rate is ~1.5%"*. That is exactly
what §6 asks for, and it is why Demand is not in dispute while Yield and
walkability are.

### 2.5 Property Risk (0.05) — not scoreable in this deployment

No criterion table, because no reading is produced. `riskModelD` requires
observations spanning at least two independent categories; an established
house's schema offers two, one of them is `building`, and nothing in this
deployment can answer a building question. Site hazard and planning constraints
are now retrieved at parcel grain and read `held_but_unscoreable` — evidence on
the page, zero points — because what is outstanding is a published **scale**,
not the evidence.

**Verdict: no calibration possible or appropriate.** Risk is disclosed as
unassessed and its 0.05 renormalises across the other four. Under the
publication policy that is a four-of-five qualified assessment covering 95% of
the matrix, which is an honest description of what was done.

## 3. The two anchor changes this work considered

> **Concluded 18 September 2026 — see §5.** This section states what a change
> would have needed; §5 records the benchmark that was sourced, the decision it
> supports, and what would reopen it. Nothing here is left pending.

### 3.1 What a change needs first


| anchor | current | what a change needs first |
| --- | --- | --- |
| `GROSS_YIELD_ANCHORS` 50-point | 4.36% (the platform's corpus median) | A published Australian gross rental yield distribution, with its **geography** (national / capital-city / regional), **dwelling type** (house vs unit — they differ by more than a point), **period**, and its own sample limitations. The anchor moves to that distribution's median, and the rest of the curve re-fits around it without changing shape. |
| `WALK_ANCHORS` mid-range | corpus median 94.5 near the output middle | A published distribution of Australian walk scores for residential addresses, same four qualifications. If the published scale genuinely saturates nationally — not only in this book — the current stretch is defensible and stays. |

Both are held because §6 forbids the shortcut: *"the platform's own sample
median must not define 'average' or 'strong'"*, and a benchmark invented to
close the argument would be that same defect wearing a citation.

**And the ordering matters more than either.** `SCORE_COMPRESSION_INVESTIGATION.md`
§4 establishes that the dominant cause of the clustering is Growth never
arriving, which turns a 0.25-weight dimension into 56% of the answer. A
calibration fitted while that is true would be fitting the absence of Growth
into the anchors — the worst outcome available here, because it would look like
it worked and would then be wrong for every report that has Growth.

So: **the data defect is corrected and re-measured first, the benchmarks are
sourced second, and the anchors move third or not at all.** §5 is that second
step, carried out.

## 4. What is explicitly not proposed

Per §6, none of the following is offered, considered, or implemented anywhere
in this programme: a blanket multiplier, an automatic bonus of any size, a
minimum score floor, an arbitrary curve, a target proportion of A grades, or a
second scoring pass applied after the weighted result. Calibration here means
moving a measurement-to-score mapping in one place — the anchor tables —
against a benchmark that is named, and nothing else.

Dimension weights and component weights stay fixed throughout any comparison,
so that a measured difference is attributable to the anchor and not to the
weighting.

---

## 5. The conclusion (18 September 2026)

S5/S6 §4: *"Conclude the calibration work with supported, versioned changes or
a documented decision to retain existing anchors. Do not leave it indefinitely
pending or force scores into a preferred range."*

**Decision: both anchors are RETAINED, and the retention is now supported by a
measurement rather than by a deferral.**

### 5.1 The benchmark that was sourced

§3 said a change needs *"a published Australian gross rental yield
distribution, with its geography, dwelling type, period, and its own sample
limitations."* One exists and is reachable at zero cost, and it was measured on
18 September 2026.

The **NSW Department of Communities and Justice Rent and Sales Report**
publishes median weekly rents and median sale prices for the same postcodes, in
two quarterly workbooks, open-licensed. Pairing them gives a gross-yield
distribution over **398 NSW postcodes** — not a platform sample, a market one.
Every row is in
[`evidence/nsw-dcj-gross-yield-distribution-2026Q2.json`](./evidence/nsw-dcj-gross-yield-distribution-2026Q2.json),
with the workbook, the period and the exclusions recorded beside it.

| | p10 | p25 | **median** | p75 | p90 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **NSW postcodes, all dwellings** | 2.34% | 2.85% | **3.41%** | 4.01% | 4.64% |
| the platform's corpus (the current anchor's basis) | — | — | **4.36%** | 5.49% | — |

Four limitations travel with it, and each is why it is a benchmark rather than
the answer:

- **One state.** New South Wales, not Australia.
- **All dwellings, because the publisher gives no crosswalk.** The rent
  workbook's vocabulary is House / Flat-Unit / Townhouse; the sales workbook's
  is Strata / Non Strata. Pairing *House* with *Non Strata* would be an
  invention, and inventing a crosswalk between two vocabularies a publisher did
  not cross is the error `CRIME_SOURCES.md` records for SAPOL's 2025
  reclassification. So the distribution is computed on `Total ÷ Total`, the one
  pairing DCJ itself defines on both sides.
- **Two periods.** Rents are April–June 2026; sales are January–March 2026. The
  publisher issues them on different cycles.
- **New lettings, not the stock.** DCJ's rent series is median rent for **new
  bonds lodged**, which runs above in-place rent.

### 5.2 Why the measurement supports retaining rather than moving

The published median sits **0.95 points below** the corpus median the anchor is
set at. That is a large gap and it is the reason NOT to move, for two
independent reasons.

**A single-state median is not a national anchor.** The platform reports on
properties in every state; this benchmark describes one. Substituting it would
move every non-NSW property's yield score on evidence about New South Wales,
which is the same defect as calibrating to a corpus — a sample standing in for
a population — with a citation attached. §6's rule is that *the platform's own
sample median must not define "average"*, and a state median is a different
sample, not a population.

**The two figures are not measuring the same thing.** The corpus is the
properties this platform has been **asked to report on** — selected investment
stock, which is why a third of it sits at or above 5%. The DCJ figure is the
market, including every owner-occupied postcode nobody would buy as an
investment. A gap in that direction is what you would expect if both numbers
are right, and closing it by decree would not be calibration.

Moving the anchor down to 3.41% would raise the yield score of every property
in the book. Moving it in either direction to make grades look better is
exactly what §4 forbids, and there is no evidence here for the direction, only
for the fact that two different populations have two different medians.

### 5.3 `WALK_ANCHORS` — retained, and the reason is simpler

§3 asks for *"a published distribution of Australian walk scores for
residential addresses"*. No such distribution is published by anyone reachable
at zero cost: the scale is a vendor's own, the vendor publishes no national
distribution, and nothing in the open-data inventory
(`ME-6-Z3`) carries one. **There is no benchmark to move to**, so the anchor
stays where it is and the reason is stated rather than deferred.

### 5.4 What would reopen this

Two things, and both are acquisitions rather than opinions:

1. **A second state's published rent-and-price pair**, so the benchmark stops
   being one state. Queensland is the obvious candidate — QGSO already loads
   into `market_sales_medians` — but a matching published median-rent series at
   the same grain was not found on `data.qld.gov.au` on 18 Sep 2026.
2. **Growth arriving**, per §3's ordering. `SCORE_COMPRESSION_INVESTIGATION.md`
   §4 establishes that the dominant cause of clustering is Growth's absence
   turning a 0.25-weight dimension into 56% of the answer, and any anchor
   fitted while that holds is fitting an absence.

Until one of those lands, the anchors are what they are, the basis is stated in
the module's own header, and the benchmark that disagrees with it is on file
with its limitations — which is a conclusion, not a pending item.
