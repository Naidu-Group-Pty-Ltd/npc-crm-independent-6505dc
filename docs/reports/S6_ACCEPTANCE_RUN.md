# The acceptance run — what was executed, and what could not be

**S5/S6 §5.** This records the validation run: what it exercised, what it did
not, the ten documents it produced, and the one blocker that stopped the run
being the one §5 specified. Written 18 September 2026.

---

## 1. The blocker, stated once

§5 asks for *"fresh Annabelle and Pallas Compass generation through the
candidate implementation, with evidence acquisition, persistence/resume,
scoring and composition exercised"*, and says that if row access still needs
external enablement I should *"identify the exact environment, unavailable
capability and minimum action once."*

**It does. Two independent things stop it, and each stops it on its own.**

### 1.1 The two subject rows are not reachable from this environment

| | |
| --- | --- |
| **Subject rows** | `9bd41c05-7f9b-41e8-819a-a029f4121369` — 18 Annabelle Crescent, Kellyville NSW 2155<br>`3a4a3d9b-4d2d-4296-9e39-3fab0c2ae753` — 262 Pallas Street, Maryborough QLD 4650 |
| **Where they are** | `investment_reports` in the production Supabase project `dduzbchuswwbefdunfct` |
| **What this session has** | the Supabase MCP server, exposing `list_tables`, `list_migrations`, `get_advisors`, `query_logs`, `get_edge_function` and the project/key readers |
| **The unavailable capability** | **`execute_sql` is not exposed on this MCP server**, and no other tool here reads a table row. `query_logs` reads logs, not rows. |
| **What is present locally** | `.verify/fixtures/` holds **44 production report rows**, and **neither subject is among them** — grepped, not assumed. The addresses present are 48 Redfern Street (Cowra NSW), 1/27D Mitchell Street and 23 MACKAY Street (Moranbah QLD). |
| **Minimum action** | Expose `execute_sql` on the Supabase MCP server for this project, **or** place the two rows under `.verify/fixtures/<report id>/report.json` in the shape the other 44 use. Either one is sufficient; neither needs a credential to reach this session. |

The subjects' **coordinates and report ids are known** — they are in
`.verify/out/planning-probe.json` from the 18 Sep register probe — which is why
the planning and infrastructure work in this programme could be measured
against both properties. What is missing is the report ROW: the stored content,
score, financials and enrichment a document is rendered from.

A spending approval does not resolve this, which §5 already anticipated. No
part of the A$25 ceiling was spent; **A$0.00** to date.

### 1.2 The candidate implementation is not deployed

Even with the rows, a call to the deployed `generate-investment-report` would
run **`main`**, not this branch. The candidate's generation-path changes — the
claim corrector, the investment-programme read, the `c3` answer version, the
infrastructure guide — reach a document only once the branch is deployed, and
§5 is explicit that the approval covers *"test generation and validation, not
production deployment"*.

So "fresh generation through the candidate implementation" needs a deployment
this authorisation deliberately withholds. That is a sequencing fact rather
than a fault, and it is the reason the run below is a **render and composition**
acceptance rather than a generation one.

---

## 2. What the run DID exercise, and what stood in for what

§5: *"Distinguish actual backend execution from an in-process harness or mocked
service."* Here is that distinction, component by component.

| component | in this run | real or stood-in |
| --- | --- | --- |
| The application | the real `src/` bundle, served by Vite, driven in **real Chromium** through Playwright | **real** |
| The user journey | report → edit → template picker → publishing/export → finalise → send | **real** — every control clicked, every persistence checked |
| The render engine | **WeasyPrint 69.0**, the version production pins | **real** |
| The HTML the engine drew | compiled by `src/lib/reportTemplate/htmlRenderer.ts`, the candidate's own | **real** |
| The report rows | 44 **production** rows held locally as fixtures | **real data, local copy** |
| Supabase (reads, writes, storage, function invocations) | `supabaseDouble.mjs` answers every request | **stood in** |
| The model | not called — nothing in this run generates or condenses prose | **not exercised** |
| Evidence acquisition, persistence/resume, scoring | not called — these run inside `generate-investment-report` | **not exercised** |

**Nothing here is a mock of the thing being tested.** The measure is the
document: the same engine, the same compiler, the same templates, the same
production content. What is stood in for is everything *around* the document —
which is exactly the half §5 wanted exercised on Annabelle and Pallas and which
§1 explains is unreachable.

---

## 3. The ten documents

Ten renders across all five tiers and three properties, each one a separate
journey run in a fresh browser. Every one is a production row.

Nine renders across all five tiers and three properties, each a separate
journey run in a fresh browser on a **production** row. **207 pages in total,
every one measured.**

| # | document | tier | property | pages | size | journey | pages |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| 1 | Investment Compass | compass | 48 Redfern Street, Cowra NSW | 35 | 447 KB | 31/31 | **PASS** |
| 2 | Investment Compass | compass | 48 Redfern Street (second row) | 24 | 393 KB | pass | **PASS** |
| 3 | Investment Compass | compass | 23 MACKAY Street, Moranbah QLD | 35 | 483 KB | pass | **PASS** |
| 4 | Financial Analysis | financial | 48 Redfern Street, Cowra NSW | 22 | 377 KB | pass | **PASS** |
| 5 | Financial Analysis | financial | 1/27D Mitchell Street | 19 | 385 KB | pass | **PASS** |
| 6 | Due Diligence | strategic | 48 Redfern Street, Cowra NSW | 25 | 389 KB | pass | **PASS** |
| 7 | Due Diligence | strategic | 1/27D Mitchell Street | 25 | 416 KB | pass | **PASS** |
| 8 | Executive Briefing | briefing | 1/27D Mitchell Street | 11 | 246 KB | pass | **PASS** |
| 9 | Snapshot Report | snapshot | 1/27D Mitchell Street | 11 | 248 KB | pass | **PASS** |

