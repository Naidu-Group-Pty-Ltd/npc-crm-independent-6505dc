# The signed-in acceptance run — publication, the input sheet, R1–R12, the ten PDFs

Written for the operator who holds the session. Every step names the action, the
expected result and the evidence to return. **Nothing here may be marked PASS
until its evidence exists**; an unperformed check is BLOCKED or PENDING.

Three things are deliberately kept apart, because conflating them is how a
release gets called verified when it is not:

| | what it proves | what it does NOT prove |
| --- | --- | --- |
| **P1 Publication confirmation** | the publish action completed | nothing about which code is being served |
| **P2 Served-version verification** | the bundle the browser runs was built from a named commit | nothing about whether a report can be produced |
| **P3 Generation** | the pipeline produced a document | nothing about the other R-checks |

---

## Part 1 · Publication, and the three separate version facts

**P1 — publish the browser build.**
Lovable project `7976d60b-c277-4851-889b-c170285f4be2`
(`https://lovable.dev/projects/7976d60b-c277-4851-889b-c170285f4be2`) →
**Share → Publish**.

* Before pressing it, confirm the project's latest commit is the `main` you
  intend. The API reported `latest_commit_sha` `1dd8e1ce7…` before PR #2708;
  current `main` is `f42d8d6c5254d9830e77dc6971125d98bc4afd8f`.
* **Evidence:** screenshot of the publish confirmation, including the time.
* **This is a publication confirmation only.** `last_edited_at` is a sync
  timestamp, not a publication, and the Lovable API exposes no published-revision
  field — which is exactly why P2 exists.

**Record three facts separately. They can disagree, and which two disagree is
the diagnosis.**

| | what to record | where it comes from |
| --- | --- | --- |
| **P1 intended publication** | the commit you meant to publish, and the confirmation | the Lovable project + its confirmation dialog |
| **P2a manifest result** | the literal body of `/version.json` | a static file emitted at build time |
| **P2b application version evidence** | the build id the **running application** reports | the loaded bundle, not the manifest |

**P2a — the manifest.** Open
`https://command-centre.npcservices.com.au/version.json`.
The build stamps its commit into the bundle and writes the same value here
(`vite.config.ts` → `buildVersionManifest()`; the id is
`VITE_BUILD_ID || VERCEL_GIT_COMMIT_SHA || GITHUB_SHA || COMMIT_REF`, else
`git rev-parse --short=12 HEAD`, else `t<base36>`).
Expected `{"buildId":"f42d8d6c5254"}` for the current `main`.
**Evidence:** the copied JSON, plus the commit you published.

**P2b — the running application.** `src/lib/buildVersion.ts` compares the id
compiled into the *running* bundle against that manifest (`isStaleBuild`). The
manifest alone is a static file; it does not prove which JavaScript the browser
executed. Record whatever the application itself reports.

**Readings — and none of them is "the CDN" until something says so.** If P2a and
P2b agree with P1, the served bundle is that commit. If any two disagree, that is
a discrepancy **to investigate, not to explain**. The candidates are at least:
the publish did not take; the build ran from a different commit; the builder had
no git context (a `t…` value — say so rather than inferring a commit); the
manifest is cached while the bundle is not, or the reverse. Do not write "CDN
cache" into the record without evidence for it; report what the three facts
actually were.

> P2a cannot be performed from the engineering session: the origin answers
> **403 `cf-mitigated: challenge`** to that egress, including real headless
> Chromium. It needs your browser.

---

## Part 2 · The input sheet

### 2.1 What the record supplies

Retrieved from the programme record (`S5_HANDOFF.md` §2), not invented:

| | Annabelle | Pallas |
| --- | --- | --- |
| address | **18 Annabelle Crescent, Kellyville NSW 2155** | **262 Pallas Street, Maryborough QLD 4650** |
| purchase price modelled | **$1,490,000** | **$575,000** |
| earlier report id | `9bd41c05-7f9b-41e8-819a-a029f4121369` | `3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753` |
| earlier grade / score | F / 40 | C / 63 |
| coordinate | −33.7115485, 150.9586199 | not recorded here |

### 2.2 The correction this sheet exists for

