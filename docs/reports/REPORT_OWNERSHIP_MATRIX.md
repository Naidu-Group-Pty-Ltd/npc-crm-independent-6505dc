# Which report owns what

**S5/S6 §9.** The ownership and binding matrix for all five reports, read out
of `sectionRegistry.pure.ts` by execution rather than transcribed, 18 September
2026.

Legend: **S** spine · **R** required · **M** merged into another section ·
**o** optional. Producer: **p** projection (bound by the template from
`reportBindingProjection`) · **a** authored (a model writes it) · **c**
composed (built from the record by a named module) · **r** routed (split out of
a parent document by the fork) · **!** none declared.

A **merged** placement has no producer by design — it is absorbed into the
section named after it, and that is where its producer lives. Only a non-merged
placement with no producer is a gap.

---

## 1. The matrix

```
SECTION                 compass    briefing   snapshot   financial  strategic
identity                S:p        S:p        S:p        S:p        S:p
keyFigures              S:p        S:p        S:p        S:p        S:p
verdict                 S:a        S:a        S:c        S:r        S:r
propertyIdentity        S:a        S:p        S:a        S:r        S:r
provenance              S:a        S:a        S:a        S:c        S:c
assumptions             M          M          -          R:r        -
locationCase            R:a        R:a        -          -          R:r
infrastructure          M          M          -          -          R:r
suburbCharacter         M          M          -          -          R:r
marketPosition          R:a        R:a        -          R:r        M
supplyPipeline          M          M          -          -          R:r
population              R:a        M          -          -          R:r
socioeconomic           M          M          -          -          R:r
employment              M          M          -          -          R:r
tenantDemand            M          M          -          R:r        R:r
amenityAccess           R:a        R:a        -          -          R:r
education               M          M          -          -          M
transport               R:a        M          -          -          R:r
propertyFit             R:a        R:a        -          -          R:r
dwelling                M          M          -          -          R:r
planning                R:a        M          -          -          R:!
riskDashboard           R:a        R:a        -          R:r        R:r
environmentalRisk       R:a        M          -          -          R:r
dueDiligenceChecklist   R:a        -          -          -          o:!
purchaseHolding         -          R:c        -          R:c        -
rentalYield             -          R:c        -          R:c        -
loan                    -          R:c        -          R:c        -
sensitivity             -          R:c        -          R:c        -
tenYear                 -          R:c        -          R:c        -
exitStrategy            R:c        -          -          R:c        -
scorecard               o:p        R:c        R:c        R:c        -
swot                    R:c        R:c        -          R:c        -
suitability             -          -          -          R:c        -
holdingStrategy         -          -          -          R:c        -
monitoring              R:c        -          -          -          R:c
opportunities           -          R:a        R:a        -          -
risks                   -          R:a        R:a        -          -
recommendation          R:a        R:a        R:a        R:r        o:!
marketStats             -          -          R:a        -          -
financialSnapshot       -          -          R:c        -          -
```

| tier | sections present | actually drawn | producers |
| --- | ---: | ---: | --- |
| compass | 29 | 20 | 3 projection, 14 authored, 3 composed, 9 merged |
| briefing | 33 | 20 | 3 projection, 10 authored, 7 composed, 13 merged |
| snapshot | 11 | 11 | 2 projection, 6 authored, 3 composed |
| financial | 20 | 20 | 2 projection, 7 routed, 11 composed |
| strategic | 25 | 23 | 2 projection, 16 routed, 2 composed, 3 merged, 2 optional-unproduced |

## 2. The financial split holds, and this is how you can see it

§9: *"Detailed financial modelling belongs in the Financial Analysis report."*
Read down the five modelling sections:

| section | compass | financial |
| --- | --- | --- |
| purchaseHolding | **absent** | R:composed |
| rentalYield | **absent** | R:composed |
| loan | **absent** | R:composed |
| sensitivity | **absent** | R:composed |
| tenYear | **absent** | R:composed |

And §9's qualification also holds: *"Retain the Compass's identity facts and the
gross-yield reference."* `keyFigures` is **S:projection on the Compass** —
price, rent, gross yield and the weekly position are spine facts on every tier.
What leaves the Compass is the analysis of a purchase, not the price.

The Briefing carries the modelling too (R:composed on all five), which is
correct: it is a condensation of the full picture rather than a tier with its
own purpose, and `condense-investment-report` composes those five from the same
canonical producers the Financial tier uses.

## 3. Shared quantities come from one producer

§9: *"Shared quantities must come from the same canonical producer."* The
composed sections above name theirs, and the load-bearing ones are single:

