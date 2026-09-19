# Reporting Engine audit — state of play and handover

**As at 2026-09-09.** Written to be picked up cold by a different agent or engineer.
Read this first, then the audit sections it points at. Nothing here restates
what the audit already records; it says **where the work stands, what is
blocked, and what must not be broken**.

---

## 1. The governing doctrine

One rule sits above everything else in this programme:

> **If a figure can be produced deterministically from the system record, the
> model must never be asked to calculate, guess, transcribe or recreate it.**

Three corollaries that have each been paid for at least once:

- **Absent is absent** — never `0`, never `50`, never a placeholder. A derived
  figure whose basis is missing is itself missing.
- **An observation is not a dimension** — a fact about one thing does not
  become a score for another.
- **Configuration is not reachability** — a source that is catalogued,
  credentialled and documented may still never have answered. Measure it.

### Standing constraints (do not relax without the owner's word)

- Do not replace functioning infrastructure to make architecture cleaner.
- Do not perform unrelated refactoring. Do not remove existing functionality.
- Prefer real generated reports as evidence over theoretical code analysis.
- **Grades: A = 75, A+ = 85.** Do not lower thresholds. Do not target a
  predetermined A/A+ percentage.
- No property-type bonus or penalty; no state premium; no buyer financing
  inside property quality; no missing-data neutral defaults.
- **Scoring V2 is not wired into production or live report generation.**
- No fabricated or synthetic market evidence. No LLM-created values. No
  model-written narrative as a financial source fact. Do not ask an LLM to
  determine geography.
- Do not scrape realestate.com.au, SQM, or journey-planner websites.
- Do not rewrite historical issued reports or corrupted historical addresses.
- Do not run an irreversible mass backfill on historical reports.
- Never expose credential values — presence only, never a value, length or
  prefix. `INTERNAL_EDGE_SECRET` is never held or transited.
- WA SLIP planning data is never fetched (licence bars commercial
  republication).
- A probe must never take a URL from the request body — that is SSRF in a
  function holding service-role credentials.
- Never disable TLS verification or unset `HTTPS_PROXY`.
- Do not manually bypass deployment controls.

---

## 2. Where the work is right now

The branch is **`claude/reporting-engine-audit-4850hs`** and the open PR is
**#2578**. Head SHA, base SHA and CI state move with every push and every
transient, so **read them from the PR, not from this file** — this file went
stale on those three facts twice in its first day. What this file records is
what does *not* move: the decisions, the measurements, and the two commits
that carry the actual work.

The **code content** of the branch is two commits (everything after them is
documentation and merges of `main`):

1. `dc08be5e5` — ME-6 zero-cost evidence strategy (audit §64)
2. `b0185fc92` — ME-6 closure: one Growth denominator, frozen ME-7 population (audit §65)

Everything below §64 in the audit document **is** merged and live.

Two CI episodes hit this PR on 9 Sep and **both are closed**; neither was this
PR's, and both are recorded so a successor does not re-diagnose them:

- **`supply-chain`** — two new `@tiptap/core` advisories; fixed on `main` by
  #2579 and taken here by merging `main`. §3.1 has the detail, including the
  correction to the first diagnosis.
- **`render-container`** — `dl.google.com` served an apt `Release` file whose
  recorded hash for `Packages.gz` did not match the file it was serving, so
  `apt-get update` failed and `pdffonts` (the assertion tool, installed one
  line later) was never installed. Everything the job *tests* passed both
  times. Deterministic across two runs (identical hashes), so it was a
  publisher fault, not a flake; Google republished a consistent index on
  10 Sep (verified by fetching and hashing both files) and the check passes
  again. The one-line hardening that would immunise the step —
  `apt-get update -qq -o Dir::Etc::SourceParts=/dev/null`, so a third-party
  repo the job never uses cannot kill an install from Ubuntu's archive — is
  proposed in PR #2578's `issuecomment-5606444180` and deliberately **not**
  pushed into an evidence-layer PR; it is the owner's to take.

