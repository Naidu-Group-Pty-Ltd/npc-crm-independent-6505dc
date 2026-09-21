# S6 — the release package

*Prepared 18 September 2026 on `claude/adoring-hopper-g02tdt` (PR
[#2692](https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/pull/2692),
draft). Release-candidate head **`f1fe4d5f01c4f1b9d91c7d081d22f9cdd032eecb`**;
its CI is read green in §6. **The stamp is re-checked against the PR's final
head before merge** — a release is claimed only against a head whose CI has been
read green, never one still running.*

Release stays behind the owner's approval gate. This document is the order of
operations and the rollback, so approving it is a decision about recorded facts
rather than a memory of the branch.

> **This document was rewritten on 18 September 2026.** The version it replaces
> described the five-dimension completion gate, the condition-record evidence
> path and one additive migration. **All three are out of this release** under
> S5/S6 §1 and §8. What replaced the gate is in §1 below; where the deferred
> work went is in §2.

---

## 1. What ships

| module | version | state |
| --- | --- | --- |
| `scorePublicationPolicy.pure.ts` | 1.0.0 (new) | when a score and grade may be published, and the score when fewer than five dimensions were assessed (§4, §7) |
| `proportionalWeighting.pure.ts` | new | the one implementation of §7's arithmetic and of what counts as a valid dimension score |
| `gradeEligibility.pure.ts` | **4.0.0** (was 2.0.0) | the delivered-points ceiling **removed**; the A/A+ coverage gate reads evidence QUALITY over the assessed dimensions rather than a figure that mixes quality with dimension count; and 4.0.0 stops an ABSENT Growth dimension capping the grade at B+ — an absence is judged by the publication policy, never a second time as a quality penalty, while a Growth dimension that IS present is still held to its confidence and coverage floors |
| `scoringV2Production.pure.ts` | 1.1.0 | rebuilt onto `decidePublication`; `requiredDimensions` is `[]`; `SCORE_PUBLICATION_GATE` records the decision |
| `shadowScorer.pure.ts` | 2.1.0 (unchanged methodology) | composes with the shared leaf; publishes `evidenceQualityCoverage` beside `evidenceCoverage` |
| `parcelGeometry.pure.ts` | 1.0.0 | retained — parcel CANDIDATES, parcel-grain identify, the three-way sweep verdict; **no conversion** (`CONVERSIONS` frozen empty, test-asserted) |
| `riskEvidenceConnection.pure.ts` | 1.0.0 | retained — a partial register sweep reads `registers_incomplete`, never "nothing found" |
| `htmlRenderer.ts` (cover heading) | — | the PDF/UA `<h1>` is no longer painted; `overflow:hidden` on a zero-size absolute box does not suppress WeasyPrint's text run |
| `narrativeIndex.ts` / `toc.html.ts` | — | a contents tier is a level whose sections open **more than one page**; masthead `h1`s are descended past |
| `compassDocumentContract.pure.ts` | — | the omit-the-absence rule extended past prose into the strip, the cell and the chart, with the permitted form demonstrated |
| `condense-investment-report` (prompt) | — | the parent is labelled as pipeline input; the reader's single-document position and the permitted form are stated |
| `infrastructureEvidence.pure.ts` | rule 10 | one designation, one row, and identity is PROVEN before anything merges: the context reading must name its own publisher (never the `state planning layers` fallback), carry a `sourceLayer` mapped to the instruments probe's own `kind`, and match on the publisher's name — then the publishers' own identifiers settle it, judged like for like (a feature reference against a feature reference, an instrument against an instrument) and only where both sides published one. Differing identifiers REFUSE the match and both rows stand with their own provenance; where no channel contradicts, the surviving row is filled from the suppressed one. Nothing merges across sources. |
| `planningConstraints.pure.ts` | `sourceLayer` added | the publisher's own layer id, populated at all three constructors — the only stable identifier a constraint reading has |
| `sectionRegistry.pure.ts` / `condenseCompose.pure.ts` | — | the Executive Briefing stops declaring and composing the five detailed financial chapters (`TIER_FRAMEWORK` Decision F). They contradicted the same tier's `financialModelling: false`, a projection withholding 32 modelling bindings and three master pages, and the companion note the Briefing prints on its own cover. Measured: 3,156 characters over 73 table rows, four of the five byte-identical to the Financial Analysis Report's. The score breakdown and the SWOT stay — they are the assessment the Briefing exists to carry. |
| `scripts/verify/report-pdf/measure.mjs` | — | verification only, ships nothing to production: `not assessed` leaves the sentinel family (it is a sanctioned risk level and ordinary English), and SPARSE now means a HOLE — a band with drawn content BELOW it — while a band running to the foot is a short page, counted and named |

**The behavioural change to issued grades**, and it is the point of the
release: an assessment on three or four validly scored dimensions now receives
a **qualified** score and grade, weighted proportionally over those dimensions'
original weights, instead of being withheld. Below three, nothing is published
and the report says briefly why.

**The one behavioural change to a document's contents** is the Executive
Briefing (`TIER_FRAMEWORK` Decision F): it stops carrying the five detailed
financial chapters, which its own cover already told the reader were in the
Financial Analysis Report. It applies to a Briefing produced after the deploy;
issued Briefings keep every byte.

No weight, anchor, threshold, cap, CGR figure, financial formula, loan treatment
or stored row changes anywhere in this set. The qualification travels on
`coverage.partialLabel` and the recommendation sentence — fields every surface
already reads — so **no frontend component is added or removed**.

## 2. What was deferred, and where it is

Under S5/S6 §1. Preserved in full on **`claude/deferred-condition-evidence-s5`**
(head `b98612546`); nothing in the release branch has to be undone to revive it.

`ConditionEvidencePanel`, the condition-entry dialog, `AssessmentCompletionCard`,
`conditionRecord.pure.ts` and its submission contract (both copies), the
`submitConditionRecord` / `getConditionRecords` edge operations, the generator
and scoring wiring, `assessmentCompletion.pure.ts`, the
`20261204000000_property_condition_records.sql` migration and its
isolated-cluster harness.

`docs/reports/RISK_METHOD_RECOMMENDATION.md` §0 records which half of that
recommendation stands and which is deferred.

**Nothing else is deferred.** This section covers the condition-evidence path
and the completion card under §1, and those alone. The §4 content work
(infrastructure, the educational treatment, the calibration conclusion) and the
§5 acceptance run are **in** this release — §9.1 states each one's evidence, and
§9.4 states what is genuinely blocked and on what.

## 3. Schema dependencies

**None**, and for the forward investment programme that is a **design decision
rather than a leftover**.

The one migration this branch ever carried left with the deferred work. The
programme added afterwards (§4 of S5/S6) could have been a table, an ingest
function and a pg_cron schedule in the shape of `amenity_register` — and it is
not, because `datastore_search_sql` with a bounding box answered the production
egress in **0.59 seconds** for a 25 km query. A live read in
`planning-data-service`, beside every other register, is both cheaper to
operate and the thing §4 asked for: *"prefer existing acquisition,
evidence-storage and composition mechanisms."*

`apply-migration.yml` is therefore not part of this deploy.

## 4. Deploy order

1. **Owner marks PR #2692 ready and merges** (squash or merge per repo
   convention).
