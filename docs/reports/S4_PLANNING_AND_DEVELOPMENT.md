# S4 — the planning and development output, and the four defects in it

Everything here was found by reading what production actually holds for the
two subjects, and by reading the register that feeds it. Nothing was inferred
from the code.

Subjects:

| | report | coordinate | jurisdiction |
| --- | --- | --- | --- |
| Annabelle | `9bd41c05-7f9b-41e8-819a-a029f4121369` · 18 Annabelle Crescent, Kellyville NSW 2155 | `-33.7115485, 150.9586199` | NSW |
| Pallas | `3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753` · 262 Pallas Street, Maryborough QLD 4650 | `-25.5161079, 152.7074047` | QLD |

---

## Where the inputs come from

This sandbox's proxy answers `403` to `CONNECT` for every Australian
government host, so nothing here asks a publisher directly. Both inputs are
READ from production, SELECT-only:

| fixture | read | provenance |
| --- | --- | --- |
| `reports/fixtures/planning-<subject>.json` | `select data from planning_data_cache where cache_key = …` | `planning-data-service`'s own answer — the object each live report was built from. Annabelle `2026-09-17T08:58:23.845Z`, Pallas `2026-09-16T23:37:26.239Z`. |
| `reports/fixtures/nsw-da-the-hills-2026-03-18_2026-09-17.json` | `net.http_get` × 7 pages, request ids **270152, 270164–270169** | All 655 rows the NSW Online DA API returned for The Hills Shire Council, `PageSize 100`, the eleven `NswDaRow` fields and nothing else. CC BY 4.0. |

`reports/` is git-ignored (`.gitignore:33`), so the fixtures do not travel with
the repository and `s4PlanningOutput.mts` says so rather than throwing ENOENT.

Run it with `npx tsx scripts/reports/s4PlanningOutput.mts`.

---

## 1 · Three of the five largest "projects" were one data centre

The document for 18 Annabelle Crescent listed these among the five largest
developments in the area:

| council number | determined | stated cost | address |
| --- | --- | ---: | --- |
| `1382/2025/JP/A` | 7 May 2026 | $93,180,778 | 3 Brookhollow Avenue, Norwest |
| `1382/2025/JP/B` | 2 Jul 2026 | $93,180,778 | 3 Brookhollow Avenue, Norwest |
| `1382/2025/JP/C` | 30 Jul 2026 | $93,180,778 | 3 Brookhollow Avenue, Norwest |

One data centre, modified three times. A reader saw $279m of data centres
where there is $93m of one, and all three were labelled *"Development
application · Determined"*.

Classifying by `ApplicationType` had already stopped a modification being
ADDED to the headline. It did nothing about the LIST, which ranked ROWS.

**The parent is read, not guessed.** Measured over all 655 rows of the live
window:

| the register's own `ApplicationType` | segments in `CouncilApplicationNumber` | rows |
| --- | ---: | ---: |
| Development Application | 3 (`1472/2026/JP`) | 471 |
| Modification Application | 4 (`1382/2025/JP/A`) | 172 |
| Review of determination | 4 | 12 |

The two signals agree on **655 of 655**. 655 rows are **631 developments**; 20
carry more than one row, and **160 groups hold no new application at all**
because the development was approved before the window opened — so a group of
amendments alone is the ordinary case, not an anomaly.

Three rules. **Only an application the register itself calls an amendment may
be attached to a parent**, so a council that numbers differently keeps one
entry per row and two real developments can never merge. **Never group by
address** — 4 Garthowen Crescent, Castle Hill carries `366/2025/JP` ($182m)
and `323/2027/JP` ($88m) in this same window. And **grouping is for the LIST,
never for the headline**: the class totals answer "what was newly proposed in
this window", a group answers "what is this development", and summing the
groups gives $1.92bn against the new applications' $1.18bn.

A development's cost, dwellings and status come from the row the register has
most recently said something about, because an amendment restates the whole
development rather than a delta.

## 2 · The planning table said "0 applications" above a block saying 171

`planningFacts.pure.ts` read `summary.headline` and `summary.total`.
`DaSummary` has neither — its fields are `totalInPeriod`, `rowsRead`,
`newApplications`, `amendments`, `unclassified`, `periodFrom`, `periodTo`.
Both reads were `undefined`, the `?? 0` fell through, and the planning table
printed **"0 applications in the register window"** directly above an
infrastructure block stating 171 and 278 applications for the same council
over the same six months.

It is the class `caseTenant.ts` documents — naming a field the object does not
have and taking the fallback as an answer — and the fallback is what made it
invisible: **a real zero and a read that missed look identical.**
`daActivityLine` counts from the same `newApplications` / `amendments` totals
the infrastructure block reads, so the two cannot disagree, and it never adds
the two classes.

## 3 · What the brief asks for, per development

The table's first column was a joined list of development types — *"Alterations
or additions to an existing building or structure, High technology industry,
Data centre"* — with no application number and no address, while the register
carried both. Nothing in it could be looked up.