---

## 3. Blockers, in the order that unblocks the most

### 3.1 `supply-chain` — RESOLVED on `main`, 9 Sep (kept for the lesson)

Two advisories were published against `@tiptap/core@3.26.1` on 9 Sep —
`GHSA-cp6q-959q-f8rh` (`mergeAttributes()` turns an own `__proto__` key into
inherited executable DOM attributes) and `GHSA-j95f-988m-3j2f` (quadratic
ReDoS in Markdown attribute parsing, `>=3.7.0 <3.30.5`). Both are `high`,
neither was on the allowlist, so the gate failed on every PR in the repo,
`main` included.

**Fixed by PR #2579**, merged into `main` at 12:05Z: `@tiptap/core` is now
`3.31.3`, hoisted to a single copy. This branch took it by merging `main`
(`31ddd12fe`), and `node scripts/security/dependency-audit.mjs` at
`SECURITY_AUDIT_LEVEL=high` now exits 0 — 10 findings, 3 `high`, all three
(`image-size`, `pptxgenjs`, `vite`) already on the allowlist with a reason and
a review date.

**Two things here are worth carrying forward.**

**The diagnosis in `issuecomment-5595294197` was wrong on its central claim.**
It said 28 packages peer-depend on *exactly* `3.26.1` and that core therefore
could not move without an `overrides` block. It could. The real cause was a
**stale lockfile holding four separate `@tiptap/core` copies** (`3.26.1`,
`3.30.2`, `3.30.0`, `3.26.1`) — which is why `npm update` appeared to do
nothing useful: it refreshed one of the four. `tldraw` and `@tldraw/editor`
both ask for `^3.12.1`, a range that already admitted every fixed version, so
dropping every `@tiptap/*` entry and re-resolving with
`npm install --package-lock-only` collapsed them into one hoisted `3.31.3`
with **`package.json` untouched and no `overrides` introduced**. The lesson is
a familiar one in this programme: *a version that will not move* and *a
lockfile with several copies of it* look identical from the outside, and only
one of them needs a declared pin.

**The allowlist was still the wrong move, and that judgement stands.**
Accepting a high-severity prototype-pollution and ReDoS advisory is a security
decision with an owner, and the correct fix turned out to cost one re-resolve.
Making a gate go green by telling it something convenient would have left the
vulnerability in place and the record saying it was accepted.

### 3.2 PR #2578 is a draft

Mark it ready for review; the merge button does nothing on a draft.

### 3.3 The two vendor questions — the only route to ME-7

Both are drafted and ready to send. Neither can be answered from inside the
repository, and **neither may be assumed, inferred or substituted**.

- `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md` — the lead question is
  whether `api_properties_read` and `api_suburbperformance_read` can be enabled
  on the **existing** Aurixa application **at no additional charge**. The
  probe's one run (§3.4) selected the letter's **both-403 branch**: that is
  the message to send.
- `docs/integrations/PROPTRACK_TRIAL_REQUEST.md` — 12 questions on the official
  API trial, each mapped mechanically onto an `EvidenceAcquisition` value.

### 3.4 The Domain probe has been run — once — and its answer is the ambiguous case

`market-source-probe` was run exactly **once**, from `/integrations`, on
**2026-09-08 at 15:42:54 UTC** — 28 minutes after #2575 deployed the corrected
function. The run is verified in the production function logs, not assumed:
`function_edge_logs` holds exactly one non-OPTIONS invocation in the whole
retained window (`POST | 200`, 3,331 ms), and the probe persists nothing by
design, so the readings below are the operator surface's rendering of that one
response.

- `DOMAIN_API_KEY` present; Domain configured/testable;
- `domain_address_suggest` → **403**;
- `domain_v2_suburb_performance` → **403**;
- **no `X-Domain-Security-Reason`** on either refusal;
- Cotality credentials absent; PropTrack credentials absent; SQM not
  authorised for automated ingestion.