2. **Automatic — edge fleet deploy.** `deploy-supabase-functions.yml` runs on
   push to `main` for `supabase/functions/**`, and because `_shared/` changed it
   deploys **all 413 functions**, not the handful this PR names. That is the
   workflow's standing behaviour, stated so the deploy's size is expected rather
   than alarming.
3. **Frontend — published separately through Lovable, and it is REQUIRED.**
   Corrected 18 Sep 2026; the earlier entry read "optional" and that was wrong.
   No component was added or removed and no application behaviour changes — but
   `render-template-pdf`'s own header says it *"accepts a pre-compiled HTML
   payload"*, and its handler reads `payload.html` with no branch that compiles
   anything itself. **The document is compiled in the browser** by
   `src/lib/reportTemplate/htmlRenderer.ts` and posted to the function, which
   runs WeasyPrint on what it was handed.

   So two of the changes in §1 reach a client's PDF only when the bundle is
   published, and the edge deploy does not carry them:

   | change | module | where it lives |
   | --- | --- | --- |
   | the PDF/UA cover `<h1>` is no longer painted | `htmlRenderer.ts` | `src/lib/reportTemplate/` |
   | a contents tier is a level whose sections open more than one page | `narrativeIndex.ts`, `blocks/toc.html.ts` | `src/lib/reportTemplate/` |

   Everything else in §1 is edge-side and ships at step 2. Publishing the
   bundle is the step that makes the two rendering fixes real; until it runs,
   new documents are drawn by the previously published compiler.

4. **The planning cache invalidates itself — nothing to run.**
   `planningAnswerVersion` goes **`c2` → `c3`** because the answer now carries
   `investmentProgramme`. The version is part of the cache key, so a `c2` row
   simply stops matching and ages out under the TTL it already has: nothing is
   migrated, deleted or rewritten, and a miss costs one re-fetch of a free,
   open-licensed register. Serving a `c2` row would report a property as having
   no funded investment near it when the programme was never asked — which is
   the fault `c2` itself exists for.

5. **Nothing else.** No migration, no template re-seed, no render-container
   change, no secret, no cron.

### 4.1 Every changed report-rendering dependency, traced

§6 asks for all of them, not only the cover and contents fixes. This is the
complete set, by where it takes effect.

