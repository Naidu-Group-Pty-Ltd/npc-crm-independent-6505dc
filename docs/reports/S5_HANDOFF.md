# Hand-off — the Compass Report Restructure programme

**Written 18 September 2026.** Read this first if you are picking the
programme up in a new session. It is the one document that says where the work
stands, what is decided, what is measured, what is next, and what must not be
re-derived.

Branch **`claude/adoring-hopper-g02tdt`**, 59 commits ahead of `origin/main`.
The last code commit is **`83aaa37`**; this document is the one after it.
Draft PR **#2692** ([Naidu-Group-Pty-Ltd/npc-property-dashbord#2692](https://github.com/Naidu-Group-Pty-Ltd/npc-property-dashbord/pull/2692)),
still draft. Nothing in it is released.

---

## 1 · Standing constraints — these govern everything below

Carried forward from the owner and still in force. Do not relax any of them
without an explicit instruction.

### Working method

> Work on an isolated branch. Do not deploy, change live data, run destructive
> migrations or distribute reports without explicit approval. Where access or
> tooling prevents verification, state exactly what remains unverified and the
> required next action.

* Develop on `claude/adoring-hopper-g02tdt`. Restart from `origin/main` after
  every merge. Never push elsewhere. `git push -u origin <branch>`, retrying
  only on network failure with 2/4/8/16 s backoff.
* **SELECT-only against production**, except the patterns the owner has
  explicitly authorised.
* DDL reaches production only through `apply-migration.yml` on a merged file.
* Never weaken RLS.
* Isolated test records, environment-managed secrets, a hard **A$25** test
  limit. **A$0.00 has been spent.**

### Credentials

> Do not extract secrets through diagnostic functions, print them, ask me to
> paste them into chat, or alter a working production credential.

> Never print credentials, commit them, place them in client-side code, or ask
> me to paste them into this conversation. Do not create a diagnostic endpoint
> or database function to extract an otherwise unreadable secret.

> Do not overwrite, rotate or revoke a working production key.

> Preserve the working Perplexity and Lovable configuration.

The owner's email address is never sent to a vendor and never placed in a
User-Agent.

### Attribution

