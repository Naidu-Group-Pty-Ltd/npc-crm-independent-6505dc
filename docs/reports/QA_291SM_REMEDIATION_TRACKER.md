# QA-291SM remediation tracker

**Audit:** `291_Stone_Mason_Reporting_Engine_Error_Audit.pdf` (QA-291SM-20260915),
forty findings QA-01–QA-40 over the six documents generated for 291 Stone
Mason Drive, Kellyville NSW 2155 on 15 September 2026 (Compass = C,
Financial = F, Strategic = S, Snapshot = N, Briefing = B, 10 Year Cash Flow =
T), plus the three symptoms the operator reported with them.

**Branch:** `claude/adoring-hopper-g02tdt`. Checkpoints: `297d8ee` (1),
`e6dd0a9` (2), `b007a18` (3), and checkpoint 4 (this file, the regeneration
findings and the fixes they forced).

This file is the audit-ID-linked record the remediation was asked to keep.
Every finding has a **disposition** (how the audit's classification held up
against the implementation), a **status**, the **evidence** for the status
and the **control** that now exists. Two statuses are deliberately distinct:
*implemented* means the code changed and its tests pass; *verified on a
render* means a document was regenerated and the page inspected. Nothing is
marked resolved because code changed.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| Implemented · tested | Code changed; unit/contract tests for the finding pass. |
| Implemented · rendered | As above, and the fix is visible on a regenerated document from the synthetic fixture (see §4). |
| Recorded · evidence gap | The audit's gap is real; the platform holds no data that could close it. The document now states the gap; the decision needed is named. |
| Decision needed | A business or methodology choice the engineer may not make alone. Named in §3. |
| Not reproducible here | Needs production access this session did not have. The next action is named. |

## 1. The three reported symptoms