| change | module | takes effect at |
| --- | --- | --- |
| the PDF/UA cover `<h1>` is no longer painted | `src/lib/reportTemplate/htmlRenderer.ts` | **bundle publish** |
| a contents tier is a level whose sections open more than one page | `src/lib/reportTemplate/narrativeIndex.ts`, `blocks/toc.html.ts` | **bundle publish** |
| unsupported claims corrected before a document is stored | `_shared/reports/investment/evidenceClaims.pure.ts` | edge deploy — `generate-investment-report`, `fork-investment-report`, `condenseCompose` |
| a gap cell removed from an at-a-glance strip on READ | `_shared/reports/investment/derivedHygiene.pure.ts` | edge deploy — and it reaches **already-stored** documents, because `presentStoredMarkdown` runs where content is read |
| the sentence splitter is total, and a citation stays with its claim | `_shared/reports/investment/scoreClaims.pure.ts` | edge deploy — changes what the existing score guard removes |
| `strategic` admitted as a QA tier; the fork validates its children | `_shared/compassQAValidator.ts` (+ the `src/lib/reports` mirror) | edge deploy; the mirror at bundle publish |
| the forward investment programme, read live | `_shared/planning/investmentProgramme.pure.ts`, `planning-data-service` | edge deploy |
| what each infrastructure finding means | `_shared/planning/infrastructureGuide.pure.ts`, `infrastructureEvidence.pure.ts` | edge deploy |
| an instrument's own reference preserved at the parser boundary | `_shared/planning/planningSources.pure.ts` | edge deploy |
| the Briefing stops composing the financial chapters | `sectionRegistry.pure.ts`, `condenseCompose.pure.ts` | edge deploy |

**Two of these reach documents that already exist**, which is unusual and is
stated so it is expected: `stripOwnGapCells` and the healed sentence splitter
both run on the READ path, so a stored report re-rendered after this release
loses a gap cell it used to draw. Nothing stored is rewritten — the change is
to what a reader is shown, which is §8 of `RUNTIME_CONSOLIDATION.md`'s rule and
the same judgement the publication-policy disclosure was recorded under.

## 5. Rollback

- **Code**: revert the merge commit on `main`; the same workflow redeploys the
  previous fleet. Nothing is entangled with data — the publication policy is
  entirely code-side and rewrites no stored row.
- **Historical results are untouched either way.** A score issued under the
  previous policy keeps its own stamp; the new policy applies to new generations
  and regenerations only. Reverting does not un-publish anything, because
  nothing was republished.
- **Frontend**: republish the previously published bundle. No component
  changed, so there is nothing to un-wire; what reverts is which compiler draws
  the document. A bundle rolled back while the edge fleet stays forward is a
  supported state — the two rendering fixes simply stop applying, and no other
  part of this release depends on them.

## 6. CI

The claim standard: checks are read on the **exact release-candidate head**
after the last push, and a check still running is reported as running, never as
passed.

**Read 18 September 2026 16:41 UTC on head
`f1fe4d5f01c4f1b9d91c7d081d22f9cdd032eecb`** — CI run 6944, `head_sha` confirmed
against the run record rather than inferred from timing. All six checks
completed `success`:

| check | conclusion |
| --- | --- |
| `verify` | success |
| `security` | success |
| `supply-chain` | success |
| `render-container` | success |
| `pdf-import-regression` | success |
| `pdf-import-release-gate` | success |

Local full suite on this head's lineage: **1,279 files / 23,752 tests passed,
25 skipped, 0 failed**, plus 5,744 in `src/lib/reports` re-run after the
acceptance-run fixes.

One check went red on the way and is recorded rather than smoothed over: on
head `02efd6edf` the `security` job failed because `deno check` found two new
type errors in `fork-investment-report` — the fork passed `'financial'` and
`'strategic'` to `runQAValidation`, and neither is a member of `QATier`. The
repository's own `tsc` covers `src` and cannot see `supabase/functions`, which
is exactly why that gate exists; it was invisible to every local check until
Deno was run (it is installed at `/root/.deno/bin/deno` and is not on `PATH`,
which is why an earlier local run reported `spawnSync deno ENOENT` and passed).
Fixed on `0143ea285`; green since.

## 7. Verification standing

Separately, per output: **implemented / tested / visually verified / released.**

