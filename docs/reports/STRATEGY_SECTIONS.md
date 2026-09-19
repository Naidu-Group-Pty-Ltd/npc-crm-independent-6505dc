# SWOT, suitability, holding, exit and monitoring — and which report owns each

*Module: [`_shared/reports/investment/strategyPositions.pure.ts`](../../supabase/functions/_shared/reports/investment/strategyPositions.pure.ts).
Spec: `src/lib/reports/__tests__/strategyPositions.spec.ts`.*

## 1. What was actually missing

Five pieces of content the brief calls for, each missing in a different way and
three of them looking present.

| | Declared | Producer | Reached a document? |
|---|---|---|---|
| SWOT | yes — `swot`, briefing + financial | `composeSwotSection`, four lists off `investment_score` | yes, and thin — see below |
| Investor suitability | yes — `suitability`, financial, **`optional`** | `routed('financial', 13)` | only if a model wrote prose under that heading |
| Resale liquidity & exit | yes — `exitStrategy`, financial, **`optional`** | `routed('financial', 10)` | same |
| Holding strategy | **no** | — | no |
| Monitoring & review | **no** | — | no |

`composeSwotSection` types `investment_score.{strengths, weaknesses,
opportunities, risks}`. Measured on the two subject properties, 18 Sep 2026,
that is — across **both** properties — two strengths, three weaknesses, two
opportunities and **zero** threats:

```
18 Annabelle Crescent   strengths   []
                        weaknesses  ["Below average rental yield may require owner contribution",
                                     "Measured demand in this market is soft"]
                        opportunities 1   risks 0
262 Pallas Street       strengths   ["Measured capital growth in this suburb is strong"]
                        weaknesses  ["Measured demand in this market is soft"]
                        opportunities 1   risks 0
```

Three bullets and an empty Threats heading. Meanwhile the record holds a great
deal that bears on all five and that none of them read: the market evidence
table (median, one-, three-, five- and ten-year growth, sales volume, each with
its publisher and period), the planning layer's answer with its own currency
date, the transport feeds' stop count *and the two things they explicitly do
not measure*, the financial engine's weekly position, the loan's structure and
whether its interest-only term was **assumed**, the score's gaps.

## 2. The seven rules

1. **No entry without a fact.** Every bullet is built from a value the record
   holds. No branch produces an entry from an absence, and none from a
   judgement.
2. **An absence is coverage, never a quadrant entry.** A register that was not
   read contributes nothing to Strengths and nothing to Threats; it is named in
   the section's own *What this rests on*. This is
   [`PLANNING_CONTROLS_IN_THE_REPORT.md`](./PLANNING_CONTROLS_IN_THE_REPORT.md)
   §9's rule on a second surface — *an absence may not be rated*, and "no flood
   overlay was returned" is not a strength.
3. **The modelling travels only where the tier carries it.** `finance` is null
   on the Compass and the Due Diligence report, and every entry that would
   state a yield, a weekly position, a lending ratio or an equity figure is
   then not produced — not softened, not described in words.
   [`TIER_FRAMEWORK.md`](./TIER_FRAMEWORK.md) Decision E.
4. **Suitability states a REQUIREMENT, never a person.** What the asset demands
   of whoever holds it is a fact about the asset. Whether an investor meets it
   is not in this record — no report here is given anybody's circumstances — so
   the section says what is required and says plainly that the match is not
   assessed. A test refuses "suits you", "ideal for", "we recommend", "you
   should", "right for" and "perfect for".
5. **Liquidity is measured; equity is modelled.** How many dwellings sold last
   quarter is published. What the equity is at year five is an output of the
   projection under a recorded rate. Different claims, labelled differently,
   and the second never appears where the modelling does not travel.
6. **Monitoring names the register, its cadence and the reading that would
   change the conclusion** — and never promises this platform will watch it.
7. **A threshold nobody published may not produce a rating.** Rule 2 with the
   absence taken out of it, and §4 records how it was learned.

## 3. Which report owns which

The rule is **one section, one owner**, applied so that no reader meets the
same list twice and no document carries a topic it cannot answer.

| Section | Compass | Financial | Due Diligence | Briefing | Snapshot |
|---|---|---|---|---|---|
| SWOT Analysis | **yes** — the location and market half | yes, with the modelling | — | yes (unchanged) | — |
| Resale Liquidity & Exit | **yes** — the measured half | yes, plus the modelled table | — | — | — |
| Investor Suitability | — | **yes** (was `optional`) | — | — | — |
| Holding Strategy | — | **yes** (new) | — | — | — |
| Monitoring & Review | **yes** (new) | — | **yes** (new) | — | — |

Why each:

- **SWOT on the Compass.** It is the flagship client document and a SWOT of the
  location and market is exactly its purpose. The modelling half is withheld by
  rule 3, so the Compass copy carries the growth, the zone, the transport and
  the price-against-median and says, in coverage, that yield and cash flow are
  the Financial report's.
- **Suitability and Holding Strategy on the Financial report only.** Both rest
  on the capital at settlement, the weekly contribution and the loan structure.
  That is the analysis of a purchase.