| # | Symptom | Root cause found | Status | Evidence |
| --- | --- | --- | --- | --- |
| S1 | "Reports are not being generated in the template forms"; toast *Your chosen template was not used … The renderer could not produce the document* | Every template route ends in the WeasyPrint render service on Cloud Run, which answered **503** (its own front door: no ready instance). The route fell back to the standard pdf-lib layout on all five documents and the notice dropped the status and the engine's words. The deploy workflow has never deployed (3 runs, gate variables unset). **Recurred the same afternoon as the host's 500 page, for five hours and counting** — see §6. | Implemented · tested (the product names the failure; the host's page is the engine not answering under either status; the chosen template is drawn by the in-tab renderer while the engine cannot); **Not reproducible here** (the service itself — an operator with `gcloud` must redeploy) | `renderFailure.pure.ts` (`classifyServiceAnswer`), `weasyprintClient.ts` (classified error, one retry), `render-template-pdf`, `routeReportThroughTemplate.ts` (`engine_unavailable`, `browserStandInFor`), `templateDocument.ts` (both notices), `deliverInvestmentPdf.ts` (a stand-in is never the remembered finalisation); `renderFailure.spec.ts`, `templateRouteRefusal.spec.ts`, `routeBrowserStandIn.spec.ts`, `deliverInvestmentPdf.spec.ts`. Runbook: `RENDER_SERVICE_AVAILABILITY.md`. |
| S2 | Download names "random, not reflecting the report or the address" | `investmentPdfDocument.ts` named every file `<uuid-prefix>_<ADDRESS>_<epoch>.pdf`; the "Financial Download - " / "Steategic Download" prefixes were typed by hand on the operator's side. | Implemented · tested | `reportFileName.pure.ts` → `Due_Diligence_Report_291_Stone_Mason_Drive_Kellyville_NSW_2155_2026-09-15.pdf`; used by the renderer, the template route, the client download and the adapter. `reportFileName.spec.ts`. |
| S3 | Cash-flow PDF: *WeasyPrint render failed (503): \<html\>…503 Server Error…* | Same engine failure as S1; the cash-flow route has no standard-layout fallback and printed the HTML body. | Implemented · tested (the toast prints the operator's sentence; the function answers 503 `engine_unavailable`); **Not reproducible here** (the service) | `render-cash-flow-pdf`, `requestCashFlowPdf.ts`; runbook as above. |

## 2. Findings QA-01–QA-40

Severity and class are the audit's. "Disposition" records whether the
implementation agreed.

| ID | Sev | Audit class | Disposition | Status | Control / evidence |
| --- | --- | --- | --- | --- | --- |
| QA-01 | Critical | Confirmed | **Agreed.** `readBaseFinancials` read flat legacy keys the calculator stopped writing; the standalone model seeded no rent and no costs. | Implemented · rendered | Nested record paths (override → record → legacy → default) with `provenance`; `missingInputs` refuses a projection with no rent/price/costs (`assertProjectionComplete`). `readBaseFinancials.spec.ts`. |
| QA-02 | High | Confirmed | **Agreed.** Nothing declared one scenario across the six outputs. | Implemented · rendered | `caseInputsFingerprint` (FNV-1a over the seeded inputs) printed on the cash-flow document; every tier reads the same `financial_calculations` row. `readBaseFinancials.spec.ts`. |
| QA-03 | Critical | Confirmed | **Agreed.** Inspection fees were absent from the standalone acquisition total ($55,032 understated with LMI/legal/inspections). | Implemented · rendered | `inspectionFees` and `lmiAmount` seeded from `initialCosts`; `Inspection fees` line in the wire acquisition; `acquisitionCashFor` includes it. |
| QA-04 | Critical | Confirmed | **Agreed.** "Interest only" label over 30-year P&I arithmetic. | Implemented · tested | `loanLedger.pure.ts` (monthly ledger, IO period honoured) drives projections, key metrics and sensitivities; `loanDetails.structure`/`interestOnlyPeriod`/`interestOnlyPayment` published; chapters print the structure. An IO loan with no stated period assumes 5 years and **says so** (`ASSUMED_INTEREST_ONLY_YEARS`; see §3). `loanLedger.spec.ts`, `financialEngine.spec.ts`. |
| QA-05 | High | Confirmed by reconstruction | **Agreed.** Annual timing with a monthly formula. | Implemented · tested | Ledger balances replace the annual shortcut (year-10 balance moves by −$314 on the reference case; pinned). |
| QA-06 | High | Confirmed | **Agreed.** Headline cash flow ignored the 50-week occupancy. | Implemented · tested | `occupancyWeeks` reaches the engine; rent is collected at occupancy in projections and key metrics; `effectiveAnnualRent` / `potentialAnnualRent` published. |
| QA-07 | High | Confirmed | **Agreed.** Two net-yield numerators. | Implemented · tested | One `totalAnnualExcludingLandTax` basis in the generator; the formula label names it ("Net operating yield before finance and tax"); the engine's `preCalculatedNetYield` is preferred. |
| QA-08 | High | Confirmed by reconstruction | **Agreed, with a SECOND cause found on the regenerated document:** the prompt read a key the engine never wrote, AND the standard renderer's override injection matched `Interest Rate.*?NN%` — the label, anything, then the next percentage — and rewrote every composed "Interest rate 7.5% (+1.0 pt)" row as "Interest Rate: 6.5% (+1.0 pt)" (the same rule family rewrote "Serviceability (LVR proxy) \| 22% \|" as "(LVR: 80%"). | Implemented · rendered | `sensitivityAnalysis.scenarios[]` with labels; `sensitivityRowsForPrompt` reads the record; chapters print the published labels; the three injection rules now match only an explicit `Label: NN%` (pinned by `qa291Contracts.spec.ts`); the WinAnsi strip maps U+2212 to a hyphen so "(−1.0 pt)" keeps its sign. |
| QA-09 | High | Confirmed under the displayed fee rule | **Agreed.** Rent sensitivities froze a %-of-rent fee. | Implemented · tested | `rentLinkedFeeRate` recomputes the fee per scenario; `feeBasis: 'collected_rent'` disclosed. |
| QA-10 | High | Confirmed disclosure defect | **Agreed.** Scenarios and "year 1" undefined; the prompt's growth block was a literal. | Implemented · tested | `assumptions.scenarioGrowth`, `growthTiming`, `occupancyWeeks`, `feeBasis`, `loanStructure` published and printed (chapters, prompt). |
| QA-11 | High | Confirmed disclosure defect | **Agreed.** Series not reproducible from disclosed assumptions. | Implemented · tested | Projection rows carry `operatingCosts`, `interest`, `principal`, `loanPayments`; components reconcile to cash flow (pinned in `financialEngine.spec.ts`). |
| QA-12 | High | Evidence gap | **Agreed.** No eligibility/utilisation basis is held. | Recorded · evidence gap | `evidenceBasisNotes`: the document states that deductions are assumed utilised at the stated marginal rate and that income, structure and eligibility are not held. Decision in §3. |
| QA-13 | High | Confirmed / evidence gap | **Agreed.** Purchase price was assigned to build. | Implemented · rendered | `landBuildSplit` reads the record; a missing split renders "Not stated" and no depreciation is derived from a guess. |
| QA-14 | High | Evidence gap | **Agreed.** Zero land tax not tied to the owner's holdings. | Recorded · evidence gap | `evidenceBasisNotes` distinguishes "none recorded" from "none payable" and names aggregate landholdings as the missing input. |
| QA-15 | High | Evidence gap; double counting not established | **Agreed** (no double counting found either). | Recorded · evidence gap | `evidenceBasisNotes` states whether operating costs are recorded entries or default allowances, "not quotes or bills". |
| QA-16 | Moderate | Confirmed disclosure gap | **Agreed.** Equity headline never bridged to cash committed. | Implemented · tested | Projections chapter's equity bridge (equity at year N, cash to settle, shortfalls funded, total committed, net position before selling costs and tax). `financialRiskDashboard.spec.ts`. |
| QA-17 | High | Evidence gap | **Agreed.** The dimension is an LVR band; nothing about the borrower is an input. | Implemented · tested; **Decision needed** on suppression | Label "serviceability (LVR proxy)"; engine `details` names the proxy; `scoreBasisLine` prints every dimension's basis under the table. Whether to mark the dimension *not assessed* (changing the methodology and every stored score's weights) is in §3. `qa291Contracts.spec.ts`. |
| QA-18 | High | Evidence gap / unreconciled signals | **Agreed, and located:** the Compass never carried 68/100 or "score of 82"; the condense model invented them. | Implemented · tested | `scoreClaims.pure.ts`: a score-shaped claim not in the record and not in the parent is removed at condense and logged (`unrecorded_score_claims`); the validator reports the class on the composite (`unrecorded-score`). `scoreClaims.spec.ts`. |
| QA-19 | Moderate | Confirmed presentation defect | **Agreed.** Omitted dimensions drawn as measured. | Implemented · tested | `readScoreComponents` gated by `dimensionScoresMayBeShown` and `dimensionWasScored` (checkpoint 1). |
| QA-20 | High | Evidence gap / unsupported certainty | **Agreed.** "Confidence: High" beside the check still to do. | Implemented · tested (prompt + validator) | Registry purpose defines the chip as evidence held (Verified / Unverified / Conflicting), separate from the exposure level; the generator exemplar separates exposure, evidence and check; `risk-confidence-overstated` finding. |
| QA-21 | High | Confirmed ambiguity / title gap | **Agreed.** | Implemented · tested | `landAreaScope.pure.ts`: an area on a strata dwelling, or at site scale, is labelled "Recorded area (scope unresolved …)", barred from calculations, with the note in the table. `landAreaScope.spec.ts`. |
| QA-22 | Moderate | Confirmed content regression | **Agreed.** "Residential Property" was a prose fallback that read as a fact. | Implemented · tested | The generator never fills a type; the renderer's replacement rule uses `meaningfulPropertyType` (checkpoint 1); the prompt tells the model to carry the documents' stated type through every section. |
| QA-23 | High | Confirmed labelling / valuation gap | **Agreed.** | Implemented · tested | Snapshot guide: "Modelled purchase price" / "Asking price", never "Estimated Value"; KPI rent caption reads the rent's provenance (`rentProvenanceCaption`) instead of "Current market rate". |
| QA-24 | High | Confirmed taxonomy defect | **Agreed.** | Implemented · tested | Snapshot guide splits observed statistics (with source) from a "Scenario assumptions (not market statistics)" sub-table; the shared KPI captions read "Scenario assumption" (capital growth) and "Assumed for modelling" (rate). |
| QA-25 | High | Evidence gap | **Agreed.** No like-for-like comparison basis is held in the record. | Recorded · evidence gap | No engine control can supply comparables the record lacks. Decision in §3 (a comparables source). Existing prompt rule already forbids uncited growth percentages. |
| QA-26 | High | Confirmed analytical gap | **Agreed.** Listings are not a pipeline. | Recorded · evidence gap | The platform holds no development-approval feed. Decision in §3. |
| QA-27 | Moderate | Confirmed omission / evidence gap | **Agreed.** Heading promised an index the fork never checked for. | Implemented · tested | `socioeconomicContract`: heading loses "& SEIFA Interpretation" and the body opens with the index-not-held statement when no index with a figure is present. `forkSectionContracts.spec.ts`. |
| QA-28 | High | Confirmed source conflict | **Agreed.** | Implemented (prompt control) | Catchment evidence rule in the schools prompt: conflicting sources are each named and marked unverified, never chosen; travel claims need mode, origin, distance and duration or are omitted. |
| QA-29 | Moderate | Confirmed imprecision | **Agreed.** | Implemented (prompt control) | Prompt states that bushfire-prone-land mapping is not a BAL and that a BAL is a site-specific assessment stated only if held. |
| QA-30 | High | Confirmed traceability defect | **Agreed.** `[^prop]`-style tokens printed raw; source lists did not resolve. | Implemented · rendered | `plainMarkdownHygiene`: footnotes numbered and listed under **Notes**; undefined references dropped. |
| QA-31 | High | Confirmed content-routing defect | **Agreed.** The route's note described a filter that never existed. | Implemented · tested | `splitRiskRegister` (financial entries to FIN, property entries to PLDD, unclassifiable to both); the FIN dashboard is **composed from the record** (`financialRiskDashboard`, ordinal 11) with the routed money entries under it and a cross-reference to the Due Diligence register. |
| QA-32 | High | Confirmed identity defect | **Agreed.** Strategic printed the Snapshot's identity; its dashboard was a checklist. | Implemented · tested | `DOCUMENT_IDENTITY` (strategic = "Due Diligence Report"), file name and PDF metadata bound to one tier (checkpoint 1); `riskDashboardContract` renames a checklist body "Property & Location Due Diligence Checklist" with its status line. |
| QA-33 | Moderate | Confirmed completeness defect | **Agreed, and three mechanisms found:** the standard renderer *dropped* the `{{heatmap}}` the prose introduced; the word-cap cut kept a bullet's title and dropped its explanation and the whole "Limitations" half; and a chapter whose own body is blank because its prose lives in H3 children lost its heading (the early `continue` ran before the children rule). | Implemented · rendered | `vizDirectiveTables` writes undrawable directives back as tables (a titled heatmap carries its scale in the header so the anonymous-grid rule of QA-36 does not omit it); the cut works in whole blocks and shares the cap between sub-sections; validator rules `promised-table` and `unbalanced-pair`; a heading with children survives a blank body. |
| QA-34 | Moderate | Confirmed publishing defect | **Agreed.** | Implemented · rendered | Fences unwrapped, "(Rendered Once Here)" removed, underscore emphasis converted, a 2-column table split from the 7-column one (`splitPipeRun`), header/column mismatch aligned (checkpoint 1). |
| QA-35 | Critical | Confirmed structural failure | **Agreed.** A >96-char delimiter row and separator floods. | Implemented · rendered | Delimiter rows canonicalised; separator-only lines and punctuation runs tamed (`normaliseSeparators`). |
| QA-36 | High | Confirmed unusable presentation | **Agreed.** | Implemented · rendered | Anonymous numeric grids get a notice; rows aligned to the header. |
| QA-37 | High | Confirmed omission | **Agreed.** | Implemented · tested | `financialWarningsForPrompt` hands the model the record's shortfalls, shocks, step-up and grade at the recommendation, with the rule that each is reconciled. |
| QA-38 | High | Confirmed contradiction | **Agreed.** "Compression" narrated over an unchanged yield. | Implemented · rendered | `describeYieldMovement` says "unchanged" when nothing changed; `not_assessable` when no rent is established. `yieldNarrative.spec.ts`. |
| QA-39 | Moderate | Confirmed horizon inconsistency | **Agreed.** | Implemented · rendered | `describeGrowth` names the start and end years of the interval it quotes. |
| QA-40 | Moderate | Confirmed visual defect | **Agreed.** | Implemented · rendered | Duplicate legend entry removed (`legendType="none"` on the area); callout clipping fixed by the paragraph guard (checkpoint 1). |

## 3. Decisions the engineer may not take alone

1. **Interest-only period when the record says "interest only" and no period.**
   The ledger assumes 5 years and the document says so. Confirm the product
   convention (5? the loan term? refuse to project?).
2. **Serviceability dimension.** Relabelled as the LVR proxy it is, with its
   basis printed. The audit's stronger ask — "not assessed" rather than
   80/100 — changes the financial score's weights on every stored record
   (`assemble` redistributes weight across available dimensions). A
   methodology version bump is the right vehicle; not done here.
3. **Tax utilisation, land tax, operating-cost evidence (QA-12/14/15).**
   Stated as assumptions on the page. Closing them needs inputs the platform
   does not collect: taxable income / entity, aggregate landholdings, rates
   notices and levies. Decide whether the intake form should collect them.
4. **Comparables and supply pipeline (QA-25/26).** No data source exists in
   the platform for like-for-like sales or approved development pipeline.
   Decide whether to license one; until then the prompt forbids uncited
   growth claims and the register calls its supply view "existing listings".
5. **Render service (S1/S3).** Set the three deploy-workflow variables; add a
   startup probe; decide on `--min-instances 1`. See the runbook. **And, now:
   the service is down and nothing in this repository can reach it.** An
   operator with `gcloud` on the production project runs the runbook's steps
   0–4 (read why the revision cannot serve; redeploy the image it already
   runs). Until then every chosen template comes out of the in-tab renderer,
   said so on each download. **Later the same day the owner declined any
   further Cloud Run deploy on cost grounds** (the last change there cost
   over $1,200); the route is now Fly.io — `deploy-render-fly.yml`, one
   secret, one machine — see the runbook's *Leave Cloud Run*.
6. **Year-1 growth timing.** Both engines apply growth before year 1; kept,
   and now disclosed (`growthTiming`). Confirm or change once, in the engine.
7. **Overall grades on new reports (S4).** Since 11 Sep 2026 no new report
   carries an overall grade: `PRODUCTION_SCORING_AUTHORITY` is `unavailable`
   (V1 not trusted to grade; Scoring V2 frozen and not activated — ME-8 in
   `SCORING_V2_METHODOLOGY.md`). The D · 39 the Generated Reports card showed
   for 291 Stone Mason Drive was the Financial fork minting a V1 grade past
   that policy, which this branch stops; the page's "not issued" was correct.
   Grades return only through the V2 activation decision, which is a review,
   not a flag — nothing here flips it. **Taken on 15 Sep 2026** by the owner's
   instruction to rectify the grading: `SCORING_V2_ACTIVATION` in
   `scoringV2Production.pure.ts` wires the frozen engine as the production
   grade engine under one added condition — Growth must be measured before a
   letter is printed (a grade without it is a statement about missing data)
   — with every gap named on the record (`gradeGaps`). See the addendum row S5
   and `SCORING_V2_METHODOLOGY.md` § Activation.

## 4. Verification record

See the handover for the exact commands. In summary, on this branch:

- **Unit and contract tests:** the whole vitest suite; the new specs are
  `plainMarkdownHygiene`, `reportFileName`, `loanLedger`, `promptFinancials`,
  `renderFailure`, `readBaseFinancials`, `yieldNarrative`, `scoreClaims`,
  `qa291Contracts`, `vizDirectiveTables`, `forkSectionContracts`,
  `financialRiskDashboard`, `landAreaScope`.
- **Gates at the final commit:** `npx vitest run src/lib/reports
  src/components/reports src/lib/cashFlow src/components/cash-flow
  src/lib/reportTemplate` — 559 files, 9,220 tests passed; the whole suite
  earlier in the session passed except the three pre-existing failures named
  below (and one spec that was mid-edit when that run started and passes on
  its own); `npm run build` — built in 2m 42s; `npm run audit:style` — under
  baseline; `npm run lint` — 0 errors in any file this branch touched (the
  repository's 46 pre-existing lint errors are in files it does not touch).
- **Typechecks:** `tsc -p tsconfig.app.json` (48 pre-existing errors,
  baseline 61 at branch start, none new); `deno check` on every edited edge
  function and pure module (fork 0; condense 6 = baseline; generator 14 =
  baseline; the four render/calculator functions 0 new). Deno was obtained
  through the `deno-bin` npm package with `deno.land` and `esm.sh` imports
  mapped onto local stubs and the npm registry, because the sandbox blocks
  both hosts — the mapping is verification-only and not in the repo.
- **CI gates run locally:** edge column names, error disclosure, fabricated
  data, mass assignment, src missing names, internal legacy fallback,
  verify_jwt declarations, baseline invariants — all pass. The Deno
  post-processor tests pass (11).
- **Pre-existing failures, not this branch's:** `sidebarNavigation.spec`,
  `migrationObjectIndex.spec` and `googleMapsProxies.security.test` fail
  identically on the base commit `06b077d` (run in a worktree); nothing on
  the branch touches those areas.
- **Regenerated documents:** the six documents cannot be regenerated from
  the production rows here (no database access; the journey harness needs
  `.verify/fixtures`). They were regenerated from a **synthetic fixture** —
  the audited property's figures and a composite carrying each defect class
  — through the same renderers the fallback used (pdf-lib for the five
  tiers, local WeasyPrint 69.0 for the cash flow) and every page was
  rendered and inspected. What that proved: every defect class in §2 marked
  *rendered* is absent from the regenerated pages, and the regeneration found
  three defects the code review had not (the injection rewrite, the dropped
  minus sign, the lost heading), each fixed and pinned. What it does not
  prove: the model's behaviour under the changed prompts, the fork against a
  real composite, or the render service. One harness artefact to know about:
  the harness fed the raw fixture to the renderer, so its KPI tiles and the
  composed chapters showed different year-1 figures; the product path goes
  through `investmentPdfSource.ts`, which reconciles the record once for
  both, so the tiles and the chapters read the same healed figures there.

### The regenerated set

Rendered on 15 Sep 2026 from the synthetic fixture (the audited property's
figures; a composite carrying every defect class), through the same code
paths the operator's downloads take — `generateInvestmentPdfBlob` for the
five tiers, `readBaseFinancials` → the projection engine → `toWireProjection`
→ `buildProjection` → `renderCashFlowFromBrand` → WeasyPrint 69.0 for the
cash flow. Every page was rasterised and the key pages inspected.

| Document | Pages | What was checked on the page |
| --- | --- | --- |
| Investment Compass | 9 | No raw directive, fence, footnote token or authoring note; the promised amenity matrix drawn as a table with its scale; both halves of "Strengths and Limitations"; the risk register intact. |
| Financial Analysis | 14 | Sensitivity rows labelled with their parameter and sign; the composed Financial Risk Dashboard (cash to fund, shocks, debt structure, step-up) with the analysis's money-risk entries under it and no crime/bushfire entry; the equity bridge; the scorecard heading kept with its band. |
| Due Diligence Report | 5 | "Due Diligence Report" identity; "Socioeconomic Profile" with the index-not-held statement; the property-only register under its own heading and lead; the checklist named as one with its status. |
| Executive Briefing | 10 | The invented 68/100 and "score of 82" sentences absent, the recorded D at 39/100 kept; composed tables placed. |
| Snapshot Report | 7 | "Modelled purchase price", observed statistics apart from "Scenario assumptions (not market statistics)"; the dimension table with "Serviceability (LVR proxy)" and the basis line. |
| 10 Year Cash Flow | 11 | "Interest only" loan type, inspection fees in the acquisition, occupancy 50 weeks and the marginal rate in the assumptions, the evidence-basis notes and the case fingerprint under "Worth knowing". |

The artefacts are not committed (they are renders of a synthetic fixture,
not client documents); the harness that produced them is described in the
handover and can be re-run against a production row once database access
exists.

## 5. What is not verified

- The render service's state on Cloud Run, and therefore S1/S3 end to end.
  The one measurement this repository's tooling could take — `GET /` from the
  production database via `pg_net`, 15 Sep 06:25 UTC — answered Cloud Run's
  own 500 page, which rules out the document and the token and leaves the
  cause (instance start, memory, a crashing worker, routing) to the Cloud Run
  logs the runbook names. The browser stand-in was verified by its spec and
  the delivery spec, not by a production download.
- The generator's and condense function's behaviour against a live model
  (prompt controls QA-20/22/28/29/37 and the Snapshot guide are instructions
  to a model; the validator findings and the score guard are the
  deterministic half).
- The fork against a real composite row (`fork-investment-report` needs
  Deno + database); its pure contracts are tested.

## 6. 15 Sep addendum — the recurrence, and the grade that showed on the list and not on the page

Two reports on the afternoon of 15 Sep 2026, both on 291 Stone Mason Drive.

| ID | Reported | Finding | Disposition | Where |
| --- | --- | --- | --- | --- |
| S1 (recurrence) | The template toast again, now *"The print engine failed to draw the document (HTTP 500 from the render service). It said: '500 Server Error — … Please try again in 30 seconds.'"*; the templated document cannot be produced to audit | Since 00:46 UTC every render (eight, across two formats) has met Cloud Run's own 500 page in 130–330 ms. `GET /` from the production database met the same page: no instance is taking any request. The morning's fix read the status alone, so the 500 was `engine_failed` — final and unretried — while the 503 beside it was `engine_unavailable`. The container tree has not changed since the 11th and has never been deployed by its workflow. | **The host's page is the engine not answering** under either digit (`classifyServiceAnswer` reads the shape of the answer: HTML `NNN Server Error` with no `X-WeasyPrint-Version`). **The chosen template is drawn by the in-tab renderer** when the engine did not draw it, on a template every block of which that renderer draws in full; marked `degradedFrom`, named as `browser_template_jspdf`, said in its own toast, never remembered as the finalisation, and never on a refusal. Standard layout stays the last resort. The service itself: decision 5. | `renderFailure.pure.ts`, `weasyprintClient.ts`, `routeReportThroughTemplate.ts`, `templateDocument.ts`, `deliverInvestmentPdf.ts`; `renderFailure.spec.ts`, `routeBrowserStandIn.spec.ts`, `templateRouteRefusal.spec.ts`, `deliverInvestmentPdf.spec.ts`; `RENDER_SERVICE_AVAILABILITY.md` |
| S4 | "Scoring is occurring on the Generated Reports page but not populating when the report is clicked": the package card read *D · CAUTION · 39/100*, the report page read *Investment Grade N/A … Insufficient data — qualitative review only (1 of 5 dimensions)* | Two scoring paths, one policy. The Compass composite (00:35 and 05:49) was scored by `investment-scoring-service` under the forward-only policy: `authority: unavailable`, `gradeIssued: false`, one of five dimensions (yield) measured — correct, and the page's reading. The Financial fork (00:49) was scored by `fork-investment-report` through the legacy `investmentScoreEngine` with **no policy at all** and wrote D · 39 · CAUTION — 40% of it the buyer's LVR band and cash flow, which the policy admits to no dimension. Every reader then did what its rules said: an unstamped score reads as a legacy snapshot, and the card resolves the property's grade as the newest score with a number, so the fork's D stood above five chips while the page beside it showed the withholding. The page also drew the record's placeholder `N/A` as the grade. | **A fork mints no grade** (`variantScorePolicy.pure.ts`): the child restates the parent's decision — an issued grade whole, a withholding with the same stamp — and a legacy or absent parent gets a fresh stamp under the production authority; the variant's own dimensions stay on the row as non-authoritative measured analysis. **A variant score never stands for the property while a composite exists**, and **a withholding outranks an older calculated score** (`resolveInvestmentGrade`). **`N/A` is never drawn**: the page names the cause ("Withheld by the scoring policy: no scoring system is currently authorised … 1 of 5 dimensions measured (yield)") above the client-facing sentence, and the card says "Grade withheld" with the same words. Forward-only: the stored Financial row keeps its D until the tiers are regenerated; the card and page read the composite meanwhile. | `_shared/reports/market/variantScorePolicy.pure.ts` (+ bridge), `fork-investment-report/index.ts`, `report-view/utils.ts`, `InvestmentGradeSummary.tsx`, `InvestmentReportHero.tsx`; `variantScorePolicy.spec.ts`, `investmentGradeResolution.spec.ts`, `tierFrameworkPhase1.spec.ts` |

What the person asking should know: **no new report has carried an overall
grade since 11 Sep 2026, by design** (decision 7). The number on the list was
the one surface that had escaped the policy, and it was the buyer's leverage
being graded as the property. The measured analysis (gross yield, the loan
ledger, the sensitivities) is unchanged and still printed.

### S6 — templates and page flow (15 Sep, afternoon), measured on the real engine

Reported with S5: *"the reports are not rendering into the chosen templates
… spacing needs to be key where there are no large gaps between pages."* Two
findings, each measured by rendering the production row for 291 Stone Mason
Drive through WeasyPrint 69.0 in this sandbox rather than by reading the code.

| ID | Finding | Disposition |
| --- | --- | --- |
| S6a | The chosen *First-Home Buyer Report* (a library voice template seeded against a sample preset) binds a vocabulary no adapter publishes, so it resolved five near-empty pages under a letterhead — and nothing measured coverage before drawing. | **Binding coverage is measured and a template that carries none of the report is composed, never shipped empty** (`templateBindingCoverage.pure.ts`, `templateComposition.pure.ts`): its cover, closing pages and tokens over a family master's body. Rendered: 5 pages → 30, one cover, the absent-client subtitle scrubbed. Recorded in `TEMPLATE_SELECTION.md`. |
| S6b | Page flow on the composed document: the narrative pages are filled by the geometry path (`packNarrativeGeometry` — keep-with-next, table splits, floated figures, tail balancing), and no page in the body runs short. The gaps that remain are on **fixed-layout pages whose blocks the withheld grade drops**: the dashboard page drew at 36% of its height because its verdict, gauge and grade blocks were conditional on a grade that did not exist, the method page carried the same hole, and the last narrative page ran to ~40% because it is the last page. | **No packer change.** The dashboard and method holes are the grade's, not the packer's — S5 is the fix, and on a graded record those blocks draw. A last page that is the last page is not a stub the packer may fill. What stays measured rather than assumed: the composed document was rendered across two families (the FHB voice template over the Investment Compass master, and the Chancery master) and the narrative pages were counted full on both. |

### S7–S9 — the viewer, the scoring switch, and the closing section (15 Sep, afternoon)

| ID | Reported | Finding | Disposition | Where |
| --- | --- | --- | --- | --- |
| S7 | The report page showed the raw directives — `{{glance: …}}`, `{{gauge: 72 \| …}}` — as body copy | The generator's prompt writes twelve chart kinds on their own lines; the print routes draw them (`vizFigures.pure.ts`) or tabulate them and never print the source. Both on-screen viewers handed the Markdown to `react-markdown` whole, which knows nothing of them. | **One split, both viewers** (`viewerFigures.ts`, `MarkdownWithFigures`): a directive-only line becomes a figure drawn by the same renderer the document uses, an undrawable one is tabulated by the same fallback, an unparseable one is dropped, and a directive inside a sentence stays prose — the print rule, borrowed. Styled with semantic tokens. | `src/lib/reports/viewerFigures.ts`, `report-view/InvestmentReportMarkdown.tsx`, `InvestmentReportViewer.tsx`; `viewerFigures.spec.ts` |
| S8 | "Include scoring" is a PDF content switch — does it reach the chosen template? | The content rule removes the scoring CHAPTERS from the Markdown before either presentation, so the templated document already lost those sections. But a template binds the grade DIRECTLY (`scores.*`, and the projection's verdict blocks read the row), so a dashboard page still drew the grade the operator had switched off. | **The switch travels with the content** (`payload.includeScoring`) and the adapter blanks the score on the row the template and the projection both draw from, so scoring off means no grade anywhere — the document the standard presentation prints. Absent means "not included", never "not graded"; nothing stored changes. | `deliverInvestmentPdf.ts`, `adapters/investmentReportAdapter.ts`; `deliverInvestmentPdf.spec.ts`, `investmentReportAdapter.spec.ts` |
| S9 | *"Section 12 of 12 · 10h 45m elapsed · Section Risks & Recommendations failed to generate after 2 attempts"* | Measured on `report_generation_chunks`: the closing section (three headings, 4,000 tokens, 68 KB prompt) took 40-110s whenever it completed against a fixed 60s call timeout, so the full-prompt attempt timed out on every run and the compact retry ran in whatever was left; 43 invocations across the two reports were killed by the platform with nothing written, while the watchdog re-claimed the report and re-ran the same losing minute. The "9-37s observed latency" the 60s ceiling rested on was measured on 2,500-token sections. No `api_usage_log` row for that section exists in three days. | **Every call takes the window the run can spare** (`SECTION_CALL_HARD_STOP_MS` 125s inside the watchdog's 130s, less the post-processing reserve on the closing section, less a reserve for the compact retry); a full-prompt attempt below its measured 60s floor goes straight to the compact prompt; a continuation never starts into a window it cannot finish in; and no window is a **deferral** reported as the hand-off it is (`deferred: true`, no error over the row, no attempt spent), never "failed after 2 attempts". Decision for the owner: whether the closing section's full prompt is right-sized — it has never completed, and the compact prompt has been writing that section. | `generate-investment-report/index.ts`, `INVESTMENT_REPORT_RESUME.md` §2; `sectionCallBudget.spec.ts` |

### S5 — the grade withheld on every report (15 Sep, afternoon)

| ID | Reported | Finding | Disposition | Where |
| --- | --- | --- | --- | --- |
| S5 | The Generated Reports cards read *"Grade withheld — Withheld by the scoring policy: no scoring system is currently authorised…"* on the Compass, Financial, Strategic, Snapshot and Briefing reports alike | Two faults stacked. **No engine was authorised**: `PRODUCTION_SCORING_AUTHORITY` is `unavailable` and Scoring V2 was frozen unwired, so every new run withheld whatever it measured (decision 7). **And there was nothing to measure**: `domain-data-service` requested Domain's deprecated `/v1/…/{state}/{suburb}` route without the postcode segment the live route requires, answered 404 on every call since it was written (`lastSuccess: "Never"`), and would have read three fields the response does not carry; `location_intelligence` is refused by the input policy until repaired; nothing supplied population growth. So Growth and Demand were absent on every report, and V1 measured only Yield — 1 of 5. Separately, the base prompt told the model *"Investment Grade: B … Recommendation: HOLD"* whenever the record held no grade (`grade \|\| 'B'`), with a weights table (30/25/20/15/10) that was never the engine's. | **Scoring V2 activated as the production grade engine** (`SCORING_V2_ACTIVATION`, ME-8): `investment-scoring-service` runs it through `scoreForProduction`, which projects the canonical output onto the V1-shaped record under `authority: v2`; the legacy path is unreached for a property and still cannot spell `v2`. **Growth is required** before a letter is printed; otherwise the grade is withheld with `gradeGaps` naming each unmeasured dimension, the provider's refusal and the remedy, and the card and page draw them. **Domain fetched on the v2 route with the postcode**, keyed on the trusted geography only, extracted once (`domainEvidence.pure.ts`: horizons computed from the series), metered, its refusal named (`X-Domain-Security-Reason` quoted where sent). **Population growth** from the SA2 series the regional service already serves. **The prompt states what the record holds** (`scorePromptBlock.pure.ts`) and forbids a grade where none is issued. Forward-only; no stored row recomputed. Production was asked again on 15 Sep at 13:53 UTC (`market-source-probe`, read-only): both Domain products answer 403 with Domain's own body **"Operation not permitted on project"** — the key is recognised and its project has no API package attached. The owner's action is the Domain Developer Portal (Projects → API Access → add **Properties & Locations** → Save), recorded step by step in `DOMAIN_ACTIVATION_REQUEST.md`; the service now relays that detail onto the grade gap, so the record names the remedy rather than an unexplained refusal. | `_shared/reports/market/scoringV2Production.pure.ts`, `domainEvidence.pure.ts`, `populationGrowthEvidence.pure.ts`, `shadowScorer.pure.ts` (alias + version), `marketEvidence.pure.ts` (`sa2`), `investment-scoring-service/index.ts`, `domain-data-service/index.ts`, `generate-investment-report/index.ts`, `_shared/reports/investment/scorePromptBlock.pure.ts`, `report-view/utils.ts`; `scoringV2Production.spec.ts`, `domainEvidence.spec.ts`, `populationGrowthEvidence.spec.ts`, `scoringMethodology.spec.ts` (guard inverted), `scoringInputPolicy.spec.ts` |

### S10 — growth evidence at no cost (15 Sep, evening)

| id | Symptom | What it turned out to be | Disposition | Where |
| --- | --- | --- | --- | --- |
| S10 | With the Domain package unattached, every report withholds its grade for growth, and attaching the package is a portal action whose price Domain does not publish | The 8 Sep zero-cost inventory had recorded Queensland — 50.8% of the Growth-ready corpus — as publishing no open median sale price series. It does, under a different product: the Government Statistician's residential land development activity spreadsheet carries the median price and number of detached and attached dwelling sales for every monitored LGA, quarterly since June 2008, CC BY 4.0, and `www.qgso.qld.gov.au` answers the production egress (pg_net 240150: 200, 617,018 bytes). NSW's DCJ Rent and Sales Report publishes the sale-price median and count by postcode and LGA each quarter, CC BY 4.0, reachable (240181, 240256). Victoria's file is walled on three egresses; Western Australia has no open series; SQM and the NSW Valuer General's bulk sales were refused on licence. | **The open-data sales register**: `market_sales_medians` (migration), the `market-sales-ingest` loader (discovers the dated QGSO file and the DCJ quarterly workbooks from the publishers' pages; parsers refuse on drift and implausible shape), the adapter `openDataSalesEvidence.pure.ts` (points at the publisher's grain with open licensing), and the generator asking the register after Domain for the cadastre's council or the trusted postcode, merged per measure so a suburb series still wins. The growth gap names the loader. 45 new specs; the inventory re-measured and its grain rule narrowed to the state. Not yet run against production: the migration, the two loads, and a regenerate — `OPEN_DATA_GROWTH_EVIDENCE.md` §9 lists the order. | `_shared/reports/market/openData/{salesRegister,qgsoRldaSales,nswDcjSales}.pure.ts`, `openDataSalesEvidence.pure.ts`, `salesRegisterRead.ts`, `market-sales-ingest/index.ts`, `20261125090000_market_sales_medians.sql`, `zeroCostSources.pure.ts`, `scoringV2Production.pure.ts` (gap remedy), `generate-investment-report/index.ts`; `openDataSalesRegister.spec.ts`, `qgsoRldaSales.spec.ts`, `nswDcjSales.spec.ts`, `openDataSalesEvidence.spec.ts`, `openDataGrowthWiring.spec.ts`, `zeroCostEvidence.spec.ts` |

### S11 — every state, the archive route, and Estimate CGR (16 Sep)

Victoria and South Australia now load from the Internet Archive's captures
of their walled publishers (suburb grain); the ABS state series is the
floor under every state (Western Australia's only reading); the register
key gained the period span; the NSW stage loads one workbook a call after
a 546 compute-limit refusal; and the Financials tab's Estimate CGR button
fills `Growth` from the register for the typed address with its basis and
caveats. `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md` §10.