| stream | implemented | tested | visually verified | released |
| --- | --- | --- | --- | --- |
| Publication policy (§4, §7) | yes | 30 specs — all 32 availability subsets against the formula, validity, genuine zero, single rounding, monotonicity, adverse dimension | n/a (server-side) | no |
| Proportional weighting leaf (§7) | yes | pinned by the above + the engine's own suites | n/a | no |
| Delivered-points ceiling removed (§8) | yes | 3 specs incl. a source-level guard that the input cannot carry it | n/a | no |
| Growth-required rule removed (§8) | yes | 2 specs; and from `gradeEligibility` 4.0.0 the B+ ceiling no longer fires on an ABSENT Growth dimension — absence alone must not reintroduce the penalty through another module, while the quality floors on a PRESENT Growth dimension are preserved | n/a | no |
| Evidence-quality vs count split (§8) | yes | doc-code pin + eligibility specs | n/a | no |
| Scope correction (§1) | yes | full suite green with the 18 paths removed | n/a | no |
| Site half retained (parcel candidates, sweep) | yes | 15 specs + live probe | n/a (no surface) | no |
| Compression investigation (§5) | n/a — analysis | measured by execution against real fixtures | n/a | n/a |
| Criteria framework (§6) | n/a — analysis | doc-code pin on the anchors it reads | n/a | n/a |
| Ownership matrix (§9) | n/a — analysis | generated from the registry by execution | n/a | n/a |
| Cover heading duplicate (§9) | yes | pinned by the renderer spec | **yes** — text layer measured on all five tiers; nothing at the origin | no |
| Contents tier rule (§9) | yes | 8 specs carrying all three measured narrative shapes | **yes** — strategic 1→12 rows, financial 1→11, Compass unchanged at 16 | no |
| Absence never drawn as a finding (§9) — **PARTLY, corrected 18 Sep** | prevention yes, correction added later | 4 specs + 13 on the corrector | **yes, twice** — 4 of 194 glance cells measured across the seven retained reports; then **the same defect found again on two rendered documents** in the acceptance run | no |
| The document never names its source (§9) | yes | 5 specs incl. a scan of every prompt line | **yes** — Briefing p4, and 4 occurrences on row `89b451f6` | no |
| Infrastructure identity before dedup (§9) | yes | 8 specs, 4 asserting what must NOT merge | n/a — no fixture carries `planningData`; found by execution | no |

### One row in that table was wrong, and this is the correction

**"Absence never drawn as a finding" was reported as done and was not.** The
earlier entry recorded a rule added to `compassDocumentContract` — which
forbids `⚠ Exact bed/bath/car details not provided` by name and quotes it
verbatim — and 4 of 194 glance cells measured. That is a **detection and a
prevention**, and the row read as a repair.

It is not the same thing. The rule reaches the MODEL, so it governs prose
written after it shipped and does nothing for a document already stored. The
acceptance run rendered nine documents and **two of them still drew exactly the
forbidden string**, because both were generated before the rule existed. The
scrub that was supposed to catch it, `stripPlaceholderRows`, could not see
them: they are neither a table row nor a bullet but cells inside a
`{{glance:}}` payload.

`stripOwnGapCells` is the correction, added 18 Sep and running on the READ
path. The row above now says "partly" and names both measurements, because a
release package that reports a detected defect as repaired is the specific
thing S5/S6 §6 asks to be corrected — and this is the instance of it.

**Genuinely remaining, and why — stated rather than implied:**

- **§9 content completion — partly done, and what is left is named.** All five
  tiers have now been rendered and read page by page
  ([`evidence/FIVE_TIER_PAGE_READ_2026-09-18.md`](./evidence/FIVE_TIER_PAGE_READ_2026-09-18.md)),
  three client-document defects found and fixed at the producer, and the
  infrastructure outlook checked against §9's four requirements line by line
  with the one gap closed. **Three things remain**, and each is a different
  kind of work rather than more of the same:
  - **Infrastructure COVERAGE** — council capital works, budget programmes and
    agency announcements are read by neither register. This is register
    acquisition, not a change to any module here, and the page already states
    all four limits on a full reading as well as an empty one.
  - **Two short pages on the Compass** (p3 68.3%, p33 77.9%), both diagnosed to
    their exact mechanism in the evidence document. p3 is Decision E working —
    the Verdict master drawn for a tier that publishes modelling the Compass
    withholds — and belongs to the open master-geometry item. p33 is the
    narrative packer at its own calibration boundary: the guard is stated in
    charged lines and the defect is in printed height. Moving it means
    re-measuring the charge model against the pinned engine across the corpus,
    which shifts page counts on every report. **Deliberately not changed here.**
  - **The educational treatment from the legacy Lot 20427 reference.** The
    navigation half is done — a 16-entry contents with per-section anchors
    replaced "The report (1)…(40)". The explanatory half exists per control
    (`planningControlGuide.pure.ts`) and is not yet a document-wide voice.
- **§10 — ten PDFs for 18 Annabelle Crescent and 262 Pallas Street, every page
  read.** Their `investment_reports` rows are not reachable from this session
  (`execute_sql` is not exposed; the alternative database routes are out of
  scope by instruction), and two of the five formats need a model call.
  The **run package is now concrete** —
  `evidence/FORK_LINEAGE_READ_2026-09-18.md`, last section: export the two
  parents as fixtures, run the two FREE forks per property (no model call at
  all — `fork-investment-report` composes deterministically), then the two
  condensations per property, which are the **only** paid step at **four model
  calls in total**, on isolated records (`client_property_id` null,
  `generated_by` null, no portal delivery, no client notification). Ten
  journeys and ten measurements cost nothing. A$0.00 spent to date against the
  A$25 limit. Everything except those four calls is authorised and ready.