| quantity | one producer |
| --- | --- |
| loan schedule, interest-only term, debt service | `loanLedger.pure.ts` |
| gross yield, net yield, LVR | `propertyMetrics.pure.ts` |
| the rent every derived figure rests on | `rentalEvidence.pure.ts` |
| stamp duty | `_shared/stampDuty/` |
| the score, grade and qualification | `scorePublicationPolicy.pure.ts` + the engine |
| the annual cost components | `reportBindingProjection.pure.ts` |

## 4. The gaps, and which are declared

Only a **non-merged** placement with no producer is a gap. There are three, and
one is already declared:

| placement | state |
| --- | --- |
| `strategic:planning` (**required**) | **DECLARED** in `PRODUCER_GAPS`. Its reasoning is kept in the registry: a Due Diligence planning section also needs title and easements, which no register this platform reads can answer. The Compass's planning section is produced (`R:authored`) from the retrieved constraint register; the strategic tier's is a wider question. |
| `strategic:dueDiligenceChecklist` (optional) | undeclared. Optional, so nothing breaks when it is absent — but an optional section with no producer can never appear, which makes it a section that exists only in the registry. |
| `strategic:recommendation` (optional) | same shape. Note the Compass, Briefing, Snapshot and Financial tiers all produce a recommendation; only the strategic tier does not. |

Everything else with no producer is `merged`, which is correct by construction.

## 5. What §9 still asks for beyond this matrix

The matrix establishes that **the structure is sound and the split is real**.
It does not establish that the delivered documents are complete, and the
remaining §9 items are about content rather than ownership:

1. **Substantive coverage of the named sections** — named facilities, key
   findings, SWOT, investor suitability, holding considerations, exit
   considerations, monitoring. All are present in the registry and produced
   (§1 above); what is unverified is whether each renders with substance on a
   real property, which is what the §10 page-by-page read measures.
2. **Planning, zoning and the ten-year infrastructure outlook**, with
   attributable evidence distinguishing **proposal / approval / funding /
   commencement / completion**, unknown dates and funding left unknown, and
   project identity confirmed before any deduplication. The registers and the
   vocabulary for this already exist
   (`planningConstraints.pure.ts`, `infrastructureEvidence.pure.ts`,
   `planningControlGuide.pure.ts`, and §9 of
   `PLANNING_CONTROLS_IN_THE_REPORT.md` — *an absence may not be rated*).
3. **Navigation and educational explanation**, taking the legacy Lot 20427
   report as the reference for how a reader is walked through the document.
4. **A targeted template-update inventory**, preserving user-created templates
   and overrides.

Items 1 and 2 are measured by the ten-PDF read; items 3 and 4 are changes to
the production templates and the master page sequences. None of them changes
which report owns which section, which is what this matrix fixes.

---

## 6. The template-update inventory (§9)

§9 asks for a targeted inventory of template changes, preserving user-created
templates and overrides. **It is empty, and that is a design property rather
than an oversight.**

The publication policy changed what a client document *says* about a qualified
score. It reached every template — the 500 seeded masters, the 43 voice
templates and every template a user has created or overridden — **without one
of them being edited**, because the change happened inside values the
projection already publishes and the masters already bind:

| bound path | before | after |
| --- | --- | --- |
| `recommendation.gradedLine` | "Graded B at 62 out of 100, weighted across growth, yield and demand." | "…, weighted across growth, yield and demand **— 3 of the 5 assessment dimensions**." |
| `recommendation.gradedDetailLine` | the same sentence plus the assessment-page pointer | carries the qualifier too, from the same implementation |
| `coverage.partialLabel` (verdict section) | "Partial score: 3 of 5 dimensions" | "Qualified score — based on 3 of 5 assessed dimensions (70% of the scoring matrix by its original weights)" |
| `recommendation` (the verdict sentence) | "…across all metrics" on a 4-of-5 assessment | the breadth claim narrowed to "across the metrics assessed" |

No binding path was added, renamed or removed, so **a template that bound the
old value binds the new one**, and a user's own template or override cannot be
left behind by a change it never had to adopt. This is the same rule the
projection has answered to since RS-3: *the authority is in the projection,
because that is what every template binds*.

### One judgement worth surfacing

A historical report **re-rendered** now carries the qualification it did not
carry before. Nothing stored is rewritten — the score, the grade and every
figure are exactly as issued — and the qualifier is read from
`coverage.dimensionsScored`, which those records have always carried. The
alternative would be to suppress a *true* statement about a record's coverage
on older documents, which would mean a re-rendered report stating its grade
more confidently than its own evidence supports. That is the defect this
programme exists to remove, so the disclosure is applied on read.

**This is a change to disclosure, never to a result**, and it is recorded here
rather than left to be discovered.