**An empty override box does not mean the backend has no value.** The four tabs
ship **pre-filled defaults**, and the component publishes *all* of its state on
every render — `PreGenerationOverrides.tsx:744-830`, one `useEffect` that builds
`PreGenerationData` from every field and calls `onDataChange(data)`. A field is
omitted only when its string is empty (`field ? parseFloat(field) : undefined`).
The defaults are not empty strings, so **they are submitted whether or not you
open the tab**. `InvestmentReportGenerator.tsx:541-547` then filters out the
`undefined`s and stores the rest as the report row's `manual_overrides`.

So an untouched Financials tab is not a missing-input test. It is a populated
80% LVR, 6.5%, interest-only-over-30 scenario, and the document will describe it
as the accepted case. Address-and-price-only is a valid acquisition test; it is
a different test, and it is not this one.

There is **one** effective value per figure, however you reach it. The
generator's own `propertyPrice` / `weeklyRent` state and the tabs' fields are
two-way synchronised (`InvestmentReportGenerator.tsx:210-245`, guarded against
re-entry by `isSyncingFromPreGen` / `isSyncingToPreGen`), so typing in either
place sets the same submitted figure. It is not two independent inputs.

### 2.3 The effective values, and where each comes from

Origins: **entered** (you type it) · **defaulted** (ships pre-filled and is
submitted) · **calculated** (the form derives it from what you typed) ·
**estimated** (the backend researches or models it) · **unavailable** (nothing
establishes it, and the document says so).

| control | tab | Annabelle | Pallas | origin | authority |
| --- | --- | --- | --- | --- | --- |
| Build type | Property | `existing_property` | `existing_property` | **defaulted** | ships as `existing_property`; selects residential duty and the non-construction cost model |
| Property type | Property | `house` | `house` | **defaulted** | ships as `house`; reaches the duty/strata engine via `normalisePropertyType` |
| Purchase price | Property | **1,490,000** | **575,000** | **entered** | the one figure the record supplies; generation refuses without it |
| Beds / baths / car / land / build size | Property | *(blank)* | *(blank)* | **unavailable** | not in the record; §4's conflicting-case check depends on leaving them blank |
| LVR | Financials | `80` | `80` | **defaulted** | `loanToValueRatio = '80'` |
| Deposit | Financials | **298,000** | **115,000** | **calculated** | `price × (100−LVR)/100`, written into the box by the form (`PreGenerationOverrides.tsx:516-526`) |
| Loan amount | Financials | **1,192,000** | **460,000** | **calculated** | `price × LVR/100` (`:528-542`), until you edit it |
| Interest rate | Financials | `6.5%` | `6.5%` | **defaulted** | `interestRate = '6.5'`; backend fallback is the same 6.5 (`generate-investment-report:2549`) |
| Loan type | Financials | `interest_only` | `interest_only` | **defaulted** | `loanType = 'interest_only'` |
| Loan term | Financials | `30` | `30` | **defaulted** | `loanTermYears = '30'` |
| Interest-only period | Financials | *(blank)* | *(blank)* | **estimated** | the term nobody records: `ASSUMED_INTEREST_ONLY_YEARS = 5` (`loanLedger.pure.ts:53`), disclosed on the page as assumed |
| Capital growth | Financials | `5%` | `5%` | **defaulted** | `capitalGrowth = '5'`; drives the ten-year projection |
| Stamp duty | Financials | *(blank)* | *(blank)* | **calculated** | **not absent** — the canonical engine computes it from state + price + FHB + build type; an override is sent only when typed (`generate-investment-report:3156`) |
| Weekly rent | Income | *(blank)* | *(blank)* | **estimated** | **not absent** — blank triggers an automatic median lookup (`sqm-rent-service`, `:3053-3092`). Precedence: override → listing → market lookup → none (`rentalEvidence.pure.ts:111-133`) |
| Occupancy | Income | `52` weeks | `52` weeks | **defaulted** | `occupancyRate = '52'`; `DEFAULT_OCCUPANCY_WEEKS = 52` is the same number |
| Management fee | Income | `8%` | `8%` | **defaulted** | `propertyManagementFees = '8'` |
| Letting fees | Income | *(follows rent)* | *(follows rent)* | **calculated** | set equal to weekly rent by the form whenever a rent is typed (`:544-549`) |
| Council / water / land tax / insurance / repairs | Income | *(blank)* | *(blank)* | **estimated** | the engine models each; **Estimate expenses** would write researched figures into the boxes — see 2.5 |
| Body corporate | Income | *(blank)* | *(blank)* | **calculated** | admin + sinking + special levies, summed by the form (`:551-562`) |
| CPI / depreciation / tax rate | Advanced | *(blank)* | *(blank)* | **estimated** | engine defaults; not submitted, so the engine's own assumptions stand |
| Construction staging (5/15/20/25/20) | Advanced | *(not submitted)* | *(not submitted)* | — | emitted only when build type is `new_build`; both subjects are existing property |
| Zoning / overlays / height / FSR | Advanced | **leave blank** | **leave blank** | **automatic** | see 2.4 |