- **The Growth data question is ANSWERED** (`SCORE_COMPRESSION_INVESTIGATION.md`
  §3.1a). `market_sales_medians` **is** populated and delivering: the
  generator's own logs on the intended project record
  `nsw_dcj_rent_sales` answering postcode 2155 with 10 evidence points to
  2026-03 and `qld_qgso_rlda` answering LGA Fraser Coast with 11, on 17 Sep.
  The two cohorts differ by **evidence path and generation date**, not by
  geography grain: the 11 Sep runs predate the register being wired on 15 Sep
  and show Domain answering 404 on every suburb lookup with
  `lastSuccess: "Never"`. Read through `query_logs`, which the connector does
  expose; `execute_sql` does not.
- **The two disputed anchors** (`SCORE_CRITERIA_AND_CALIBRATION.md` §3) — each
  needs a published external distribution before it moves, and neither moves
  until the Growth question above is settled.

## 8. The documents this release is judged against

| document | what it carries |
| --- | --- |
| [`SCORE_COMPRESSION_INVESTIGATION.md`](./SCORE_COMPRESSION_INVESTIGATION.md) | §5 — eight hypotheses, each with a verdict; the mechanism derived and checked against real records |
| [`SCORE_CRITERIA_AND_CALIBRATION.md`](./SCORE_CRITERIA_AND_CALIBRATION.md) | §6 — the band definitions, the shipped anchors read against them, the benchmark each dispute needs |
| [`REPORT_OWNERSHIP_MATRIX.md`](./REPORT_OWNERSHIP_MATRIX.md) | §9 — which report owns which section, with producers, read by execution |
| [`SCORING_V2_METHODOLOGY.md`](./SCORING_V2_METHODOLOGY.md) | the method, updated for the publication policy and `gradeEligibility` 4.0.0, doc-code pinned |
| [`TIER_FRAMEWORK.md`](./TIER_FRAMEWORK.md) | Decision E and Decision F — one purpose each, measured on the retained five-tier set |
| [`PLANNING_CONTROLS_IN_THE_REPORT.md`](./PLANNING_CONTROLS_IN_THE_REPORT.md) | §12 — one designation, one row, identity proven before anything merges |
| [`evidence/FORK_LINEAGE_READ_2026-09-18.md`](./evidence/FORK_LINEAGE_READ_2026-09-18.md) | §5 — one record forked into its Financial and Due Diligence children, all three read page by page, cross-suite facts compared, and the concrete run package for the ten PDFs |
| [`RISK_METHOD_RECOMMENDATION.md`](./RISK_METHOD_RECOMMENDATION.md) | §0 records what is deferred and what stands |
| [`evidence/FIVE_TIER_PAGE_READ_2026-09-18.md`](./evidence/FIVE_TIER_PAGE_READ_2026-09-18.md) | §9/§10 — all five tiers rendered and read page by page; three defects fixed at the producer; the two short Compass pages diagnosed |
| [`evidence/COVER_HEADING_DUPLICATE_2026-09-18.md`](./evidence/COVER_HEADING_DUPLICATE_2026-09-18.md) | the cover and contents defects, measured before and after |
| [`S6_ACCEPTANCE_RUN.md`](./S6_ACCEPTANCE_RUN.md) | §5 — the acceptance run: what was executed and what could not be, the two blockers with their minimum actions, nine documents and 207 pages measured, the two defects the page read found |
| [`evidence/nsw-dcj-gross-yield-distribution-2026Q2.json`](./evidence/nsw-dcj-gross-yield-distribution-2026Q2.json) | §4 — the published benchmark the calibration conclusion rests on, all 398 rows with their limitations |
| [`evidence/s6-acceptance/`](./evidence/s6-acceptance/) | the per-document journey and measurement records for all nine |

## 9. The closeout

Rewritten 18 September 2026. The estimate this replaces is kept nowhere,
because three of its five rows have been answered and a stale estimate beside a
finished item is worse than none.

### 9.1 Requirement → evidence