| asked for | now |
| --- | --- |
| identity | the council's own application number (`1382/2025/JP`) |
| location | the register's full address, falling back to the suburb |
| source date | the publisher, the licence and the retrieval stamp, as before |
| recorded status | the register's own word, as before |
| **funding** | *"Not stated — the figure is the applicant's own cost of development"* |
| **published delivery timing** | *"Not published by this register"* |

Funding and timing get columns of their own precisely BECAUSE no register read
here publishes either. A dollar figure with nothing beside it reads as
funding; an absence stated in a footnote is an absence most readers never
reach.

## 4 · The evidence was retrieved on every run and persisted nowhere

`investment_reports` has no `enhanced_data` column, and the final save writes
`report_content`, `sources_content`, `demographics_data`, `economic_data`,
`financial_calculations`, `investment_score`, `location_intelligence`,
`market_fact_snapshot`, `property_specs`, `validation_flags`, `data_sources`,
`report_scope`, `generation_engine` and `status`. **The planning evidence is
in none of them.**

`data_sources.planning` carries the zoning headline — on Annabelle,
`NSW / THE HILLS SHIRE / R2 — Low Density Residential / CC BY 4.0 / current at
2026-08-07` — and nothing else. The constraint register, the per-control
provenance and every development the DA register named existed only as prose
inside `report_content`. No projection, template binding, regeneration or fork
could read one of them, and a later reader had no way to check a sentence
against the evidence it was written from. That is the shape of the defect S2
traced for the location readings: **obtained in full, and not carried into the
saved record.**

`planningEvidenceRecord.pure.ts` records both objects beside the location
readings, under `planning` and `infrastructure`. Three rules: nothing is
derived, so a stored report and its document cannot disagree about what was
retrieved; it never touches the enrichment's own reuse
(`assessEnrichmentReuse` reads `__acquisition` and these keys are inert to
it), and it is composed at the SAVE rather than written into
`enhancedData.locationIntelligence`, so a reused enrichment cannot carry a
previous run's planning with it; and a run with nothing to record returns the
object it was given, by reference, so every existing row is unchanged.

---

## What the output looks like now

Measured on `reports/s4-planning-output.md`, both subjects, from the fixtures
above.

| | production, 17 Sep | after |
| --- | --- | --- |
| DA cell in the planning table | "0 applications in the register window" | 471 new applications, 184 amendments, lodged 18 Mar 2026 to 17 Sep 2026 |
| the largest list | 5 rows, three of them one data centre | 5 developments, each with its council number and address |
| the Norwest data centre | 3 entries × $93,180,778 | 1 entry, "amended 3 times in this window" |
| the Castle Hill amendment | "Development application · Determined" | "Approved development · amended 1 time in this window" |
| rows the summary read | 300 of 650 | **655 of 655** |
| stated development cost | $808,649,729 across 278, all three classes | $1,175,556,030 across 452 **new** applications |
| new dwellings | 680 across 171 | 1,410 across 301 |
| funding | not mentioned | stated as not published, per entry |
| delivery timing | a footnote | a column, per entry |

The aggregates went UP because the deployed function read a SAMPLE (300 of
650) while summing all three classes. Reading the whole register and counting
only new proposals is a different figure, and both changes are in the honest
direction. The top entry changed too — the $251m Box Hill development was on
a page the sample never read.

**Nothing here changes CGR, a financial assumption or a projection.** The
infrastructure evidence is narrative and provenance only; no scorer, engine or
ledger reads it.

---

## 5 · Still open

**Pallas's cached planning answer predates the constraint register.** Its
cached object is 1,293 bytes with `constraints`, `constraintsAsked` and
`constraintRegisters` all absent, because it was taken at
`2026-09-16T23:37Z` and the constraint block shipped before Annabelle's
`2026-09-17T08:58Z` run. The cache key is the coordinate alone and the TTL is
seven days, so **a deployment that widens the answer cannot invalidate the
narrow one**, and every Maryborough report gets the thin answer until it ages
out.

It does not produce a false statement — the overlay cell correctly says the
council scheme has not been read, rather than claiming anything was checked
and not mapped — so the consequence is under-reporting rather than
mis-reporting. It is still wrong: measured at this coordinate, the Queensland
registers answer `Maryborough Priority Living Area` inside the
`Wide Bay Burnett Regional Plan`, and the FloodCheck sub-basin, none of which
the thin object carries.

**The ten-year outlook's wider sourcing remains an owner decision.** See
`S4_INFRASTRUCTURE_SOURCE_COVERAGE.md`: no free, keyless, openly licensed
register publishes infrastructure PROJECTS resolvable to either subject
locality, and the DA window is six months of private applications rather than
a public programme. Nothing here fabricates a pipeline in the meantime, and
the coverage limitation is stated on the page whether the list is long or
empty.