The four-case reading is **pre-registered** and was not re-derived after
seeing the result — `domain_address_suggest` against
`domain_v2_suburb_performance`:

| suggest | suburb performance | conclusion |
| --- | --- | --- |
| 2xx | 2xx | key valid, both entitled — conclusive |
| 2xx | 403 | key valid, Suburb Performance not entitled — names the commercial ask |
| 401 | 401 | key not accepted at all — operator-side, **not** entitlement |
| 403 | 403 | **ambiguous, stays ambiguous** — no owner assigned |

Entitlement is never inferred from a 403 alone. A government 403 is never an
entitlement finding. This run is the fourth row: **ambiguous, and it stays
ambiguous** — entitlement, an invalid key, a WAF and a missing scope were each
deliberately not inferred, because with no security-reason header nothing on
the wire distinguishes them.

**The probe's question is answered and it does not need running again** unless
Domain configuration changes (a new key, an activated scope, an account
change) — one run then re-settles the state. The cause is resolved by Domain's
answer to `DOMAIN_ACTIVATION_REQUEST.md` (its both-403 branch), not by another
click. Audit §66 is the full record.

---

## 4. The canonical facts a successor must not re-derive

### 4.1 The Growth-ready population is 665 of 867

Predicate `me7.pop.1`, in
`supabase/functions/_shared/reports/market/growthPopulation.pure.ts`. **No
second component may define "Growth-addressable".**

The audit previously carried two numbers, 641 and 663. They are the same
predicate with and without one exclusion:

| step | count |
| --- | ---: |
| trusted geography (suburb AND state) | 867 |
| `property_specs.property_type`, non-placeholder | 663 |
| less `land` (26) | 637 |
| plus §62.4's 4 sibling recoveries | 641 |

**663 was too loose** (a land parcel has no dwelling, so no house/unit median
series describes it). **641 was too narrow** (one field; two further
deterministic routes sat unused).

Canonical:

| route | reports |
| --- | ---: |
| `property_specs.property_type` | 663 |
| `financial_calculations.propertySpecs.propertyType` | +15 (all `house`, operator-stated) |
| unambiguous sibling on `canonical_property_key` | +13 |
| any type resolved | 691 |
| less `land` | −26 |
| **canonical** | **665** |

**Requires**: trusted geography, and a dwelling type mapping to a class a
provider publishes (`house` or `attached`).
**Does not require**: LVR, cash flow, rent, Risk, composite readiness, or
postcode. Sibling recovery is a **route**, never a requirement.

Distribution:

| state | ready | houses | attached |
| --- | ---: | ---: | ---: |
| QLD | 338 | 278 | 60 |
| WA | 137 | 89 | 48 |
| VIC | 131 | 120 | 11 |
| NSW | 40 | 31 | 9 |
| SA/TAS/ACT/NT | 19 | 18 | 1 |
| **total** | **665** | **536** | **129** |

228 distinct suburbs. QLD + WA = 475 (71%).

### 4.2 The population is frozen in the database

`me7_backtest_populations` / `me7_backtest_population_members`, sealed under
`me7.pop.1`, 867 members / 665 included. Immutability mirrors
`market_evidence_snapshots` — draft → sealed once, no unseal, UPDATE and DELETE
refused on a sealed row and its members. Both refusals proven by execution.

**The rule it enforces**: provider coverage is measured **against** the
population and never defines it. Otherwise a provider outage shrinks the
denominator and the coverage percentage *improves* under exactly the fault it
should reveal.

### 4.3 The zero-cost finding: the open data is not where the properties are

Measured 2026-09-08 from **two** networks — this repository's development
container and the **production Supabase egress via `pg_net`**.

- **QLD (50.8%)** — QGSO's housing theme is building approvals. No open
  suburb-level median sale price series.