| requirement (S5/S6) | state | evidence |
| --- | --- | --- |
| §1 preserve scope, repairs, journey, financials, history | held | no screen, form, mandatory input or workflow added; no stored row rewritten; `reconcileStoredFinancials`, the loan ledger, CGR inputs and the Cash Flow connection untouched — §7's table and the full suite |
| §1 the approved scoring policy (5 sought, 3–4 qualified, none below 3) | held | `scorePublicationPolicy` 1.0.0 + `proportionalWeighting`, 30 specs over all 32 availability subsets |
| §2 clear the actual CI failure without skipping ownership or committing customer data | **done** | `syntheticTierRows.ts`; `tierOwnership.spec.ts` split into a committed synthetic half and a `skipIf` replay half, with an arrangement guard that the two carry identical key sets; 14 pass / 6 skip with fixtures hidden; a guard test forbids any unguarded `.verify/` read |
| §3 deduplication — identifiers confirm, absence never does | **done** | `compareIdentity` (`confirmed`/`contradicted`/`unconfirmed`); only `confirmed` suppresses; `unconfirmedDuplicateOf` retains and discloses; `id_reference` preserved at the parser boundary; 25 specs |
| §3 rule 13 — a listing is not a planning authority, but is authoritative for identity facts | **done** | split into `portal-sourced-hazard-clearance` (error) and `listing-portal-as-source` (warning); 15 specs with positive and negative cases; fork and condensation paths asserted |
| §3 a detected error is not a corrected report | **done** | `evidenceClaims.pure.ts` corrects on all three generation paths, correcting **before** validating; 21 specs; every removal filed on the row, the fork response and the hygiene block |
| §4 infrastructure from current official sources, reconciled first | **done** | QTRIP re-measured: the 2024 edition is two behind, the current one dropped `Local Government` for a midpoint, the newest is published and **empty**; live read, no migration; `investmentProgramme.spec.ts`, 37 assertions against the publisher's own committed answer |
| §4 "no equivalent dataset" ≠ "no programme" | **done** | `PROGRAMME_PUBLISHERS` names a publisher and programme for all eight jurisdictions; a test rejects any note readable as a jurisdiction publishing nothing |
| §4 distinguish relevance, proposal, approval, funding, construction, delivery | **done** | measured distance from the subject; `programmeStanding` maps narrowly and never reads funding as a start on site; `stageSentence` says a construction start is a start; `horizonCaveat` states the window |
| §4 the Lot 20427 educational treatment | **done** | `infrastructureGuide.pure.ts` — what / limitations / next action for eight finding kinds plus the not-searched absence; 12 specs, no number admitted |
| §4 conclude the calibration | **done** | benchmark sourced (NSW DCJ, 398 postcodes, median 3.41%); **anchors retained**, both reasons and both reopening conditions recorded; 398 rows on file |
| §5 ten PDFs, every page read | **nine produced, every page read; the tenth and the two named subjects are blocked** | [`S6_ACCEPTANCE_RUN.md`](./S6_ACCEPTANCE_RUN.md) — 207 pages measured, two real defects found and fixed |
| §6 one release package | this document + `S6_ACCEPTANCE_RUN.md` | — |

### 9.2 Scoring — before and after

**No score changed in this release, and that is the result rather than an
omission.**

| | before | after |
| --- | --- | --- |
| a 5-dimension assessment | published | published, unchanged |
| a 3- or 4-dimension assessment | **grade withheld** | published, **qualified** — "3 of the 5 assessment dimensions", with the proportional arithmetic |
| a 1- or 2-dimension assessment | withheld | withheld |
| `GROSS_YIELD_ANCHORS` | 4.36% at 50 points | **4.36% at 50 points — retained**, now against a published benchmark rather than a deferral |
| `WALK_ANCHORS` | corpus median mid-range | **retained**; no published distribution exists to move to |
| a stored report's score | as issued | **as issued** — nothing is recomputed or rewritten |

The expected movement on the two named subjects is **a prediction, not a
result**, exactly as §5 requires: it cannot be tested until their rows are
reachable (§9.4).

### 9.3 Preservation

| | result |
| --- | --- |
| stored scores, grades, financials | untouched — the policy applies to new generations and regenerations only, and every score keeps its own stamp |
| user edits | untouched; the journey harness asserts an edit persists through the broker on every run |
| issued PDFs | untouched; nothing republishes |
| historical rows | no migration, no backfill, no `UPDATE` |
| the one deliberate change to an existing document | a **re-rendered** report loses a gap cell it used to draw, and a re-rendered report carries the score qualification. Both are changes to what a reader is SHOWN, never to a stored byte, and both are recorded rather than left to be discovered |

### 9.4 Remaining limitations, their effect, and their disposition

| limitation | effect | disposition |
| --- | --- | --- |
| **The two subject rows are unreachable** — no `execute_sql` on the Supabase MCP server, and neither subject is among the 44 local fixtures | §5's ten PDFs on Annabelle and Pallas cannot be produced; nine on other production rows were | **blocked, one action**: expose `execute_sql`, or place the two rows under `.verify/fixtures/`. Either is sufficient. Not follow-on work — it is this requirement, waiting on access |
| **The candidate is not deployed** | fresh generation through the candidate cannot be exercised anywhere | **sequencing**: it becomes possible the moment this release is deployed, which is what the gate decides |
| **Growth is still absent on most records** | a 0.25-weight dimension carries 56% of the answer, which is the dominant cause of the clustering | **named and unblocked by this release**; it is an ingest, not a scoring change, and the calibration conclusion records that fitting anchors while it holds would fit an absence |
| **The yield benchmark is one state** | the anchor retention rests on a NSW distribution, not a national one | **stated with the decision**; a second state's published rent-and-price pair reopens it |
| **Victoria's transport feed is declared but unloaded; foreign PEP office-holders are uncovered** | pre-existing, unchanged by this release | unchanged — named here so the package is complete |

**None of these is optional follow-on work.** The first is this release's own
requirement waiting on one access change; the second resolves on deployment;
the third and fourth are named acquisitions with their impact stated. The
earlier version of this section called some of them "separable follow-on work
that should not hold this release", and that framing is withdrawn.

### 9.5 The request