Commits end with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HdDPXhNC3PekSkcvrqgjSw
```

**No model identifier appears in a commit message, PR title or body, code
comment or any other pushed artefact** — chat replies only. (The
`Co-Authored-By` trailer above is the one exception, and it is mandated.)

### Protected functionality — do NOT change

The existing CGR process is approved and must remain unchanged: CGR is
calculated *before* report generation through the existing input and
manual-override workflow, and cascades into Financial Analysis, Cash Flow and
the ten-year projections.

Do not: replace or redesign the CGR calculation; derive CGR from market CAGR;
change manual overrides or fallback behaviour; change CGR precision; change
Cash Flow formulas; change loan, LVR, interest or projection logic; change
score weights, thresholds or grade caps; rewrite existing `report_content` or
`investment_score` rows; change the picker, the selection store or
`routeReportThroughTemplate`; remove or bypass the existing
editing / saving / reopening / template / preview / export journey.

The **Templates page** remains the user-facing template-selection mechanism.
Do not route users through the old Template Builder workflow.

These front-end functions must keep working: generation, editing, saving,
reopening, template selection, changing templates, preview, download/export,
navigation, permissions, historical reports, and preservation of user edits.

### Approved report allocation — one canonical producer per fact

| report | owns | must NOT contain |
| --- | --- | --- |
| **Investment Compass** | what the property is, where it is, market evidence, named amenities, planning and infrastructure, risks, evidence limitations, educational explanation, a clear recommendation. Accepted purchase price, indicative rent, and **one** authorised gross-yield reference inside the grade rationale. | detailed acquisition costs, loan amounts, LVR, repayments, Cash Flow, net yield, owner contribution, interest-rate sensitivity, equity calculations, financial projections |
| **Financial Analysis** | everything in that second column | — |
| **Strategic / Due Diligence** | verification requirements, conditions, planning checks, holding, exit, monitoring, suitability considerations, required actions before and after purchase | — |
| **Executive Briefing**, **Snapshot** | condensed views of the above | any new calculation |

### Objective

A premium, accurate, educational, visually polished **five-report suite**
(Compass, Financial Analysis, Strategic/Due Diligence, Executive Briefing,
Snapshot) for **18 Annabelle Crescent** (primary test property) and
**262 Pallas Street**. Lot 20427 Richburg Road is the legacy structural
reference.

---

## 2 · The subjects, and the identifiers you will need

| | Annabelle | Pallas |
| --- | --- | --- |
| report id | `9bd41c05-7f9b-41e8-819a-a029f4121369` | `3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753` |
| address | 18 Annabelle Crescent, Kellyville NSW 2155 | 262 Pallas Street, Maryborough QLD 4650 |
| coordinate | −33.7115485, 150.9586199 | — |
| grade / score | F / 40 | C / 63 |
| price modelled | $1,490,000 | $575,000 |
| created | 2026-09-17 08:57:31Z | 2026-09-17 04:51:32Z |

* Production Supabase project **`dduzbchuswwbefdunfct`**; org
  `mrfuwtroeeczontuqwsz`.
* The score lives on `investment_reports.investment_score` (jsonb). **There is
  no `investment_scores` table** — asking for one is the `caseTenant` class of
  error. Read `information_schema` first, always.
* `investment_reports` has **no** `planning_evidence` column: planning
  provenance lives in `data_sources.planning` and the evidence in
  `location_intelligence`.

---

## 3 · Where the programme stands

`SUITE_DELIVERY_STATUS.md` holds the four-state matrix (implemented / tested /
visually verified / released). **Nothing is released.**

Stages S0–S4 are complete and documented:

| stage | document |
| --- | --- |
| S1 representative pages | [`S1_REPRESENTATIVE_PAGES.md`](./S1_REPRESENTATIVE_PAGES.md) |
| S2 location persistence | [`S2_LOCATION_EVIDENCE_TRACE.md`](./S2_LOCATION_EVIDENCE_TRACE.md) |
| S3 shared render path | [`S3_SHARED_PATH.md`](./S3_SHARED_PATH.md) |
| S4 planning & infrastructure | [`S4_PLANNING_AND_DEVELOPMENT.md`](./S4_PLANNING_AND_DEVELOPMENT.md), [`S4_INFRASTRUCTURE_SOURCE_COVERAGE.md`](./S4_INFRASTRUCTURE_SOURCE_COVERAGE.md) |
| S5 corrections | [`S5_CORRECTIONS.md`](./S5_CORRECTIONS.md) |
| S5 documents | [`S5_FORK_DOCUMENTS.md`](./S5_FORK_DOCUMENTS.md), [`S5_CONDENSED_DOCUMENTS.md`](./S5_CONDENSED_DOCUMENTS.md), [`S5_ARTEFACT_SET.md`](./S5_ARTEFACT_SET.md) |
| S5 execution route | [`S5_EXECUTION_ROUTE.md`](./S5_EXECUTION_ROUTE.md) |
| release position | [`RELEASE_POSITION.md`](./RELEASE_POSITION.md) |

### The last three commits, and what they closed

**`5ec3c65` — the five S5 corrections.** CGR separated from market evidence;
transport radius traced end to end; score language qualified; an evidence
window is not a holding requirement; a sales count is not liquidity.
`strategyPositions.pure.ts` is the module.

**`0805c47` — all five score dimensions are evident.**
`scoreAssessmentReading.pure.ts` reconstructs the eight readings the owner
named. See § 5 below — it is the most load-bearing finding of the last two
days.

**`83aaa37` — Risk: a retrieved control is a fact, not a rating.** See § 6.

---

## 4 · What was in flight when this hand-off was written

**Nothing is uncommitted.** The working tree is clean at `83aaa37`.

I had just begun reading for **item 3 of the owner's second instruction set**
(the transport corrections) and had made **no edits**. The three things that
item needs, with the evidence already gathered:

1. **Reconcile stored 117 against fresh 116.** The stored Annabelle transport
   block carries `stopsWithin1km: 117` with `radiusMetres: 1600`. A fresh
   measurement at the same coordinate gives **116 places ≤1,600 m** (51 ≤1,000 m,
   239 raw rows before grouping, nearest 105.9 m). The difference is almost
   certainly one place on the boundary or a `parent_station` grouping change
   between feed loads — **establish it, do not assume it**.
2. **A feed-load date is not a measurement date.**
   `transportBasis()` in `strategyPositions.pure.ts` (~line 379) currently
   says *"The feed was last loaded on `<date>`; the count is as at that
   date."* That presents the publisher's load stamp as when we measured.
   The feed loaded 2026-09-07 05:22:15Z; the enrichment ran 2026-09-17
   08:58:02Z. Suggested fix: carry `measuredAt` onto `StrategyTransport` from
   `location_intelligence.__acquisition.acquiredAt` in `readStrategyRecord`,
   and word the two dates separately.
3. **Remove the engineering diagnostic from customer wording.**
   `transportReading.pure.ts` line ~245 emits *"Service frequency is not
   measured: it requires the timetable file, which is 399 MB uncompressed for
   the NSW feed alone."* A file size is not a fact a client needs. Say what is
   not known and why, in the reader's terms. The mode sentence on line ~243 is
   already acceptable.

---

## 5 · The score assessment — what is now settled, and must not be re-derived

### The model, traced

```
COMPOSITE_WEIGHTS        growth .40  location .25  yield .15  demand .15  risk .05
adjusted weight          nominal ÷ (nominal weight of every MEASURED dimension)
breakdown[].weight       the ADJUSTED weight × 100, ROUNDED — never the nominal
compositeScore           round( Σ score × adjustedWeight )   ← rounds ONCE, on the sum
nominalMeasuredScore     Σ( score × nominalWeight )          ← the delivered-points ceiling
evidenceCoverage         Σ( nominalWeight × dimension.coverage )   ← NOT persisted
MIN_DIMENSIONS_FOR_GRADE 3
GRADE_THRESHOLDS         85 A+ · 75 A · 65 B+ · 55 B · 50 C+ · 40 C · 30 D · 0 F
```

### Both subjects reconcile exactly

| | Annabelle | Pallas |
| --- | --- | --- |
| scores | growth 56, yield 23, demand 13 | growth 77, yield 53, demand 35 |
| contributions | 32.00 + 4.93 + 2.79 = **39.71 → 40** | 44.00 + 11.36 + 7.50 = **62.86 → 63** |
| uncapped grade | **C** | **B** |
| delivered (nominal) | 22.40 + 3.45 + 1.95 = **27.80** | 30.80 + 7.95 + 5.25 = **44.00** |
| ceiling / issued | **F** / **F**, capped | **C** / **C**, capped |

The 39.4 and 62.3 the owner caught come from rounding each contribution
*first* and from multiplying by the stored integer weights. The engine rounds
once, on the sum, using exact fractions.

### What the engine computes and does NOT persist

* **`evidenceCoverage`** — the 57 % S1 reported. It is *not*
  `coverage.weightCovered` (0.70), which counts a dimension scored on 15 % of
  its inputs as a whole dimension. The per-dimension coverage is not on the
  row, so the reading **names it as not retained** rather than substituting.
* **the growth eligibility ceiling** — the A/A+ gates read growth confidence
  and growth's own weight coverage, neither stored. The nominal ceiling is
  reconstructible; where the two differ the stricter binds.

`PersistedAssessment` in `scoreAssessmentReading.pure.ts` is the forward-only
shape that closes both. **It is declared and nothing writes it yet** — that is
task #114's remainder.

### Location: our defect, fixed, unreleased

Measured over **all nine** stored reports carrying an RF-7.2B acquisition
stamp: every one records `places: complete` and `commute: measured`, six
amenity categories answered by the register, a matched address and a subject
key — and **every one carries no `walkScore`, no `commute` and no
`schools.schoolsWithin3km`**.

The readings were taken. The **Client-Safe Gate** removes exactly those three
paths — correctly, for the narrative — but the generator persisted the *gated*
object as `location_intelligence`, and the acquisition stamp survived the
removal untouched. So `assessEnrichmentReuse` saw a complete, subject-matched
acquisition and re-served the stripped copy on every resume. Annabelle's
enrichment was bought at 08:58:02Z and scored at 09:09:35Z — a later resume,
stripped object, Location null. The remedy the report printed ("regenerate the
report") reproduced the fault.

Both halves are closed in **`c0c7575`** on this branch: the generator keeps
`measuredLocationIntelligence` back from the gate, and the reuse guard
(`MEASURED_READINGS` / verdict `readings_missing`) refuses an object whose
stages ran but whose readings are gone.

**`main` does not carry it** — `git show origin/main:…/generate-investment-report/index.ts | grep -c measuredLocationIntelligence` returns **0**. That is why
the 17 September records still read *3 of 5*. Releasing this branch takes it to
**4 of 5**. The repair reaches a stored row on its next generation; no
migration touches a row.

---

## 6 · Risk — the recorded position, and the one decision that is the owner's

`propertyRiskSchema.pure.ts` declared every property-risk question `not_held`
on evidence measured 8 September 2026. Two of those went stale.

**What changed.** The planning programme retrieves site hazard and planning
constraints at parcel grain now. Annabelle carries a real reading:
`R2 — Low Density Residential`, NSW Planning Portal Principal Planning Layers,
CC BY 4.0, effective 2026-08-07, retrieved 2026-09-17T08:58:23.845Z,
confidence 0.9, `zoneStatus: stated`. (Pallas reads `zoneStatus: not_served`
for QLD — *not searched*, which is a different sentence from *nothing found*.)

**Why it still does not score — CORRECTED 18 Sep 2026.** This section first
read that the obstacle was a scale *"no publisher issues"*, and that what was
outstanding was a published **scale** rather than a dataset. **That was wrong.**
An internal methodology does not need a government publisher to supply a
ready-made 0-100 score; it needs a defensible, documented and versioned basis,
and this platform writes those routinely (`OVERHEATING_ANCHORS`,
`SEVERITY_DEDUCTION`). Stating otherwise put a whole evidence class
permanently out of reach on a premise nobody had tested, and it is why this
dimension was reported as a methodology limit when it is an evidence gap.

The real obstacle is narrower and survives: the retrieval is an **identify at a
single coordinate**, and an address-point query is never clearance for a
parcel. A layer that misses the point may still cross the lot, and a hazard the
publisher has not mapped is not a hazard the parcel lacks — so scoring the
absence would be § 9's "an absence may not be RATED". That is a defect of the
QUERY, not of the evidence class, and it is closeable: measured 18 Sep 2026,
Queensland's cadastre answers a parcel polygon (`2RP87802`, HTTP 200, 1.6 s at
the Pallas coordinate) while NSW's `NSW_Cadastre/9 (Lot)` declares `Query`,
answers metadata in 1.2 s and returned nothing within 40 s on two attempts —
not tested from the production egress. *(Superseded later the same day by
the fuller probe behind `parcelGeometry.pure.ts` —
`RISK_METHOD_RECOMMENDATION.md` §6a and `PARCEL_PROBE_2026-09-18.json` are
the current record, including the finding that two geocodes of one address
resolved two different lots.)*

Both questions therefore stay `held_but_unscoreable`: evidence on the page,
zero points. `unscoreableHoldings()` is that second list; `answerableCount()`
stays **0** for all four asset classes, because a capability nothing delivers
may not be declared. What is outstanding for them is a **parcel-grain query**,
not a published scale.

**The parcel query alone would not be enough.** Hazard and planning are ONE
independent category (`site`). The reason given here was *"they answer or fail
together"* — **also corrected**: the probe disproves it, since NSW's Principal
Planning Layers answered with an intersection on 18 Sep 2026 while its Hazard
and Protection services answered with none, from three endpoints that fail
independently. The grouping is right for a different reason and stays: both
readings describe **the same site**, so they are two facts about one thing
rather than two independent observations. `MINIMUM_INDEPENDENT_CATEGORIES` is 2
and is untouched.

The only other category an established house's schema offers is `building` →
`condition_and_maintenance`. **The construction-year measurement here was also
incomplete**: it checked `yearBuilt`, `buildYear`, `constructionYear` and
`yearOfConstruction` and never checked **`year_built`**, the snake_case
spelling the platform actually writes — present on **1,102 of 1,230** rows. The
conclusion survives (it is an explicit JSON null on every one of them, so 0
carry a value), but the claim that construction years are *absent everywhere*
does not: **32 rows across 19 properties carry
`manual_overrides.constructionYear`**, none with a source or reason field, 31 of
them a completion expectation (`2025`, `2026`, one `2031`) rather than an
observed build date. The single historical value, `1941`, is on 262 Pallas
Street and nothing else in the corpus.

**The decision — SUPERSEDED 18 Sep 2026 by
[`RISK_METHOD_RECOMMENDATION.md`](./RISK_METHOD_RECOMMENDATION.md).** This
section offered a menu of three routes and said *"four of five scored is the
honest maximum"*. **Four scored dimensions is not an accepted final outcome**,
and the menu is replaced by ONE recommended method with its implementation,
validation evidence and limitations.

The recommendation is a **recorded condition record** — a building inspection
report, strata report, building certificate or vendor's statement, with its
issuer, its date and what it examined — because it is the one class of
property-level condition evidence whose *negative* is admissible: a qualified
person examined a recorded scope and reported, so "no major defect recorded" is
a determination about the dwelling rather than a silence in a register.

The construction-year route was **built and tested as a separately named
candidate** (`constructionAgeCandidate.pure.ts`) and is **not recommended**:
four of the six required demonstrations are not met, and activating it would
complete 262 Pallas Street's fifth dimension and not 18 Annabelle Crescent's,
on an unsourced typed number. Route 3 — lowering
`MINIMUM_INDEPENDENT_CATEGORIES` — remains refused.

What is asked of the owner is in § 7 of that document: **Approval A**, build the
evidence-submission path; **Approval B**, activate the conversion.
`CONDITION_METHOD_ACTIVATION` ships as `null` and a test asserts it. Until a
record exists **for a given property**, that property's Risk is not assessable
and four scored dimensions is correct *for that property*, with a named,
closeable reason — not a platform-wide limit.

---

## 7 · What remains, item by item

From the owner's second instruction set (seven items). Items 1 and the
score half of 4 are done; the rest are open.

| # | item | state |
| --- | --- | --- |
| 1 | Correct the assessment presentation without changing the method | **done** (`0805c47`), except persisting `PersistedAssessment` forward-only — task #114 |
| 2 | Reconcile evidence across S5-A and S5-F | **open** — see below |
| 3 | Finish the transport correction | **open** — § 4 above has the evidence and the three edits |
| 4 | Close remaining narrative defects | **mostly done** in `5ec3c65` (4a–4d). Open: matching CGR / market growth must not be classified as an Opportunity; validate the Pallas rate-sensitivity and break-even-rent wording against the financial engine; re-scope the CGR regression so the accepted CGR controls projections while the historical figure may still appear in its labelled market context |
| 5 | Complete the five-report integration showing all five separately | **open** — tasks #103, #105 |
| 6 | Prepare executable validation (CI workflow, test config, isolated data, cleanup, evidence collection); pre-run verification; mark R1–R12 by actual dependency | **open** — tasks #98, #108, #111 |
| 7 | Prepare S6 (release manifest, component/template inventory, deployment order, historical compatibility, rollback); resolve detached headings and table fragments including S5-A page 12; internal review prompt pages must not appear in customer reports; keep PR #2692 in draft | **open** — tasks #112, #90 |

### Item 2 in detail — three known contradictions

1. **S5-A states benchmark comparisons while S5-F says "no benchmark is
   held".** Both are drawn from the same record. Establish which is right and
   make one module answer it.
2. **Pallas: 71 periods vs 53.** The stored growth evidence says *"Consistency
   of growth: 43 of 71 periods rose"* while the market-evidence block reports
   53. Reconcile; do not average.
3. **The pinned yield prohibition is over-broad.** It must retain the
   authorised exception: one gross-yield reference inside the Compass's grade
   rationale. (A test already asserts *exactly one*, inside the table —
   `strategyPositions.spec.ts`.)

Historical records are preserved throughout: nothing rewrites a stored
`report_content` or `investment_score` row.

---

## 8 · Facts established by measurement — do not re-derive these

| fact | value | how established |
| --- | --- | --- |
| stored `breakdown[].weight` | the **adjusted** weight × 100 | traced through `shadowScorer.pure.ts` + reproduced on two production rows |
| construction year in `property_specs` | **0 of 1,230** carry a value (`year_built` present as JSON null on 1,102) | SQL over `investment_reports.property_specs`, 18 Sep 2026 |
| construction year anywhere | **32 rows / 19 properties** in `manual_overrides.constructionYear`, 0 with provenance, 31 completion expectations | SQL over `investment_reports.manual_overrides`, 18 Sep 2026 |
| stamped enrichments missing all three location readings | **9 of 9** | SQL over `location_intelligence` |
| `NEARBY_RADIUS_M` | **1,600 m** | `transportReading.pure.ts` |
| `stopsWithin1km` | a **deprecated name** holding the 1,600 m count | same |
| correct reader | `transportCountReading()` | same |
| Annabelle transport | 51 places ≤1,000 m, **116 ≤1,600 m**, 239 raw rows, nearest 105.9 m | fresh measurement |
| feed `nsw_sydney` | loaded 2026-09-07 05:22:15Z, 171,061 stops, "Transport for NSW Open Data (CC BY 4.0)" | same |
| deployed `location-intelligence-service` | v370, 2026-09-16 05:37:36Z | Supabase MCP |
| Annabelle planning | R2, NSW Principal Planning Layers, CC BY 4.0, eff. 2026-08-07 | `data_sources.planning` |
| Pallas planning | `zoneStatus: not_served` (QLD) | same |

### Environment traps

* **~~The sandbox has no web egress.~~ CORRECTED 18 Sep 2026 — it does.**
  This read that the proxy denied CONNECT to every web host (403),
  `example.com` included, and that was why the register probes had never been
  run. Re-measured: `example.com`, all six state planning services, the
  Queensland cadastre and the NSW cadastre's service metadata all answer
  **HTTP 200**. The six-register probe in
  `docs/reports/evidence/PLANNING_PROBE_2026-09-18.json` was run from here.
  **MCP servers still work** and remain how production is reached.
* Consequently **`npm run security:edge-check` cannot run here** — it needs
  `deno.land`. CI runs it. Say so rather than claiming it passed.
* `npm run lint` takes several minutes; run it in the background.
* WeasyPrint 69.0 is available locally; `scripts/reports/renderWeasy.py`
  mirrors the production print contract (pdf/ua-1, tagged, sRGB,
  `optimize_images`, custom metadata). Cinzel, Playfair Display, Inter and
  IBM Plex Mono are installed.
* **`npm run lint` is red on this repository and always has been.** Measured
  18 Sep 2026 on `02e9d30`: **46 errors and 3,202 warnings across 32 files**.
  None of them is in work done for this programme — the one intersection is
  `propertyRiskSchema.pure.ts`'s `no-fallthrough` (a comment between two `case`
  labels), which is on `main` and moved line only because text was added above
  it. Judge a change by whether it ADDS to that baseline, the way
  `npm run audit:style` is judged, and do not "fix" the baseline as part of
  unrelated work.

---

## 9 · Working rules learned the hard way in this programme

These cost a cycle each. They are not style preferences.

* **Read the rendered output, not the assertions.** Reading the drawn
  grade-rationale block found two defects the 57 green tests could not: a
  600-character evidence cell in a seven-column print table, and a note that
  described its own position on the page.
* **A fixture comes from a production row, verbatim.** A sample written in the
  consumer's own vocabulary passes while production is empty — that is how two
  formats shipped a cover with no title.
* **Derive, never accept as a parameter,** anything the callee can compute
  from what it already holds. A parameter a caller forgets takes a whole
  section off the page with nothing reporting it.
* **Two production subjects, not one.** One row can be reproduced by
  coincidence.
* **A capability nothing delivers may not be declared.** Flipping an
  availability flag without wiring the answer is the `builderPortalUiMounted`
  defect.
* **An absence may not be rated,** and a retrieval is not information.
* **`Not assessed` is a level; Low, Minimal, Limited, Negligible and
  Favourable are not.**
* **Never name a column the table does not have** — PostgREST answers 42703,
  the discarded error leaves `data` null, and the handler reports "not found"
  about a row that exists. Check `information_schema` first.
* A test pins **the rule**, not the string, wherever it can.

---

## 10 · How to resume

1. `git fetch origin && git checkout claude/adoring-hopper-g02tdt` (HEAD should
   be `83aaa37`).
2. Read § 1 and treat it as binding.
3. Check the task list (#89, #90, #98, #103, #105, #107–#115 are the open ones).
4. Pick up at **§ 4** — the transport item is the next concrete piece of work,
   with its evidence already gathered and no edits made.
5. Keep PR #2692 in draft. Release remains subject to the owner's approval
   gate.

**Open question awaiting the owner:** § 6's three options for the fifth scored
dimension.

---

## Appendix · The open task list, as at 18 September 2026

Reproduced here because a new session may not inherit the task store. Every
other task in the programme (1–88, 91–97, 99–102, 104, 106, 110) is complete.

| # | task | note |
| --- | --- | --- |
| 89 | **S5** — full suite and frontend journey verification | the parent of the S5-x items below |
| 90 | **S6** — production release package for approval | blocked until S5 closes |
| 98 | **S5-3** frontend journey — the three writing steps | blocked on authorisation; see [`S5_ISOLATED_RUN_REQUEST.md`](./S5_ISOLATED_RUN_REQUEST.md) |
| 103 | **S5-B** substantive ten-year infrastructure outlook on the approved evidence approach | |
| 105 | **S5-D** real Briefing and Snapshot condensation, replacing the named stand-in | |
| 107 | **S5-G** protect CGR and the financial cascade through a real run | |
| 108 | **S5-H** exercise the six known failure cases through the supported workflow | |
| 109 | **S5-I** reconcile 16 vs 21 layers, and the five deployment distinctions | |
| 111 | **S5-K** the ten PDFs, R1–R12, every page read | |
| 112 | **S6** release package, prepared but not released | |
| 113 | non-production runtime: one owner action (credentials are fine) | |
| 114 | **S5-L** five dimensions always evident — the assessment reading | done except persisting `PersistedAssessment` forward-only |
| 115 | **S5-M** the fifth dimension needs an acquisition or an owner decision | **blocked on the owner** — § 6 |

Plus the three unticketed pieces of work in § 4 (transport) and § 7 item 2
(evidence reconciliation) and item 4 (the three remaining narrative defects).