- **Exit on both.** The liquidity half — how many comparable dwellings settled,
  what the middle price is, how long the register's series runs — is a market
  fact the Compass may state. The year-five and year-ten values are modelling
  and stay financial.
- **Monitoring on the two evidence documents.** It is about the registers, not
  the money. The Financial report is not left without it: its Holding
  Strategy's *What would break it* names the rate, the rent and the growth
  rate, which are the financial things to watch — so the duty is discharged
  without a third copy of the table.
- **Nothing new on the Snapshot or the Briefing.** Both are condensations; a
  condensation that grows sections is not one.

## 4. Three findings that only a render produced

Each of these passed review by reading and failed on the first render against
production data. All three are now pinned by a test.

**A misspelled measure name returns null in silence.** The first version asked
the market table for `medianSalePrice`, `salesVolume`, `rentalVacancy` and
`auctionClearance`. The union is `medianPrice`, `salesCount`, `vacancyRate`,
`auctionClearanceRate`. Every lookup answered null on a record holding all of
them, so the SWOT drew no median, the suitability profile no liquidity
requirement and the monitoring table no sale-price row. This is
[`CASE_TENANT_COLUMN.md`](../aml/CASE_TENANT_COLUMN.md)'s rule in a different
schema, and the fix is the one that makes it impossible rather than forbidden:
`subjectRow`'s key parameter is typed `EvidenceKey`, so the compiler reads the
union.

**A threshold nobody published produced a verdict.** Sales volume was graded:
250 settled sales a quarter or more was "A liquid market", fewer was "A thin
market". 250 is a number invented in that file. Rendered against production it
put **"A thin market: few comparable sales settle in a quarter"** in a client's
Weaknesses column over **162 house sales in one quarter in one Sydney
postcode**. The count is now stated, in the exit section, and the reader grades
it. The same fault sat on the growth ladder — the latest year was an
*Opportunity* if it ran two points ahead of the three-year average and a
*Threat* if two behind, and 262 Pallas Street's gap was 1.7 — so both figures
are now stated side by side in the holding strategy with no rating word between
them.

**A hard-coded multiple left a hole in its own sentence.** The lending entry
read `At ${lvr} lending, a fall in value reaches equity ${lvr === '80%' ? 'five
times' : ''} faster…` — correct at 80% and, at every other ratio, a sentence
with a gap where its only number should be. The multiple is computed once now,
`100 / (100 - lvr)`, and the basis states the owner's share explicitly.

Two smaller ones from the same renders: a score-list entry was concatenated
with its basis without a full stop between them, and `distanceToStation` (a
kilometre value stored to one decimal) was multiplied out and printed as
"100 m" beside a stop the detail list places at 106 m — the record's own
precision is kept.

## 5. Wiring — and how it is kept

Two callers, one module.

- **`generate-investment-report`** composes the three Compass sections with
  `carriesModelling: false` and appends them to `report_content` **after** the
  post-processor, for the reason the two planning tables are appended there: a
  composed table asked back from a model comes back paraphrased, and a word cap
  must not be able to trim an entry that carries a source. The rules ride
  `pinnedPlanningContext`, because the model still writes the sections *around*
  them and a quadrant restated in the executive verdict with its provenance
  dropped is an unsourced claim.
- **`fork-investment-report`** composes the three Financial sections with
  `carriesModelling: true` and merges them at the split registry's own
  ordinals, alongside `composeFinancialChapters`. `Holding Strategy` is a new
  FIN section at ordinal 15 — inserted rather than appended, with only the two
  ordinals after it moved, because every `composed(N)` and
  `routed('financial', N)` in the section registry is that list's ordinal.

**The market evidence is now recorded on the row.** It was assembled on every
run, handed to the scoring service and to the prose, and persisted nowhere — so
the fork could not compose a suitability profile from the median and the growth
its parent had been shown, and no reader could reconcile a sentence against the
figures behind it. It is written to `data_sources.marketEvidence` in the shape
`buildMarketFacts` already reads, so both ends read it unchanged. A parent
written before this carries none, `buildMarketFacts` answers `evidenceMissing`,
and each composer produces the entries that do not need it.

**`strategyPositions.pure.ts` may name the market domain for its TYPES alone.**
`investmentSourceOfTruth.spec.ts`'s allow-list is an enumeration, not a
wildcard; the two market modules are named individually and a second test
asserts every import of them is `import type`, so the dependency is erased at
build time and no runtime edge is created between the two domains.

Three tests keep the whole of it honest. `sectionRegistry.spec.ts` **runs**
every composer a placement names, on both a record with the modelling and one
without, and fails a heading with fewer than three lines under it.
`strategyPositions.spec.ts` reads the generator's and the fork's source and
fails when either stops calling the module — `builderPortalUiMounted.spec.ts`'s
rule, because an unused export typechecks, lints and builds. And the same file
pins each of the seven rules against the shapes that broke them.

## 6. What is not closed

The sections have been **rendered against production data and read** — both
subject properties, on both tiers, from
`investment_reports` rows and `market_sales_medians` read on 18 Sep 2026. They
have **not** been produced by a live generation run: no report has yet been
generated with this code, so the interaction between the composed sections and
the model-authored prose around them is unverified, as is the page flow through
the template renderer. That is the same gate every other item in S5 waits on.