Every font embedded on every document (5–13 faces each). Running feet and page
numbers drawn and correct on every page but the covers and dividers that
deliberately carry none. No hole over 45% of the body with content below it on
any of the 207 pages.

**Why nine rather than ten.** The tenth would have been a Briefing or Snapshot
for 48 Redfern Street, and no such row exists in this environment — the
condensed tiers exist only for 1/27D Mitchell Street. Rendering the same row
twice to reach ten would have measured nothing a ninth document did not.

## 3.1 Two real defects the page read found

Neither was visible to any test, and both were found by reading the drawn
pages.

### A strip cell reporting OUR gap as a finding about the house

Two documents drew, inside an at-a-glance strip:

> `⚠ Exact bed/bath/car details not provided`
> `⚠ Exact facility distances not provided`

`compassDocumentContract` **forbids this by name and quotes the first string
verbatim** — *"which a client reads as a defect in the house rather than a gap
in our file"* — and both documents were written before that rule existed. The
rule reaches the MODEL; it does nothing for a document already stored.

`stripPlaceholderRows` could not see them: they are neither a table row nor a
bullet, but cells inside a `{{glance:}}` payload the renderer draws as a strip.
`stripOwnGapCells` removes the CELL and keeps the strip, per the contract's own
words — *"three cells that each carry a finding is a complete strip, and a
fourth reporting our own gap is not"* — and runs in `presentStoredMarkdown`,
the read path, which is §8 of `RUNTIME_CONSOLIDATION.md`'s precedent.

The rule is narrow by design: a gap phrase alone is not enough, because
*"⚠ NBN not available"* is a finding about the property. The cell must also
name an information noun — details, data, figures, distances, a breakdown —
which is what makes it a statement about the record rather than the house.

### A false-positive measurement rule, corrected

With those cells gone, four flags remained, and all four were **prose**:

> *"Authoritative postcode-level demographic information was not available for
> this analysis, so no …"* (95 characters)
> *"… (SEIFA) and workforce composition figures were not available at the
> subject property's postal area"* (97 characters)

The sentinel ran per text run, and WeasyPrint emits a whole prose line as one
run. A sentence naming what was missing and why is protected by the
repository's own rule — *prose is never regex-scrubbed, on read or on write* —
so flagging it is a false caveat, and a false caveat teaches people to dismiss
the warning.

So the sentinels split. `NA`, `TBD`, `null`, `undefined`, `NaN`,
`[object Object]` and an unresolved `{{…}}` still fire **anywhere** — none is
ever legitimate prose. *"not available"* and *"not provided"* fire only in a
run of **60 characters or fewer**, which is a value slot. The threshold is
measured, not chosen: the real defect was 39 characters, the two false
positives 95 and 97, and a placeholder label is under 20.

§5's own caution applies and was honoured: correcting the rule did not make
the short pages acceptable by default. They were inspected separately — see
§4.

---

## 4. What every page was read for

§5 lists what every page must be read for. Taken against all 207 pages:

| check | result |
| --- | --- |
| **unresolved tokens** | none, on any page of any document, after the one real defect above was fixed |
| **clipping** (a run leaving its page) | none |
| **overlapping blocks** (two runs intersecting on a line) | none |
| **illegible text** (no contrast against its own ground, sampled at 150 dpi) | none |
| **mojibake** (replacement chars, control bytes, UTF-8 read as Latin-1) | none |
| **blank pages** | none |
| **holes** (a band over 45% of the body with content below it) | none, on any of the 207 |
| **fonts** | every face embedded on every document |
| **running feet and numbering** | drawn and correct on every page that carries them |
| **Briefing and Snapshot condensed** | 11 pages each against 24–35 for a Compass and 19–25 for a Financial — the condensation is real |
| **the financial split** | the two Compass documents carry no purchase modelling; the Financial documents carry it |

### The short pages, inspected rather than dismissed

§5: *"still inspect stranded tables, unnecessary splits and missing content"*.
Nine short pages across five documents, each looked at:

| document | short pages | what they are |
| --- | ---: | --- |
| compass-redfern | 3, 33 | a contents page and the closing page — both intentionally light |
| compass-moranbah | 5 | a section opener |
| strategic-mitchell / strategic-redfern | 2, 3, 24 | the same three positions on both: two front-matter pages and the closing page |
| financial-mitchell | 2 | front matter |
| financial-redfern | 3 | front matter |
| briefing-mitchell | 3 | front matter |

Every one is front matter, a section opener or a closing page. **None is a
stranded table, a split that should not have happened, or a page missing
content** — the pattern repeats at the same positions across different
properties, which is what a deliberate master page sequence looks like and
what an accidental break does not.

---

## 5. What this run does and does not license

**It supports**: that the candidate's render boundary, template selection,
finalisation, single-render contract, portal publish, geometry and content
rules work on real production content across all five tiers, and that the
documents carry no unresolved token, no clipping, no overlap and no placeholder.

**It does not support**: any claim about fresh generation, evidence
acquisition, resume behaviour or scoring on 18 Annabelle Crescent or 262 Pallas
Street. Those need §1's minimum action first, and the expected score movement
stays what §5 calls it — **a prediction to test, not a result**.