The release is ready for the gate on head
`f1fe4d5f01c4f1b9d91c7d081d22f9cdd032eecb`, whose six checks are read green in
§6, with the deploy order in §4 and the rollback in §5 — **including the
browser bundle publish, which is required rather than optional** and which two
of the rendering changes depend on.

What approval does **not** cover, and is not being asked for: the ten PDFs on
the two named subjects. Those need §9.4's first row resolved, and until then
the nine documents in `S6_ACCEPTANCE_RUN.md` are what the render and
composition work is judged on.

---

## 10. The eight-section correction, 18 September 2026

§9's request stood on head `f1fe4d5f0`. It has been superseded by the owner's
eight-section instruction of the same day, which **conditionally authorises the
release** (§7) and adds correction work ahead of it. The full record of what was
measured and what changed is
**[`EIGHT_SECTION_CORRECTION.md`](./EIGHT_SECTION_CORRECTION.md)**; this section
records only what it does to the release itself.

### 10.1 What changed in the deployable surface

| Change | Reaches a client's document through | Needs |
| --- | --- | --- |
| One issuer name (`FALLBACK_COMPANY_NAME` = `PLATFORM_ISSUER_NAME`) | the closing page, the running foot, the cover lockup | edge deploy |
| Validator rules 14–16 (self-contradiction, figure basis, register cell) | `validation_flags` on generation, fork and condensation | edge deploy |
| `Weekly net position (N of 52 weeks let)` | the composed financial chapters | edge deploy |
| The fork hands one reconciled record to both producers | the Financial Analysis and the Due Diligence | edge deploy |
| The risk section's declared shape | the generator's prompt, hence new documents only | edge deploy |
| Every figure states its basis | the generator's prompt, hence new documents only | edge deploy |
| Empty columns and empty citations | **the read path**, hence every stored report | **browser bundle publish** |

The browser publish stays **required**, for the reason §4 already gives:
`render-template-pdf` takes a pre-compiled HTML payload and compiles nothing
itself.

### 10.2 Historical re-rendering

Three scrubs run where stored content is **read** — placeholders (already
shipped), empty table columns and empty citation brackets. None overwrites a
stored byte, none touches prose, and a clean document comes back
byte-identical.