**The two rent-dependent consequences.** Gross and net yield exist only if a rent
is established; where it is not, they are absent rather than `0.00%`
(`rentalEvidence.pure.ts`). And the rent's *source* is recorded, so the document
can say whether it was typed, carried from a listing, or looked up.

### 2.4 Planning, zoning and infrastructure stay automatic

Leave every Advanced zoning box blank. `planning-data-service` retrieves the
controls at the coordinate, and the report states each with its publisher,
licence, instrument and currency date, or one of five named absences. A typed
value is labelled `operator_stated` and outranks the layer — which is correct for
a real correction and wrong for an acceptance test, because it replaces the thing
being tested. **Do not hand-populate a research output to make the run pass.**

### 2.5 The one control that changes the character of the test

The Income tab has an **Estimate expenses** button
(`estimate-property-expenses`). Pressing it writes researched figures into the
boxes, and they then submit as entered values. That is a legitimate scenario and
a *different* one from letting the engine model the costs internally. Pick one
and apply it consistently to both properties, and record which.

### 2.6 What must stay consistent, and what need not

Each property's accepted scenario must be **identical across its five outputs** —
which it is by construction: one parent generation per property, and the other
four derive from that parent's stored record. Nothing in the fork or condense
routes re-reads the form.

The two properties **need not share financial assumptions**. A $1.49m Kellyville
house and a $575k Maryborough house are not the same case, and forcing one rate
or one rent on both would be less realistic, not more controlled.

### 2.7 The accepted scenario — settled 19 Sep 2026

Three questions were put and answered. This is now the basis for both journeys
and is not to be varied mid-run.

1. **The shipped defaults are the accepted case.** 80% LVR, 6.5%, interest-only,
   30-year term, 5% growth, 8% PM fee, 52 weeks — for **both** properties. The
   deposit and loan amount follow from price and LVR as §2.3 sets out. Open the
   tabs to read them if you wish; change nothing.
2. **Weekly rent stays blank on both, and the lookup is exercised.** Record which
   source answered — `override`, `listing`, `market_lookup` or `none`. If nothing
   answers, the yields are **absent rather than `0.00%`**, and that is a correct
   result to report, not a failure to retry.
3. **Do not press Estimate expenses** on either property. The engine models the
   annual costs; the submitted inputs stay minimal.

So the only thing typed on either journey is the **address and the purchase
price**. Everything else is either a default the form submits, a figure the form
calculates, or something the platform researches — which is exactly the
distinction this sheet exists to make.

---

## Part 3 · How the five tiers are obtained

One parent generation per property. The other four derive from it — this is the
existing workflow, and it is why ten PDFs need only **two** parent generations.

| tier | route | model call |
| --- | --- | --- |
| **Investment Compass** | `generate-investment-report` — the parent | yes |
| **Financial Analysis** | `fork-investment-report` | **no** |
| **Strategic / Due Diligence** | `fork-investment-report` | **no** |
| **Executive Briefing** | `condense-investment-report`, `targetTier: 'briefing'` | yes (16k max) |
| **Snapshot** | `condense-investment-report`, `targetTier: 'snapshot'` | yes (6k max) |

Six model-calling steps in total. Do **not** start five independent parent
generations per property.

**"No model call" is not "no cost".** A parent generation also spends on metered
vendor calls — geocoding, Places, the rent lookup, the planning registers — and a
render is real compute. Track **actual** usage from the usage ledger per step
rather than assuming a step was free because no model ran.