- **WA (20.6%)** — Landgate's only candidate is `Custom (Other)` licensed.
- **VIC (19.7%)** — publishes exactly the right dataset (median house and unit
  by suburb, quarterly, dwelling-segmented, CC BY 3.0 AU) and
  `land.vic.gov.au` answers a Cloudflare interstitial (403) to **both**
  egresses. Licence permits what transport denies.
- **ABS** — all 1,227 dataflows enumerated. `RES_DWELL_ST` is state grain,
  `RPPI` capital-city. **None** carries suburb-level price.

Recorded as data in `zeroCostSources.pure.ts`, where `licence` and
`reachability` are **separate fields that are never inferred from one
another** — a licensing gap needs a commercial conversation, a transport gap
needs the publisher contacted, and reporting one as the other sends somebody to
the wrong door.

**SQM**: `manual/context only — automated commercial ingestion not authorised`.
Its terms prohibit automated retrieval; that is considered policy rather than a
generic bot rule, and it is the one source that was deliberately not retried.

### 4.4 Evidence acquisition footing

`EvidencePoint.acquisition`, orthogonal to `licensingStatus`. Licensing asks
*may this be printed for a client*; acquisition asks *on what footing do we
hold it at all*, and that decides production eligibility.

`open_public` · `existing_licensed` · `trial_shadow_only` ·
`commercial_upgrade_required` · `licensing_unverified` (**default**)

Three rules, all tested: the default is conservative; a trial may be
shadow-scored and never rendered; `acquisitionLicensingConflict` refuses
contradictory combinations. **Provider name and point shape never override the
footing** — an ABS point with no declared footing is still not production
evidence.

---

### 4.5 Scoring V2 Core is FROZEN — shadow only

**Frozen 11 Sep 2026 (audit §68), merged to `main` in PR #2588 (merge commit
`db59a8056`).** The core — composition, ownership, the five dimension
methodologies, Finance Suitability separation, missing-evidence behaviour,
both eligibility ceilings, A 75 / A+ 85, the output contract, and the three
test suites (invariants, scenarios, closure) — is structurally complete.
Changing any of it now requires a demonstrated defect, a version bump and a
backtest re-run. Explicitly NOT complete: the ME-7 real backtest, empirical
calibration, production activation (ME-8) and any migration of production
reports — the programme is not "production complete" and must not be called
that. Reporting work builds against `scoreOutputContract` without making the
engine authoritative.

As of 11 Sep (audit §67): the composition is `2.1.0-shadow` — Risk is Model D
(property type selects the schema and scores nothing; buyer LVR and cash flow
score nothing anywhere; one observation never becomes the dimension; Risk is
therefore structurally null until property-risk evidence exists), the buyer's
position is the separate Finance Suitability reading, and eligibility `2.0.0`
adds the delivered-points ceiling so a missing dimension can never lift the
printed grade (found and fixed by fixture — audit §67.2 has the calibration
record). `SCORING_V2_METHODOLOGY.md` is the one authoritative spec, pinned to
the code by `scoringMethodology.spec.ts`, which also asserts the engine is
unwired from every production entrypoint. The canonical consumer object is
`scoreOutputContract.pure.ts` (`1.0.0`); no renderer recalculates. Measured
ceilings: max deliverable ≈ 89 of 100 nominal points today, so A+ (85) is
reachable only on genuinely exceptional evidence across Growth, Location,
Yield and Demand. **Do not re-litigate these; extend them through their
versions.**

### 4.6 The Scoring Accuracy $0 programme is CLOSED