Measured over all eight distinct documents in the retained corpus: **3,384
characters removed in total, 5 of 8 byte-identical, 0 grown** — and every one of
those characters is the placeholder scrub that **already shipped** (the Mitchell
Street Briefing's 2,731, the Snapshot's 570, the Due Diligence's 83). The two
rules added this round — empty columns and empty citation brackets — fire on
**none** of the eight.

So the re-render risk this release adds is, on the evidence available here,
**nil**: a stored report re-renders exactly as it did before, except for the
placeholder removal that was already live. The new rules are preventive on this
corpus and corrective on the five PDFs supplied for acceptance, which are not in
it. An earlier draft of this section implied the new rules had done that work;
it had not been measured, and when it was, they had not.

### 10.3 What the correction does NOT change

No weight, anchor, threshold, cap, CGR input or override, financial formula,
loan treatment, cash-flow connection or stored row. No screen, form, mandatory
input, navigation entry or condition-evidence surface. No branding interface,
settings workflow or Template Builder entry point. The scoring policy of §1 is
untouched, and nothing here targets a predetermined score.

### 10.4 Rollback

Unchanged in shape from §5: revert the branch's merge commit and re-publish the
previous bundle. Every change in 10.1 is additive or a one-line substitution,
and the three read-path scrubs revert to leaving stored content exactly as it
is. The correction adds no migration.

### 10.5 The remaining blocker, restated once

The ten PDFs on 18 Annabelle Crescent and 262 Pallas Street still need their
rows. `.verify/fixtures` holds 64 rows covering Cowra, Mitchell Street and
Moranbah; neither subject is among them, and this session's Supabase MCP server
exposes no `execute_sql` — **the SQL tool being unavailable or denied in this
session, not a disconnected server**. It has not been bypassed through Lovable,
another database endpoint, a deployed function or a different credential. One
action clears it: expose `execute_sql`, or place the two rows under
`.verify/fixtures/<id>/report.json`. Fresh generation additionally needs this
release deployed, which is §7's own sequence.

The Cowra and Mitchell examples the owner supplied were **rechecked rather than
avoided**: every defect in `EIGHT_SECTION_CORRECTION.md` §3 is measured on those
two subjects.

### 10.6 The pre-merge record (§7)

Written before the merge, not after it.

| | |
| --- | --- |
| **Release candidate** | `5688c488b79f51813a7455e0d30ca8c261c9d853`, merged as `6a88c3424` |
| **Branch point** | `9889ece087f4aa109428b48bf43eeabc7f4022bb` — the merge-BASE, i.e. what the branch was cut from |
| **`main` at the moment of merge** | `c86c2a4d5` (PR #2698), the merge commit's **first parent** |
| **Merge commit** | `26221e16c994ad005174676ead6b9e7ce16fd75d` |
| **Required checks on that exact head** | CI run **6953**, six of six `success`: verify, security, supply-chain, render-container, pdf-import-regression, pdf-import-release-gate. Read on the head being merged, not on an earlier one. |
| **Rollback** | `git revert -m 1 26221e16c` on `main`, then re-publish the browser bundle built from **`c86c2a4d5`**. No migration to unwind. |

**The rollback record above is a correction, and the correction matters.**

It previously named `9889ece08` in both the base row and the bundle
instruction. `9889ece08` is the merge-BASE — the commit this branch was cut
from — and `main` had moved on by four pull requests (#2695–#2698) before the
merge landed. The merge commit's first parent is `c86c2a4d5`.

`git revert -m 1` was never affected: `-m 1` reverts against parent 1, which
IS `c86c2a4d5`, whatever the record says. What was wrong is the **browser
bundle** half. Rebuilding the served bundle from `9889ece08` would have
reverted this release *and* silently discarded four unrelated pull requests
with it — a rollback that removes work nobody asked to remove is worse than no
rollback procedure at all.

**The previously deployed browser version.** The served bundle is published by
Lovable, which is a separate deployment from the Supabase functions and is not
driven by this repository's CI. Its last publish before this release is
therefore a fact about the Lovable project rather than about `main`, and it is
recorded in §10.7 below rather than inferred from a commit — inferring it from
git is exactly the mistake this correction is about.
| **Local gates** | full suite 1,285 files / 23,873 tests at the §3 commit; 8,297 report, design and component tests at the head; Deno type-check 413 entry points, 334 errors, baseline 334. |

**Fleet-wide deployment.** `supabase/functions/_shared/**` is shared server
code and the deploy workflow ships it to **every** project the fleet covers, not
to one tenant. Eight shared modules change in this release
(`documentConsistency`, `riskRegister`, `evidenceClaims`, `derivedHygiene`,
`financialChapters`, `companyBlock`, `issuerIdentity`, `compassQAValidator`
plus `compassSectionRegistry`), so the correction reaches every deployment at
once. **Testing with selected properties does not isolate a shared production
deployment**, and nothing in this release is gated on a property, a tenant or a
flag. What that means in practice:

- every clone's next generated or forked report carries validator rules 14-16
  and the labelled weekly-cash row;
- every clone's reads of stored reports gain the empty-column and
  empty-citation rules — which, measured over the retained corpus, change
  **nothing** on eight of eight documents (10.2), so this is a guard taking
  effect rather than a visible change;
- a clone that has configured no company name stops printing
  "Property Consulting" and prints **Aurixa Systems**. A clone that HAS
  configured one is untouched, which is what `whiteLabelIdentity.spec.ts`
  asserts over three organisations.

**Customer delivery and notifications stay out of the validation run**: nothing
in §8's plan publishes to a portal, emails a client or writes
`client_property_id` / `generated_by`.

### 10.7 The served browser build (§10)

Measured 19 September 2026 through the authorised Lovable API and by fetching
the published origins.

| | |
| --- | --- |
| **Lovable project** | `7976d60b-c277-4851-889b-c170285f4be2`, workspace `JqcsuFgT71nlgYSNsEMB` |
| **`is_published`** | `true`, `publish_audience: public` |
| **`latest_commit_sha`** | `6d2a9c9870eb55d29a8d5e63fe1058ab7493186e` — **current `main`**, which contains the merged release `26221e16c` |
| **`last_edited_at`** | 2026-09-19T01:00:24Z |
| **Served origin** | `https://npc-property-dashbord.lovable.app/` **302 →** `https://command-centre.npcservices.com.au/`, which answers **403** to this container's egress |
| **Lovable origins** | `…lovableproject.com/` and `id-preview--….lovable.app/` both answer **401 Unauthorized** — the preview requires a Lovable browser session |

**What this does and does not establish.** The project's working tree is at
`6d2a9c987`, so the browser code Lovable would build from is current. It does
**not** establish which commit the bundle *currently being served* was built
from: `latest_commit_sha` is the project's commit, and a project can be edited
without being published. That is precisely the gap §10 names — *"server
deployment alone does not establish that the browser-based report compiler is
current"* — and it cannot be closed from here, because every published origin
refuses this egress (403 at the WAF, 401 at Lovable's own).

The measurement this repository normally uses — fetch the bundle and grep for a
marker only the new code carries — is therefore unavailable, and no substitute
for it is sound. `latest_commit_sha` is a fact about the project, not about the
bytes a browser receives, and reporting it as the latter would be the same
class of error as reading a 200 from a preflight as evidence about the gateway.

**One human action, named once.** Open
`https://command-centre.npcservices.com.au/` in a browser signed in to the
tenant, or the Lovable editor for project `7976d60b-…`, and confirm the last
**publish** (not the last edit). If the published build predates
`26221e16c`, the browser half of the merged release is not live and a publish
is owed; the server half already is (functions deploy run **633**, `success`,
verified by effect on `fork-investment-report` v378 and
`render-investment-report-pdf` v369).

Everything else in this follow-up is unblocked by that and has proceeded.