---

## Part 4 · R1–R12, as actions

Definitions are `S5_ISOLATED_RUN_REQUEST.md` §3, unchanged.

| check | action | expected | evidence |
| --- | --- | --- | --- |
| **R1 Generate** | Reports → Investment Report Generator; the Part 2 inputs; Generate. Let it run to completion including any resume. | a Compass report exists and completes | report id, start/finish times, screenshot of the completed state, and the submitted inputs |
| **§4 conflicting case** | leave bedrooms/bathrooms blank while the listing material states counts | the document does not promote a listing assertion into a recorded property fact | the page where counts would appear |
| **R2–R3 Edit, save, reopen** | edit one section of a Compass and one of a Briefing; save; navigate away; reopen | the edit reads back unchanged; nothing regenerated | before/after screenshots + the edited text |
| **R4–R5 Template apply and change** | choose a template for the Investment format; reload; then change it and re-export | the choice survives reload; the alternative renders; content and history intact | picker screenshots both times, plus both PDFs |
| **R6–R7 Preview and export** | for each of the ten, compare the **on-screen preview / source content** against the exported PDF | the export matches what the application shows — every section, the final sentence, no truncation | preview screenshots **and** the PDFs, side by side |
| **R8–R9 Navigate, permissions** | walk the routes and the back button; exercise the specific role/workspace limits you can reach | routes resolve, back works, each tested limit holds in UI and server | screenshots of each route and of each refused action |
| **R10–R11 Historical compatibility, preserved edits** | open representative pre-existing reports, including any you had edited | legacy formats still render; pre-change edits survive, compared by content | screenshots of the legacy documents |
| **R12 Protected records** | note report content, scores and financial values on protected rows **before** the run and again after | unchanged | the before/after values |

**R6–R7 is a comparison, not an export.** A PDF on its own proves a PDF exists.
The check is whether the document matches the preview and the stored source; both
sides must be captured.

**R8–R9 conclusions are limited to the cases tested.** Write "the two refusals
tested held" — not "permissions are correct". Name each role, route and action
actually exercised; everything else is untested, not passing.

**R10–R12 are two different kinds of evidence.** *Historical preservation* is the
long-standing record — reports and edits that predate this work. *This interval's
before/after* is the pair of observations you take immediately before the run
starts and immediately after it finishes. Record them separately; a value that
was already as it is proves preservation, and only a genuine before/after pair
proves this run changed nothing.

---

## Part 5 · Which template drew each PDF, and whether it carries v15

Two separate questions, asked per document.

**Which template was chosen** — available in the application. The **template
picker** shows the selection per (user, format) and matches the stored choice by
`libraryLineage.entryId` + `entryVersion`. Screenshot it immediately before each
export. The selection is per user and format, so it is the same for every tier of
that format unless you change it.

**Whether that master carries v15** — `config.libraryLineage.releaseApplied` is
the field that records it and **no surface renders it**. Record it as
**unavailable**, not assumed.

### Visual release indicators

v15's changes are visible on the page, which makes them useful and **not
conclusive**. Treat both as indicators of the released content, never as a
reading of the template's release metadata.

1. **The running head names the chapter** (`{{narrative.chapters.N}}`).
2. **The Contents page carries a companion note above the list.** Per tier:
   * Compass — *"Purchase costs, yield, loan structure, cash flow and the
     ten-year projection are set out in the Financial Analysis Report for this
     property."*
   * Financial Analysis — *"The location case, the planning controls mapped over
     the land and the risk register are set out in the Investment Compass for
     this property."*
   * Strategic — *"The financial position is set out in the Financial Analysis
     Report for this property."*
   * Briefing — *"The full assessment is in the Investment Compass, and the
     financial position in the Financial Analysis Report."*
   * Snapshot — *"The location case is in the Investment Compass, and the full
     modelling in the Financial Analysis Report."*

**Both present** → the document carries the released content. Good evidence; it
still is not the metadata.

**Either absent** → **diagnose it; do not classify the master as deferred.** At
least four things produce that page, and they lead to different remedies:

