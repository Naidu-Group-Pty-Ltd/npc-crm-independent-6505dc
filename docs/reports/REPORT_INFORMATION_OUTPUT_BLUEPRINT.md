# Report Information & Output Blueprint

**This is a business specification, not an implementation.** It defines what
every Aurixa report should contain, for whom, and from which source — so that
the Reporting engineering that follows implements a decided thing rather than
discovering it. Nothing here has been built.

**Baseline:** `main` @ `1695fab74` (11 Sep 2026), after the Scoring V2 freeze
(audit §68), the zero-cost accuracy closeout, the trusted-input integrity
closeout and the forward-only scoring policy (PR #2596).

**The constraint that shapes every page of this document:** the platform holds
far less trustworthy data than its reports currently present. Measured on the
live corpus of 1,006 scored reports — no suburb growth evidence, no demand
evidence, no property-risk evidence, no trusted location measurement, and a
verified purchase price and rent on 188. A blueprint written against idealised
data availability would be a wish list; this one is written against what the
database actually contains, and marks everything else honestly.

---

## B1. The report families

Fourteen, from the RF-7 Current-State Map. No new family is proposed — the
gaps found are missing *trust* and missing *consistency*, not missing reports.

| # | Family | Generator | Renderer | Volume |
| --- | --- | --- | --- | ---: |
| 1 | **Investment Property Report** (Primary) | `generate-investment-report` | WeasyPrint + legacy compiler | 1,182 rows, 5–18/wk |
| 2 | **Strategic Property Report** | tier/variant of the same row via `fork-investment-report` | same | subset of 1 |
| 3 | **Briefing / Snapshot** | `condense-investment-report` | same | subset of 1 |
| 4 | **Financial Modelling** | composed in-report (`financialChapters.pure.ts`) | with the parent | — |
| 5 | **10-Year Cash Flow** | `cashFlowProjection.pure.ts` | `render-cash-flow-pdf` | — |
| 6 | **Property Comparison** | `compare-investment-reports` + `format-comparison-report` | `render-property-comparison-pdf` | — |
| 7 | **Cash Flow Comparison** | `compare-cash-flow-reports` | `render-cash-flow-comparison-pdf` | preview-only |
| 8 | **Portfolio Review** | `generate-portfolio-analysis` | `render-portfolio-review-pdf` | — |
| 9 | **Borrowing Capacity** | `calculate-borrowing-capacity` | `render-borrowing-capacity-pdf` | — |
| 10 | **Commercial & Industrial Capacity** | `/calculators` assessment record | `render-commercial-capacity-pdf` | — |
| 11 | **Market Intelligence** | `generate-market-intelligence-report` | `render-market-intelligence-pdf` + scheduled email | — |
| 12 | **Quantitative listings report** | `quantitative-report-pipeline` | pdf-lib, in-function | — |
| 13 | **Report Q&A** | `report-qa` | `render-report-qa-pdf` | — |
| 14 | **Client Details Form** | record projection | `render-client-details-pdf` | — |

## B2. Purpose, audience, decision

| Family | Purpose | Audience | Decision it supports | Belongs here rather than elsewhere |
| --- | --- | --- | --- | --- |
| **1 Investment Property Report** | The full evidenced case for one property | Retail investor client | Should I buy this property? | The only place the complete property case lives |
| **2 Strategic Property Report** | The same property in the context of a stated strategy | Client with an existing plan | Does this fit my strategy? | Strategy framing only; facts belong to 1 |
| **3 Briefing / Snapshot** | The one-page version of 1 | Client scanning, or an adviser in a meeting | Is this worth reading in full? | Condensation only — never a second opinion |
| **4 Financial Modelling** | How the purchase is funded and what it costs to hold | Client + broker | Can I afford to hold this? | Chapters of 1, not a separate document |
| **5 10-Year Cash Flow** | The holding position over time | Client + accountant | What will this cost me each year? | Projection detail too long for 1 |
| **6 Property Comparison** | Two or more properties side by side | Client choosing between options | Which of these? | Comparison only; each property's case is 1 |
| **7 Cash Flow Comparison** | Holding positions side by side | Client choosing between options | Which is cheaper to hold? | Narrow cut of 6 |
| **8 Portfolio Review** | Performance of what is already owned | Existing multi-property client | Hold, sell or refinance? | Backward-looking; 1 is forward-looking |
| **9 Borrowing Capacity** | What this buyer can borrow | Client + broker | What is my budget? | Buyer-side, property-independent |
| **10 Commercial & Industrial Capacity** | Commercial asset analysis | Commercial client | Does this commercial deal work? | Different asset class, different methodology |
| **11 Market Intelligence** | What is happening in a market | Subscriber / prospect | Where should I look? | Area-level; no subject property |
| **12 Quantitative listings report** | Digest of marketplace listings | Internal / agency | What stock is available? | Inventory, not analysis |
| **13 Report Q&A** | Answers to a client's questions about a report | Client who has read 1 | Follow-up questions | Derived from 1's content |
| **14 Client Details Form** | Captured client particulars | Internal / compliance | Record-keeping | Not analysis at all |

**Duplication to remove eventually:** 2, 3 and 4 are all views of 1 and should
never recompute anything 1 established; 7 is a subset of 6; 13 reads 1.

## B3. Information requirements

`R` required · `O` optional · `—` not applicable.

| Information | 1 | 2 | 3 | 5 | 6 | 8 | 9 | 10 | 11 |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Address | R | R | R | R | R | R | — | R | — |
| Property type | R | R | R | O | R | R | — | R | — |
| Beds / baths / cars | R | O | O | — | R | O | — | — | — |
| Land / build size | R | O | — | — | O | — | — | R | — |
| Purchase price | R | R | R | R | R | R | O | R | — |
| Weekly rent | R | R | R | R | R | R | — | R | — |
| Annual income | R | O | O | R | O | R | — | R | — |
| Gross yield | R | R | R | O | R | R | — | R | — |
| Net yield | R | O | — | R | O | R | — | R | — |
| Loan / deposit / LVR | R | R | O | R | O | R | R | R | — |
| Stamp duty | R | O | — | R | O | — | R | R | — |
| Expenses / holding costs | R | O | O | R | O | R | — | R | — |
| Weekly / annual cash flow | R | R | R | R | R | R | — | R | — |
| Projections / equity | R | R | O | R | O | R | — | R | — |
| Suburb / geography | R | R | R | — | R | O | — | R | R |
| Demographics | R | O | — | — | O | — | — | O | R |
| Growth evidence | R | R | O | O | R | R | — | O | R |
| Vacancy / demand | R | O | — | — | O | — | — | O | R |
| Employment | O | O | — | — | — | — | — | O | R |
| Transport / infrastructure | O | O | — | — | — | — | — | O | O |
| Schools | O | O | — | — | — | — | — | — | O |
| Crime / climate | O | — | — | — | — | — | — | — | O |
| Comparable evidence | R | O | — | — | R | — | — | R | O |

Not every report needs everything. The Briefing deliberately carries less; the
Cash Flow carries almost no market information because it answers a funding
question; Borrowing Capacity is property-independent.

## B4. Scoring information

Under the forward-only policy, **no report may reconstruct a score** — every
one reads the engine's published result, and where a grade was not issued it
says so in the shared wording.

| Family | Overall grade | Score | Coverage | Dimensions | Unavailable reasons | Finance Suitability | Methodology disclosure |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 1 Investment | yes, when eligible | yes | yes | yes | yes | yes, separately | yes |
| 2 Strategic | yes, when eligible | yes | yes | yes | yes | yes | yes |
| 3 Briefing | yes, when eligible | yes | yes | summary | yes | no | short form |
| 5 Cash Flow | no | no | no | no | no | yes | no |
| 6 Comparison | yes, when eligible, per property | yes | yes | yes | yes | no | yes |
| 8 Portfolio | per holding, when eligible | yes | yes | no | yes | no | short form |
| 9 Borrowing Capacity | no | no | no | no | no | yes | no |
| 10 Commercial | its own methodology | yes | yes | yes | yes | no | yes |
| 11 Market Intelligence | no (area, not property) | no | no | no | no | no | no |

**Today, on current evidence, every "yes, when eligible" resolves to not
eligible.** That is the honest state and the reports must present it as such
rather than omitting the section.

## B5. Narrative ownership

| Content | Source | May a model write it? |
| --- | --- | --- |
| Any price, rent, yield, loan, cash flow, duty, projection | Deterministic calculation from the record | **Never** |
| Score, grade, coverage, eligibility | The scoring engine's published result | **Never** |
| Property attributes | The record | **Never** |
| Market statistics | The ingested registers | **Never** |
| Explanation of what a figure means | Model, from figures supplied to it | Yes |
| Area context and commentary | Model, over deterministic stat blocks | Yes |
| Strategy framing, risks in prose | Model | Yes |
| Summary of the report | Model | Yes |

The existing controls stay: deterministic stat blocks in, `factReconciliation`
checking prose against the record, the verdict-sentence guard, Portfolio's
assemble-after-the-model rule, Commercial's numeric-free tool schema.

## B6. Charts and visuals

Every visual must answer a question a reader actually has. Charts kept only
because the report already has them are marked for removal.

| Family | Required | Optional | Remove |
| --- | --- | --- | --- |
| 1 Investment | Cash-flow projection, equity growth, cost breakdown, property images | Suburb demographics, comparable sales | Any scorecard visual while no grade is issued |
| 3 Briefing | One headline chart | — | Duplicate charts inherited from 1 |
| 5 Cash Flow | Year-by-year table + cumulative line | Sensitivity | — |
| 6 Comparison | Side-by-side metric bars | Cash-flow overlay | Radar (already retired) |
| 8 Portfolio | Portfolio value over time, per-holding contribution | Allocation | — |
| 9 Borrowing | Capacity bars by scenario | — | — |
| 10 Commercial | Cap-rate and DCF outputs | Sensitivity grid | — |
| 11 Market Intelligence | Market trend series | Comparative suburbs | — |
| Map | Where a coordinate is **trusted** | — | Any map drawn on an unresolved coordinate |

The map rule is not cosmetic: 62 reports carry Sydney's CBD as a geocoder
failure value, several of them Western Australian properties.

## B7. Front-end output

Common shape for every family: **summary → headline metrics → sections →
expandable detail → evidence status → download**. The front-end must state the
same facts as the PDF; where they can differ, they will.

| Element | Rule |
| --- | --- |
| Report summary | One paragraph, model-written, no authoritative numbers introduced |
| Headline metrics | Deterministic only; absent figures say "not available" |
| Scoring display | The engine's published result, or the shared unavailable statement |
| Evidence status | Always visible — what informed the report and what did not |
| Sections | Mirror the PDF's section list exactly |
| Download | One action; the artifact the server rendered |

## B8. PDF information architecture

The Investment Property Report, as the template every other family narrows:

| § | Section | Objective | Facts | Calculations | Scoring | Narrative | Visuals |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Cover | Identify property, client, issuer, date | Address, client, brand | — | — | — | Property image |
| 2 | Executive summary | The case in one page | Headline facts | Headline figures | Grade **or** unavailable statement | Yes | — |
| 3 | Property | What is being bought | All attributes | — | — | Short | Images |
| 4 | Location & area | Where it is | Suburb, geography | — | Location dimension or its reason | Yes | Map when trusted |
| 5 | Market evidence | What the market is doing | Registers | — | Growth/Demand or their reasons | Yes | Trend charts |
| 6 | Financial modelling | Cost to acquire and hold | Price, rent, costs | Full | — | Short | Cost breakdown |
| 7 | Projections | Over ten years | — | Full | — | Yes | Projection charts |
| 8 | Risk & considerations | What could go wrong | — | — | Risk dimension or its reason | Yes | — |
| 9 | Finance suitability | This buyer, this purchase | LVR, cash flow | Bands | Separate from the grade | Short | — |
| 10 | Evidence & methodology | What this rests on | Provenance | — | Versions, coverage | — | — |
| 11 | Disclosures | Obligations | Issuer, disclaimer | — | — | — | — |

Section 10 is new and load-bearing: it is where coverage, versions and
unavailable reasons live, and it is what makes a withheld grade legible rather
than puzzling.

## B9. Data trust status — the reality check

| Field | Status | Note |
| --- | --- | --- |
| Address (free text) | **Available, needs cleanup** | 777 of 1,006 labels carry no state token; many are placeholders |
| Suburb / postcode / state | **Currently unavailable** | Stored structurally on **zero** rows |
| Coordinates | **Available + trusted where resolved** | 741 of 1,006 placed by ASGS point-in-polygon; 62 are a failure sentinel |
| Property type | **Available, needs cleanup** | Two vocabularies; 82 rows read `Residential Property` |
| Beds / baths / cars / land / build | **Available, needs cleanup** | Present but not canonicalised |
| Purchase price | **Available + trusted** | 188 reports after operator-entry recovery |
| Weekly rent | **Available + trusted** | 188; nine addresses carry same-day contradictory rents |
| Gross / net yield | **Available + trusted** where price and rent are | Basis must travel with the figure |
| Loan / deposit / LVR | **Available + trusted** | 21 contradictory rows healed on read |
| Stamp duty | **Available + trusted** | Single canonical implementation |
| Cash flow, projections | **Available + trusted** | Deterministic |
| Walk score | **Currently untrusted** | 30 of 100 points are a per-state constant |
| Commute to centre | **Currently untrusted** | Mean 10,125 minutes; non-NSW routed to Sydney |
| Schools nearby | **Currently untrusted** | At the ceiling on 851 of 1,114 |
| Transport | **Currently untrusted** for scoring | Per-state constants; real GTFS exists but is not bound per report |
| Demographics (Census, SEIFA) | **Available + trusted** | Real ABS ingests, postcode grain |
| Crime, climate | **Available + trusted** | Real registers, four states + SILO |
| Macro (RBA) | **Available + trusted** | National grain — context only |
| Suburb growth | **Currently unavailable** | No open source for QLD/WA; no ABS suburb price |
| Vacancy / demand | **Currently unavailable** | Nothing stored on any row |
| Property risk evidence | **Currently unavailable** | No question answerable from the record |
| Comparable sales | **Future data source** | Requires a licensed provider |

## B10. Duplication matrix

| Information | Where it appears | Class |
| --- | --- | --- |
| Property attributes | 1, 2, 3, 6, 8 | **Intentional** — each audience needs them |
| Headline financials | 1, 3, 5, 6 | **Intentional**, provided one source |
| Cash-flow projection | 1, 5, 7 | **Redundant** — one projection, three presentations |
| Yield | 1, 3, 5, 6, 8 | **Contradictory risk** — basis must travel or two reports disagree |
| Score / grade | 1, 2, 3, 6, 8 | **Contradictory risk** — resolved only by reading one published result |
| Rent | 1, 3, 5, 6 | **Contradictory risk** — no canonical property-level rent exists today |
| Suburb commentary | 1, 2, 11 | **Redundant** — three generators write it separately |
| Disclaimer / issuer | all | **Intentional**, one source already |

## B11. Priority

**P1 — core client-facing, perfect first**
1. Investment Property Report
2. Briefing / Snapshot
3. Financial Modelling + 10-Year Cash Flow (one numeric spine)

**P2 — important secondary**
4. Property Comparison
5. Portfolio Review
6. Borrowing Capacity
7. Strategic Property Report

**P3 — specialist / support**
8. Commercial & Industrial Capacity
9. Market Intelligence
10. Report Q&A
11. Cash Flow Comparison
12. Quantitative listings report
13. Client Details Form

**Recommended implementation order:** the Investment Property Report first,
because every other family either derives from it (2, 3, 4, 13), compares it
(6, 7), or reuses its numeric spine (5). Fixing it fixes the inputs to nine
other families; fixing any other first fixes one.

## B12. Master matrix

| Report | Purpose | Audience | Facts | Financials | Market evidence | Scoring | Narrative | Charts | Front end | PDF | Data readiness | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | :-: |
| Investment Property | Full case for one property | Investor | Full | Full | Full | Grade when eligible | Heavy | 4 required | Full page | 11 sections | **Partial** — no growth/demand/location | **P1** |
| Briefing / Snapshot | One-page version | Investor / adviser | Core | Core | Summary | Grade when eligible | Light | 1 | Card | 2–3 pages | Partial | **P1** |
| Financial Modelling | Funding and holding | Investor / broker | Core | Full | None | None | Light | 2 | Section | Chapters | **Ready** | **P1** |
| 10-Year Cash Flow | Holding over time | Investor / accountant | Minimal | Full | None | None | Light | 2 required | Table + chart | 3–4 pages | **Ready** | **P1** |
| Property Comparison | Choose between properties | Investor | Core ×N | Core ×N | Summary ×N | Per property | Medium | Side-by-side | Grid | 4–6 pages | Partial | **P2** |
| Portfolio Review | Performance of holdings | Multi-property owner | Per holding | Full | Light | Per holding | Medium | 2 | Dashboard | 5–8 pages | **Ready** (deterministic facts) | **P2** |
| Borrowing Capacity | What can be borrowed | Buyer / broker | None | Full | None | None | Light | 1 | Form + result | 2–3 pages | **Ready** | **P2** |
| Strategic Property | Fit to a strategy | Planned investor | Core | Core | Full | Grade when eligible | Heavy | 2 | Full page | Variant of 1 | Partial | **P2** |
| Commercial & Industrial | Commercial deal analysis | Commercial client | Full | Full | Light | Own methodology | Medium | 2 | Workspace | Own structure | **Ready** | **P3** |
| Market Intelligence | Market conditions | Subscriber | None | None | Full | None | Heavy | 2 | Article | 6–10 pages | **Ready** | **P3** |
| Report Q&A | Follow-up answers | Investor | From parent | From parent | From parent | From parent | Heavy | None | Thread | Q&A list | **Ready** | **P3** |
| Cash Flow Comparison | Compare holding costs | Investor | Minimal | Full ×N | None | None | Light | 1 | Grid | Preview only | **Blocked** — nothing persisted | **P3** |
| Quantitative listings | Marketplace digest | Internal | Listing facts | Light | None | None | None | 1 | Table | Own renderer | **Ready** | **P3** |
| Client Details Form | Captured particulars | Internal | Full | None | None | None | None | None | Form | 1–2 pages | **Ready** | **P3** |

## B13. Stop

No Reporting implementation follows from this document until it is reviewed.
Specifically **not** started: the Report Fact Contract, renderer
consolidation, composer rewrites, front-end redesign and template migration.

The single most consequential thing this blueprint records is that **four of
the fourteen families are fully ready today** (Financial Modelling, 10-Year
Cash Flow, Borrowing Capacity, Client Details Form — plus Commercial, Market
Intelligence, Q&A and the listings digest on their own terms), while the
flagship Investment Property Report is **partial**, because three of its five
scoring dimensions and all of its location measurements have no trustworthy
source. Rebuilding its architecture will not change that; only evidence will.