**Closed 11 Sep 2026 (audit §69), merged to `main` as `11920f1e7`** (PR #2596,
after #2594 and #2588). Do not reopen scoring unless a genuine defect is
discovered or actual V2 activation is separately authorised.

What the corpus replays measured, read-only: Growth and Demand scored a
constant **50 on 1,005 of 1,006** reports with `hasData: false` on all 1,006,
so **55% of every grade this platform ever issued was a placeholder**; under
the trusted-input gate Location collapses from 975 to **0** (walk score
reproduces a per-state constant on 1,109 of 1,114, commute averages 10,125
minutes with 494 non-NSW reports routed to Sydney, schools sit at the ceiling
on 851 of 1,114) while Yield rises to 188 through operator-entry recovery;
**0 of 1,006** reports are grade-eligible under frozen V2. No V2 defect was
found by any replay.

The closing state, which a successor must not quietly move:

| Item | State |
| --- | --- |
| Historical V1 snapshots | PRESERVED — no rewrite, recompute, migration or backfill |
| New V1 overall score / grade | NOT AUTHORITATIVE — withheld, never a letter and never a zero |
| New V1 dimension assessments | NOT AUTHORITATIVE under `unavailable` authority |
| New V1 score-derived qualitative verdicts | NOT AUTHORITATIVE — `claimPermits` gates every SWOT claim |
| Trusted deterministic metrics | AVAILABLE and unchanged |
| Buyer finance (LVR, holding cash flow) | FINANCE SUITABILITY ONLY — admitted to no dimension |
| Scoring V2 | FROZEN / UNWIRED (§4.5) |
| Future V2 activation | MUST WIRE THE ACTUAL V2 ENGINE and consume its output contract |
| Empirical calibration | DEFERRED — ME-7 has not run |
| Historical rewrite | NONE |

**Activation is structurally not a constant edit.**
`LegacyScoringAuthority = Exclude<ScoringAuthority, 'v2'>` types both
`PRODUCTION_SCORING_AUTHORITY` and `policyStamp`'s parameter, so relabelling
the legacy service is `TS2322`/`TS2345` rather than a config change. That is
deliberate: relabelling V1 would authorise V1's arithmetic under V2's name,
which is worse than the unsupported grade this programme removed.

Two questions stay apart and in this order — **ownership** (does the dimension
own this input at all?) then **trust** (is the value believable?), and, prior
to both, **authority** (which engine may speak?). A grade issues only when
authority and evidence both hold.

## 5. ME-7 entry gate — the go/no-go

`me7EntryGate.pure.ts`. ME-7 may begin only when **all** hold:

- the population manifest is sealed;
- **QLD and WA both have subject Growth evidence** (they are 475 of 665, so a
  VIC/NSW-only sample validates the methodology against 26% of the portfolio
  while reporting a number about the other 74%);
- at least one dwelling class is represented;
- an acquisition footing is recorded and is not universally
  `commercial_upgrade_required`;
- the evidence snapshot is sealed and reproducible.

Explicitly **not** required: 100% corpus coverage, a complete Demand dataset,
Victoria specifically, or postcode-level evidence.

Evidence precedence (also in that module):

- **Subject Growth**: Domain-at-$0 → PropTrack trial → open state suburb series → **unavailable**
- **Demand**: provider/open → government context → **unavailable**
- **ABS regional/state data is never subject Growth** — `mayServeSubjectGrowth`
  refuses it by name. It is a benchmark.

### Current answer: **No — do not start ME-7.**

Measured: **0 evidence snapshots, 0 evidence records.** Growth coverage
**0 / 665**. Demand coverage **0 / 665**.

> **ME-7 cannot be run representatively under the zero-spend constraint with
> the currently accessible evidence.**

It becomes runnable the moment **either** Domain activates the two scopes at no
charge **or** PropTrack grants a trial permitting internal evaluation. Do not
create a substitute.

---

## 6. Where the detail lives

The full audit is `docs/reports/REPORTING_ENGINE_AUDIT_2026_09.md` (7,389
lines). The ME-programme sections:

| § | subject |
| --- | --- |
| §54 | Provider discovery closes — PropTrack, SQM, final hierarchy |
| §55 | ME-4 — scoring integration hardening, backtest readiness |
| §56–58 | ME-5 — canonical geography, Location evidence, centre selection |
| §59–60 | ME-5.1 — correcting Risk, the provider activation pack |
| §61 | ME-6 — real market evidence activation |
| §62 | ME-6 — first authoritative runtime result, and the classification defect it exposed |
| §63 | ME-6 — one trustworthy Domain diagnostic |
| **§64** | **ME-6 — zero-cost evidence strategy** (on the branch, not yet merged) |
| **§65** | **ME-6 closure — one denominator, frozen population** (on the branch) |

Integration requests: `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md`,
`docs/integrations/PROPTRACK_TRIAL_REQUEST.md`.

Key modules under `supabase/functions/_shared/reports/market/`:
`growthPopulation` · `me7EntryGate` · `zeroCostSources` · `marketEvidence` ·
`evidenceSnapshot` · `evidenceQuality` · `evidenceSampleFrame` ·
`sourceProbeReading` · `growth/growthPeriods` · `shadowScorer` ·
`backtestInput` · `backtestHarness`.

**Bridge contract**: every `supabase/functions/_shared/**/*.pure.ts` needs a
one-line `src/lib/**/*.pure.ts` re-export. CI enforces it.

---

## 7. How to verify before pushing

CI has **two separate job step lists** — `verify` and `security` — **47 steps
total** in `.github/workflows/ci.yml`. Run both.

Two tests fail **in a constrained container** and are not defects:

- `src/lib/security/migrationSyntax.test.ts` — 5s timeout over 1,030 migrations
- `src/lib/aml/diditProviderConfigTruth.spec.ts` — 5s timeout over 4,495 tests

Both pass at `--testTimeout=60000`, and both **pass on GitHub CI**. Do not
"fix" them by skipping, quarantining or raising the repo-wide timeout.

Generated artefacts to regenerate when touching their inputs:

- `supabase/migration-object-index.json` → `npm run migrations:index`
- `docs/security/SECURITY_INVENTORY.json` → `npm run security:inventory`

Edge checks need Deno on PATH: `export PATH="$PATH:/root/.deno/bin"`.

---

## 8. Environment facts that cost time to rediscover

- **Frontend deploys via Lovable**, project `7976d60b-c277-4851-889b-c170285f4be2`.
  There is no frontend deploy workflow in the repo.
- **Edge functions deploy via** `.github/workflows/deploy-supabase-functions.yml`
  on merge to `main`. A `_shared/` change redeploys everything; only functions
  whose bundle actually changed take a new version.
- **The live site is behind a Cloudflare challenge** and the agent proxy resets
  browser tunnels, so the deployed bundle cannot be fetched from a sandbox.
  Browser rendering via Playwright is blocked for the same reason —
  `curl` works, Chromium tunnels do not.
- `pg_net` is installed and is the way to measure the **production** egress.
- Supabase project `dduzbchuswwbefdunfct`.

---

## 9. Immediate next actions

1. **RF-7.1 — the Report Fact Contract** (Investment Property Report only) is
   the live workstream. It is a **strangler**: the contract is added *beside*
   the working Reporting Engine, no production consumer is switched to it, and
   reverting the PR must leave Reporting behaving exactly as before. Preserve →
   Observe → Canonicalise → Prove → Adopt later.
2. **Do not reopen Scoring** (§4.6). Not to widen `verifiedInputs`, not to
   relabel the authority constant, not to reinstate a grade "while the
   evidence is being sourced".
3. **The vendor questions remain the only route to ME-7** (§3.3–§3.4). When
   either answers at $0: record the footing, build **only** that one adapter,
   normalise into `MarketEvidence`, seal the first genuine evidence snapshot,
   and re-evaluate the ME-7 gate.

Do not begin ME-7 before the gate opens. Do not change scoring weights, grade
thresholds or evidence methodology to make it open sooner — **evidence scarcity
is a coverage problem, not permission to alter scoring.**