* the master genuinely did not receive v15 (a customised copy the refresh
  deferred) — a legitimate outcome, and **never to be corrected by
  force-refreshing a customised copy**;
* the chapter bindings resolved to nothing for this row, so a v15 master printed
  a v15-shaped page with an empty running head;
* the document was drawn by a different template from the one the picker showed;
* the served bundle is not the one Part 1 established.

Record what you observed and which of these you could rule out. An unresolved
indicator is a finding, not a classification.

### The refresh classification, stated exactly

The refresh classified **16** active adopted masters
(`template_master_refresh_decisions`: absent → 16 rows, run #68).

* **Directly observed:** 16 classified; 543 baselines captured (run #67).
* **Derived, not observed:** `deferred_no_baseline` = 0 — the classification
  joins only published entries with a non-null schema, and a baseline was
  captured for every such entry.
* **PENDING:** the `already_current` / `refreshed` / `deferred_customised`
  split. It is in no log, and the query that yields it is in the refresh
  migration's own footer comment. Sixteen classified is **not** sixteen upgraded.

---

## Part 6 · Test-record safety

**The normal signed-in journey already produces an unlinked, undelivered report.
Nothing needs to be changed, cleared or worked around.**

**Why it is unlinked.** The Reports page's generator names seven columns on the
insert — `property_address`, `report_content`, `status`, `report_scope`,
`generated_by`, `generation_engine`, `manual_overrides`
(`InvestmentReportGenerator.tsx:553-559`) — and `manage-investment-reports`
inserts exactly what it is handed (`index.ts:102-104`). **`client_property_id` is
never sent**, so it is NULL. Client linkage belongs to other entry points
entirely (`ClientPropertyInvestmentReport.tsx`, `PortalRequestReportForm.tsx`);
generating from `/reports` with a typed address cannot reach them.

One observable follows, and it is not a client link: with no client and no
listing id, `canonical_property_key` resolves to `address:<normalised address>`
(`20260724100000_canonical_generated_report_property_identity.sql`). The new
reports will therefore appear in the **same property package as the existing
reports at that address**. That is the address grouping working, and it is also
why R10–R12 matter: confirm the historical rows beside them are untouched.

**Why nothing is delivered.** Generation sends nothing. No notification or email
sender in `supabase/functions/` references an investment report; delivery is a
separate, explicit act — *Send to Client*, or a portal publish. **Simply do not
press them.** There is no background dispatch to suppress.

**Creator attribution is normal and must stay normal.** The insert writes
`generated_by: user?.id ?? null` — in a signed-in session that is your own user
id, which is the correct and expected authorship for a report you generated. The
`?? null` is the existing fallback for a session with no user; it is not an
instruction, and **the earlier direction to set `generated_by = null` is
withdrawn**. Do not clear it, do not substitute another identity, and do not
touch the row in the database.

**So the whole of test-record safety is:** generate from `/reports` with a typed
address, and do not press Send or Publish. Nothing else.

---

## Part 7 · The order to run in, and the spend

1. **P1, then P2a and P2b.** Do not generate anything until the served version is
   known, and record the three version facts separately.
2. **The first Compass — 18 Annabelle Crescent — and stop.** Return it before
   anything else. It is the first of the ten, not an extra. I review it for a
   material input, research or rendering failure before the rest proceed.
3. On a clean first Compass: the two forks, then the two condensations, for
   Annabelle; then the same five for Pallas.
4. Capture per document: the submitted inputs, report id, generation start and
   finish, the chosen template, the preview, and the exported PDF.

**The ten stays ten.** Two properties × five tiers. Any **extra exports taken to
compare templates (R4–R5) are evidence, not additional parent generations** — they
re-render an existing report and must not be counted toward the ten, nor produced
by generating again.

**Spend.** A$25 total, including paid retries. **A$0.00 spent.** Six
model-calling steps, plus the metered vendor calls Part 3 names. Track actual
usage per step rather than assuming. Pause before the cap.

**Failures are kept.** A failed or partial output is retained as evidence, not
deleted and not re-run to tidy the record. A retry is permitted only where the
reason is stated and recorded — a genuine transport or platform failure — and
never to obtain a better-looking outcome. Each retry counts against the cap.

**Preservation.** Historical reports and user edits are not to be modified.
