# Property Comparison Analysis — the format's contract

The fourth format on the report design system, after the Borrowing Capacity
Snapshot, the 10 Year Cash Flow Analysis and the Portfolio Performance Review.
Read [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) first; this document covers only
what is specific to the comparison.

It is the format that arrived in the worst state of the four, and most of this
document is about why.

---

## 1. Findings against the shipping output

Read off source and off production data.

### The path a saved comparison takes today

`ComparisonPDFGenerator.tsx:40` sends the stored row to the
**`format-comparison-report`** edge function, which calls Perplexity `sonar` to
rewrite it as markdown; that markdown goes to `PixelPerfectPDFGenerator`, which
draws the PDF in the browser with pdf-lib.

**F1 — re-downloading a saved comparison is metered and non-deterministic.**
`format-comparison-report` runs under
`withReportMetering({ kind: 'report.chart-analysis' })` (`index.ts:360`). Every
download of an already-saved analysis reserves tokens and asks a model to rewrite
prose that already exists, so two downloads of the same row produce two different
documents and nobody can say which one a client was sent.

**F2 — the metering multiplier is always 2.** It reads
`body.comparisonData.properties.length` (`:363–365`), but the caller sends a row
carrying `property_count` and `property_addresses` and no `properties`, and sends
no `propertyCount` either. A five-property comparison is metered as a two-property
one.

**F3 — a blunt regex edits the client's prose.** `sanitizeFormattedContent`
applies `replace(/;\s+([A-Za-z])/g, ' $1')` to the whole document to tidy
addresses. It strips the semicolon from every sentence that uses one.

**F4 — the fallback prints raw JSON into a client PDF.**
`ComparisonPDFGenerator.tsx:90–113` emits `JSON.stringify(section, null, 2)` under
each heading whenever the edge function fails.

**F5 — one whole section has never been rendered.** The wrapper's
`ComparisonData` interface (`:6–21`) omits `investor_matches`, so investor-profile
matching — which the analysis writes for every comparison — reaches neither the
PDF nor the fallback.

**F6 — no fidelity test of any kind.** The only test naming comparison is
`comparisonConfiguration.test.ts` (23 lines), covering weight validation.

**F7 — the format was invisible to the design programme.** Not in
`DESIGN_SYSTEM.md`, no Target class, no format doc, and `property_comparisons`
absent from `TABLE_TO_MODULE_MAP` in `_shared/permissions.ts`.

### What the stored data holds — `property_comparisons`, 50 rows

**F8 — half the record was unreadable, and the cause is measurable.**
Two storage shapes coexist, both stamped `structure_version = 1`:

| Shape | Rows | State |
| --- | --- | --- |
| A | 23 | the seven jsonb columns populated, `executive_summary` short prose (792–1,851 chars) |
| B | 27 | **all seven jsonb columns NULL**, `executive_summary` holding 16,136–20,425 chars of the model's raw response |

Every Shape B blob is **truncated mid-token**; only 2 of 27 close their own brace,
and 8 are still wrapped in a ` ```json ` fence. The cause is in the producer:
`compare-investment-reports/index.ts:494` asks for `maxTokens: 12000`, the parse
fails at `:582`, and the `catch` stores the raw string with the columns left NULL.

The damage tracks the property count exactly, which confirms it:

| Properties | Comparisons | Truncated |
| --- | --- | --- |
| 2 | 7 | 0 (0%) |
| 3 | 17 | 5 (29%) |
| 4 | 9 | 6 (67%) |
| 5 | 17 | 16 (94%) |

Both the PDF and the on-screen viewer print that raw blob as "Executive Summary"
prose: `ComparisonViewer.parseIfNeeded` (`:68–90`) strips the fence, tries
`JSON.parse`, and **returns the cleaned string on failure**.

> **Both halves of F8 are fixed — see §12 at the end of this document.** The
> producer no longer asks for a ten-section document under a flat 12,000-token
> ceiling and no longer stores an unreadable response as a success, and the
> viewer now takes the same reading of a stored row that the render route does.
> The figures above are the record as it was measured, and the damaged rows are
> still in the table: salvage remains a read-time view and nothing is backfilled.

**F9 — `finalScore` is on two scales, and the newest row uses the older one.**
17 comparisons score 0–100 (41 → 88.5); 6 score 0–10 (0 → 9.2). Not a fixed legacy
tail: the 0–10 group runs to **2026-07-23, the most recent comparison in the
table**, so the producer still emits both despite the one-off
`migrate-comparison-scores` rescale.

**F10 — `propertyNumber` is 1-based and `0` means "nobody".** Of 92 winner
pointers in `financial_comparison`, 74 name a property, 6 are `0` and 12 are
`null`. A naive `properties[n - 1]` reads index `-1` on those.

**F11 — 6 of 186 `report_ids` references no longer resolve.**

**F12 — `analysis_summary` is not a summary.** On 44 rows it holds a settings blob
— `{"timeHorizon":"5-7 years","riskTolerance":"moderate","customWeights":null}` —
so no comparison document has ever stated the assumptions behind its own ranking.

**F13 — the comparisons list and archive toggle are gated on authentication
alone.** They go through `manage-templates`, whose `assertTemplatePermission` map
(`index.ts:272–279`) returns `null` for `property_comparisons`, and `null` skips
the check entirely. **Recorded, not fixed** — the one-line change turns a
currently-succeeding archive into a 403 for anyone without `reports/can_edit`,
which is a behaviour change with its own blast radius and does not belong inside
a report migration.

---

## 2. Where the boundary is

The other three formats each trust part of their source. This one trusts none of
it: every field the document prints was written by a model in a single response
and stored without schema validation. There are **no deterministic figures at
all** — a comparison carries a ranking, ten superlatives naming a winner apiece,
and prose. So the whole payload is optional structure, and the normaliser reads
it the way Cash Flow reads the wire.

The single number it does carry, `finalScore`, arrives on two scales, which is
why it is modelled as a value *and* its denominator rather than as a figure.

---

## 3. Salvage — reading back a record that was cut off

`salvage.pure.ts` is a module the other three formats did not need.

### What it refuses to do

The obvious approach — take the longest prefix that parses — is wrong in the one
way that would never show up on the page. To make a truncated prefix parse you
must *repair* it by closing whatever brackets are open, and closing an array
mid-element hands back a **partial last element**: a ranking with an address and
no score, printed on a client's document as though it were whole, indistinguishable
downstream from a real one.

So this module never repairs. It scans once, left to right, and records a
top-level pair only after seeing that pair's terminator — a comma or the closing
brace at depth 1, outside a string. An array cut mid-element never reaches its
terminator, so it is never recorded, so a partial element **cannot exist** in the
output.

That is not an assertion of intent. `salvage.spec.ts` truncates a fixture at
every character and counts partial rankings. The design produces **0**. The
rejected approach, implemented and measured, produces **228** — and takes 13
seconds where this takes milliseconds, because shrinking-prefix retry is
quadratic.

### What it recovers, measured against all 27 damaged rows

| Section | Recovered |
| --- | --- |
| `executiveSummary` | 27 / 27 |
| `rankings` | 27 / 27 |
| `financialComparison` | 27 / 27 |
| `locationComparison` | 27 / 27 |
| `riskComparison` | 26 / 27 |
| `investorMatches` | 27 / 27 |
| `marketTiming` | 23 / 27 |
| `competitiveAdvantages` | 10 / 27 |
| `redFlags` | 9 / 27 |
| `recommendations` | 2 / 27 |

The tail of the schema is what truncation eats, which is why the section written
last survives least.

### Two things the record taught

- **The producer names its last section twice.** `finalRecommendation` and
  `recommendations` have the same shape and the writer maps either into the same
  column. Treating them as one key recovers it on two more rows and stops
  `missing` reporting a section the result is holding.
- **`marketTiming` and `competitiveAdvantages` have no column to live in.** The
  writer that destructures a successful response into seven columns discards
  them, so they exist **only on the damaged rows**. A salvaged document carries
  more of the analysis than an intact one. That inversion is real and the
  document renders them where they exist.

### Placeholders, not omission — a departure from the Portfolio precedent

The other three formats drop a section whose block is missing, and are right to:
absence there is incidental and unknowable to a reader. Here it is systematic —
`recommendations` survives on 2 of 27 — and a ranked comparison that silently
omits *which one should I buy* reads as a finished document that forgot to answer
its own question.

So on the salvaged path a missing section is **still built, numbered and listed**,
with a body naming what is absent, and the contents page reads "Not saved with
this comparison" against it. The first chapter opens with a callout that
distinguishes *not found* from *never written*, because one implies a lookup
failed and the other tells the reader what to do. On the `columns` path a null
column drops its section exactly as before.

**No backfill.** Salvage is a read-time view; the route never writes to the table.
Writing recovered JSON into the seven columns would create a second answer to
"what did the model say" and make `structure_version = 1` mean three things.

---

## 4. The two score scales

Detected once per comparison from the **maximum of the whole set**, never per
score. That is the defect in `migrate-comparison-scores/index.ts:90`, which
rescales any individual score below 15 by ten — under which a genuine 12/100
becomes 120/100. The scale is a property of the model call, not of a number.

Every score prints with its denominator — `88.5 / 100`, `9.2 / 10` — and never
bare. Nothing is normalised: a 9.2/10 printed as "92/100" would assert a number
the model did not write.

**The failure mode, stated:** a comparison genuinely on 0–100 in which *every*
property scored ≤ 10 would be read as 0–10 and printed `9 / 10` when the record
means `9 / 100`. It requires the whole set to be near-worthless; no row does this
(the 0–100 floor is 41), and it contradicts the producer's own instruction at
`compare-investment-reports/index.ts:322`. The check that would remove it is a
`scoreScale` column on the producer, which is out of scope. `score_scale` is
recorded in the ledger so the inference can be audited rather than trusted.

**A forward-looking guard:** when any score exceeds its own denominator the scores
still print — the record is what it is — but the ranking chart returns `''`,
because a bar past its own axis is a drawing that lies. Zero rows are in that
state today; this guards a re-run of that migration.

---

## 5. What the document is made of

Twelve sections at most, from a bounded subject: `compare-investment-reports`
accepts 2 to 5 properties.

| # | Section | Slot | Appears when |
| --- | --- | --- | --- |
| — | Cover | `cover` | always |
| — | Contents | `contents` | always, generated from the spine |
| 1 | What this comparison found | `chapter` | always |
| 2 | Who wins what | `wide-table` | always |
| 3 | Each property in turn | `chapter` | any ranking carries prose |
| 4 | The money | `chapter` | `financialComparison` |
| 5 | Location and lifestyle | `chapter` | `locationComparison` |
| 6 | Risk | `chapter` | `riskComparison` or risk levels |
| 7 | Before you commit | `chapter` | `redFlags` |
| 8 | Who each property suits | `chapter` | `investorMatches` — **never rendered by the legacy (F5)** |
| 9 | What sets each apart | `chapter` | `competitiveAdvantages` — salvaged records only |
| 10 | Timing and holding | `chapter` | `marketTiming` — salvaged records only |
| 11 | What we recommend | `chapter` | `recommendations` |
| 12 | On what basis | `chapter` | always — the settings from F12 |
| — | Contact & disclaimer | `closing` | always |

**The verdict goes first**, which inverts the producer's order and the legacy
markdown's. Someone who chose to compare properties does not need walking to the
answer, and on a truncated record it means they learn the record is incomplete in
the first ten seconds rather than after eight sections.

**The scorecard is landscape for consistency, not geometry.** With two to five
columns it would fit portrait; the Portfolio's holdings matrix is landscape even
for a one-property portfolio, and a format whose central table changes orientation
with the row count hands a reader two different-looking documents for the same
report type. Checked by rendering a two-property and a five-property comparison
and reading both.

**Page band `[8, 32]`.** All 50 stored comparisons render between **16 and 26**
pages. The floor is the arithmetic minimum rather than the observed one; the
ceiling carries headroom, because a five-property comparison with every section
*and* a placeholder for each lost one is longer than any row has been.

---

## 6. The charts

Two, plus a matrix. Fewer than the other formats carry, because the third
candidate could not be drawn without inventing an axis.

**Ranked score bars** — *how far apart are they?* The table gives the order; what
decides whether the ranking means anything is the gap. Axis set to the detected
denominator, value printed beside each bar, and a caption that says "close to a
tie" when the spread is under 5%.

**Category wins, as a donut** — *a sweep, or a split?* The ten superlatives are
scattered across three sections, and whether one property took them all is visible
nowhere. Axes naming nobody form a stated "No clear winner" segment rather than
vanishing.

**Who wins what, as a banded matrix** — categories as rows, properties as columns.
**Positive axes only**: `highestRisk` names the property that came off *worst*,
and a tick against it in a matrix whose ticks mean "won this category" asserts the
opposite. It keeps its row in the risk section, where the word "highest" is beside
it.

**Rejected, with reasons:**

- A **risk-against-rank quadrant** — the most decision-relevant unanswered
  question in the format, and still not drawn. `riskLevel` is free text with ten
  distinct values in the record (`Low-Moderate`, `Moderate`, `Moderate-Low`,
  `Moderate-High`, `Moderate to High`, `High`, `High (Undetermined)`, `Very High`,
  `Critical`, `Extreme`) — three spellings of one idea, and one meaning "unknown,
  assume the worst" rather than a level. A numeric axis over that manufactures
  precision. **The question is answered by a column instead**: the risk band sits
  beside the rank in the verdict table.
- A **score wheel over the properties** — a radar's spokes must be dimensions of
  one subject; one spoke per property makes the shape an artefact of selection
  order.
- A **score wheel over the criteria** — the right shape, and the data is not
  stored: only `finalScore`, no per-dimension breakdown.
- A **gauge** on the top score — already the largest thing in the KPI strip, and a
  0–100 dial lies on the six comparisons scored out of ten.
- A **heatmap** of property × category — the scorecard is binary, so it would be
  one hot cell per column and could not carry the winner's reason.
- A **waterfall** (nothing accumulates) and a **bullet** (no target).

---

## 7. The render path

`render-property-comparison-pdf` holds the six properties the other three hold,
with one departure.

**Authorisation is the module permission as the gate, not a fallback.** There is
no `client_id` on this table, its RLS is `created_by = auth.uid()`, `created_by`
is NULL on 38 of 50 rows, and of the 12 that have one **none** points into
`auth.users` — so the stored policy matches nothing for a real caller and
ownership alone would refuse three quarters of the record. `reports / can_view` is
the key `render-investment-report-pdf` applies to the reports a comparison is
derived from, so a comparison cannot become a way to read what you could not read
directly. **403** for the gate, **404** for a missing row.

The client is resolved two hops out through
`report_ids → investment_reports → client_properties` and named on the cover only
when exactly one resolves — a comparison spanning two clients' properties is a
real thing and naming one of them would be wrong. Dangling reports are noted in
the document; a comparison where *none* resolves is refused with a 400, because it
cannot be reproduced.

**It is not metered.** The legacy is (F1) — because it asks a model on every
download. Typesetting a stored row asks nothing of any model, so re-rendering is
free, deterministic, and carries no cost estimate. **This is the largest
behavioural change in the migration.**

Storage: `property-comparisons/<comparisonId>/typeset/<date>/<uuid>-<name>` in
`client-files`, keyed by the comparison and never by an inferred client. Filename
`Property_Comparison_<n>_Properties_<date>_<REF8>.pdf`, where `REF8` matches the
cover foot, so "which PDF is this?" is answerable from either end.

`property_comparison_renders` carries three columns no prior ledger needed —
`source_shape`, `recovered_sections`, `missing_sections` — plus `score_scale`, and
is indexed on `source_shape`, because *"how many documents did we send from a
truncated record"* is the question this whole design exists to make answerable.

---

## 8. The legacy stays, and its engine was never opened

`ComparisonPDFGenerator.tsx`, `PixelPerfectPDFGenerator.tsx` and
`format-comparison-report` — metering included — are **not touched by this work**.

The second of those matters most: 3,626 lines of pdf-lib **shared with the
investment report format**. Retiring or breaking it takes a second, unrelated
document down with it, and nothing else in the suite would fail.

`requestComparisonPdf` takes **no legacy fallback**, and here that is not a choice:
`ComparisonPDFGenerator` has no importable entry point, and
`PixelPerfectPDFGenerator` exposes only a ref handle returning a URL. An undeployed
route fails with a message naming the button that works.

`ComparisonDownloadButton`'s second item therefore **cannot be a download**. It
opens the viewer where the legacy button lives, and it states what pressing it
costs:

> **Download the AI-written report**
> *Re-written by AI on every download — uses report credits, and the wording
> differs each time.*

That sub-label is the only place in the product that tells anyone F1 is true.

### Where the new control is offered

| Surface | Before | Now |
| --- | --- | --- |
| `library/ComparisonReportCard.tsx` | View Analysis / Archive — **no download at all** | the control, `menu` appearance |
| `ComparisonViewer.tsx` | the AI-written report in the dialog title | the control beside it |
| `PropertyComparisonModal.tsx` | the AI-written report in the results toolbar | the control beside it |

The library card matters most: it renders every saved comparison, and until now
the only way to get a PDF was to open the viewer — which fires a metered model
call before it will show you a button.

---

## 9. Tests

| File | Asserts |
| --- | --- |
| `propertyComparisonSourceOfTruth.spec.ts` | one bridge per canonical module; import discipline; purity |
| `salvage.spec.ts` | fences, cuts mid-string / mid-key / mid-array / mid-number, the alias, the bound — and a **fuzz at every character** asserting it never throws, always terminates, and never yields a partial ranking |
| `normalise.spec.ts` | pointers (1-based, `0`, null, out of range); both scales; the ten risk spellings; axis polarity; both shapes; the settings blob |
| `render.spec.ts` | contents matches what is built; no tick for being riskiest; denominators; the truncation callout and its placeholders; the tenant's cover; escaping; an invalid spine refused; the spine inside its band for 2–5 properties |
| `legacyPathStays.spec.ts` | the wrapper, the shared engine, the formatter and every mount site still exist and are wired; the new path never imports either component, never invokes the formatter, is not metered, and never writes back |

Four guarded properties were verified by deliberately breaking them: the salvage
algorithm (228 partial rankings from the rejected approach), removing the legacy
generator from the viewer, dropping the new control from the library card, and
adding a fallback that calls the metered formatter. The third of those exposed a
weak assertion — a leftover import satisfied a substring search — which is why the
suite now checks for the JSX tag rather than the identifier.

---

## 10. Deployment

Two manual steps, in this order:

1. Apply `supabase/migrations/20260817000000_property_comparison_render_path.sql`.
   The DDL was executed against production inside a transaction and rolled back,
   so it is known to run.
2. Deploy `render-property-comparison-pdf`.

Until both are done the new items fail with a message naming the AI-written
report, which keeps working throughout.

> Still outstanding from earlier work: `render-investment-report-pdf` is deployed
> at v9 from 31 July, so the `ReferenceError` fix has not shipped. Investment
> report PDFs keep failing until that function is redeployed.

---

## 10. The Template Library masters

Separate from sections 1–9, which describe the format's own generator. This
section describes the same comparison drawn as **50 Template Library masters**
in the ten Investment Compass design families — a different destination for the
same data. Both stay.

### The projection normalises nothing

This is the one thing to understand before touching
`supabase/functions/_shared/comparisonProjection.pure.ts`. The other three
formats on the family system each got a bespoke projection that reads their
stored row, because none of them had a normaliser to share. **This one does** —
the modules in §2 and §3 — so the projection takes `buildPropertyComparison`'s
output and restates it in the vocabulary a template binds. It reads no column.

That is not tidiness. Every hard question in this record has exactly one right
answer and three wrong ones that still render:

| | Answered by |
| --- | --- |
| 27 of 50 rows truncated mid-token | `salvage.pure.ts`, which never repairs a cut-off array |
| `finalScore` on two scales | `detectScale`, once per comparison, with a confidence flag |
| 43 of 253 winner pointers naming nobody | `propertyAt`, which returns null rather than reading index −1 |

A second reader would eventually disagree with the first on one of them, and the
disagreement would surface as a client's document rather than as a test failure.

### Everything is nested under `comparison`

The natural top-level names — `properties`, `ranked`, `risks`,
`recommendations` — are already taken. `risks` is a list of `{risk, why,
action}` to the voice templates, `recommendations` is a list of strings to the
Borrowing Capacity masters, and `properties` is a portfolio's holdings. In
production each report type gets its own data object and nothing would notice;
in the Template Library's shared preview sample, whichever loaded last would
win and the other format's pages would render somebody else's content.

`client` and `report` stay at the top level, because they are ambient and mean
the same thing to every format.

### The ranking is drawn four times

A comparison ranks **2 to 5 properties** — 7 rows compare two, 17 three, 9 four
and 17 five. A fixed table has to choose between printing three empty rows on
the two-property comparisons and silently dropping three properties on the
five-property ones. The second is `PORTFOLIO.md`'s F4 in a new format.

So the ranking table is built once per count, each variant carrying a
conditional on `comparison.ranked.length`, **all four placed at the same `y`**.
Exactly one renders. `FlowItem.block` returns several blocks for this purpose
and the item's height is the tallest variant's, so what follows clears them all.

The same shape covers the risk register and the investor matches: one block per
property, each conditional on that property existing. Those cost their height
whether or not they render, which is what a conditional costs in a layout that
cannot reflow.

### The page budget is measured, not assumed

Eleven superlatives whose `reason` runs to **604 characters** is 6,600
characters of prose on its own, which is why the reasons take six pages at two
axes each rather than three at four. The first draft put four to a page and ran
154pt past the footer on five of the ten families. The measurements the
composer is built from:

| Field | max | Drives |
| --- | --- | --- |
| `executive_summary` | 1,851 | its own page |
| superlative `reason` | 604 | two axes to a page, six pages |
| `bestOverall.reason` | 571 | the verdict callout |
| alternative scenario | 517 | the basis page |
| `avoid` / runner reason | 400 / 383 | the actions page |
| investor `reasoning` | 399 | three matches to a page |

`recommendations.runners` and `recommendations.avoid` have a **minimum of zero**
across the stored rows, so both sections are conditional rather than drawn
blank.

### Tests

| File | Asserts |
| --- | --- |
| `comparisonProjection.spec.ts` | the restatement keeps the score with its denominator, says "no clear winner" rather than pointing at a property that was never named, reads back a truncated record, and never publishes a half-written ranking row — asserted by cutting a fixture at every step |
| `comparisonCatalogue.spec.ts` | 50 masters across 10 families, slugs disjoint from the other three catalogues, nothing bound outside `comparison`, four ranking variants at one position covering counts 2–5, exactly one rendering per count, and every bound score paired with its `outOf` in the template source |

---

## 12. The producer — where the two shapes came from, and why there are no longer three

Sections 1–11 describe reading these rows. This one is about writing them, and it
is the one that had to change: on **2026-08-19** a comparison came out of
`compare-investment-reports` holding an executive summary and nothing else — no
ranking, no scorecard, no recommendation — and the function returned **200** with
`success: true`.

### What the record said

53 rows, of which **30 have all seven structured columns NULL**. That is not a
legacy tail: the three most recent comparisons in the table are all in it, and
they are three *different* failures, each stored as a success.

| Rows | What came back | Old outcome |
| --- | --- | --- |
| 25 | cut off mid-token, 8 of them still inside an unclosed ` ```json ` fence | raw blob in `executive_summary`, columns NULL |
| 4 | closes its own brace and still does not parse — `]` where `}` belongs, at line 225 of 251 | same |
| 1 | parsed, and carried `executiveSummary` alone | **prose** in `executive_summary`, columns NULL |

The first two are Shape B and §3 reads them. **The third is neither shape.**
`salvageTruncatedJson` returns `null` for text that is not JSON, and the columns
path needs a column, so `render-property-comparison-pdf` refuses it and the
viewer shows one tab with a paragraph in it. It is the only row in the table that
no reader in this repository can render.

### Three causes, each sufficient on its own

**The output budget was shared with the model's reasoning.** `report_comparison`
is assigned `google/gemini-2.5-pro` in `agent_model_assignments`; `max_tokens` on
an OpenAI-compatible gateway is the *whole* output allowance, and a 2.5-series
model spends thousands of it thinking before it writes a character. The request
asked for a flat `maxTokens: 12000` regardless of size. The damage tracks the
property count exactly — 0 of 7 two-property comparisons, 16 of 17 five-property
ones — which is the signature of a ceiling, not of a model that could not answer.

**Nothing asked for JSON except the prose.** No `response_format` was sent at
all. The system prompt says "respond with ONLY valid JSON … no ```json wrappers";
8 stored rows carry one anyway, and 4 more balance their brackets by count and
not by type.

**Every outcome was stored as a success.** The `catch` wrote the raw text to
`executive_summary`, left the columns NULL and returned 200; and the *success*
path had no check of its own, so a response that parsed and carried one section
was written the same way a complete one was. Nothing retried, nothing warned, and
`token_audit_log` committed the charge on all of them.

### What it does now

`_shared/reports/propertyComparison/analysisRequest.pure.ts` carries the request
and the reading; the edge function is the loop around it.

- **The room is fitted to the job.** `comparisonOutputTokens` scales with the
  property count, from the measured length of a complete response plus a
  reasoning allowance on top of it rather than inside it. The two errors are not
  symmetric — headroom the model does not use costs nothing, because billing and
  latency both follow the answer's length and not the ceiling, while too little
  costs the document and the 75 seconds spent on it.
- **The shape is asked for as a schema.** `COMPARISON_ANALYSIS_SCHEMA` mirrors
  the prompt's literal, and a spec asserts its top-level keys are
  `COMPARISON_SECTIONS` — the same list the salvager reports `missing` against
  and the normaliser reads. Three descriptions of one shape drifting apart is how
  `investorMatches` came to be written by every comparison and rendered by none.
- **The ask degrades rather than failing.** `json_schema` → `json_object` →
  nothing, one rung at a time, dropped only on a 4xx whose body names the field
  (never on a 429, a 402 or a 5xx — weakening the guarantee for a capacity
  problem would quietly degrade every later call), and dropped once more when a
  rung returns something unusable, because a gateway that accepts a
  `response_format` it cannot honour is indistinguishable from a bad answer. The
  worst case of an unsupported schema is therefore the old behaviour, never the
  loss of the comparison.
- **A parse is not an analysis.** `readAnalysisResponse` returns `complete`,
  `partial` or `unusable`, and a payload without at least two ranked properties
  is `unusable` however cleanly it parsed. Every chapter of the document is built
  from the ranking.
- **A failed attempt is retried, inside the invocation.** Up to three, stopped by
  a 120s wall-clock budget that starts another attempt only when one the size of
  the last still fits — the discipline `generate-investment-report` keeps with
  `SECTION_LOOP_BUDGET_MS`, and for the same reason: a run that is killed teaches
  its caller nothing. `preferReading` keeps the best attempt, so a retry that
  comes back worse never replaces what is already in hand.
- **What is stored is always one of the two shapes.** A response that parsed
  whole is written to the columns, and a section it had nothing to say about is
  ordinary absence, dropped silently as the other formats do. A response that did
  **not** parse whole is stored as the model's own text with the columns NULL —
  Shape B, which §3 reads and which makes the document name what it lost. A
  parsed fragment with NULL columns is never written again.
- **An unusable answer is a failure, and free.** The route returns
  `success: false` with a 502, which `decideMeteringOutcome` reads as a release:
  the reservation is refunded, nothing is stored, and no phantom appears in the
  library. A partial answer still commits, because the caller received a
  document — and the response carries `incomplete`, `missingSections` and
  `recoveredSections` so the browser can say so. Deliberately **not**
  `isComplete: false`: the metering wrapper reads that as "one chunk of a longer
  run landed" and would hold the reservation open forever.

### One reader, not three

`readStoredAnalysis` (`storedAnalysis.pure.ts`) is the shape decision, lifted out
of `buildPropertyComparison` unchanged and now shared with the screen.

This is the rule §11 states for the projection, applied to the same rows: every
hard question about this record has one right answer and several wrong ones that
still render, so a second reader disagrees with the first eventually and the
disagreement surfaces as a client's document rather than as a test failure. It
already had. `ComparisonViewer.parseIfNeeded` tried `JSON.parse` on the stored
text and **returned the cleaned string when it failed**, so all 30 damaged rows
rendered as 16 KB of raw JSON on screen under the heading "Executive Summary",
with every tab reading "No … data available" — beside a download button whose
PDF read the same row correctly. The viewer now takes the same reading, shows
the sections that survived, and states which ones were never saved. The record
is not backfilled: salvage stays a read-time view, exactly as §3 requires.

### Not touched

`compare-cash-flow-reports` shares the shape of the old model call and is **not**
in this state: it asks for a far smaller schema under `maxTokens: 4000`, and on a
parse failure it returns a 500 rather than storing a row. Its fence regex has the
same flaw, and it cannot bite — a response short enough to be fenced whole is
matched, and one that was cut off would not parse either way. The legacy PDF path
(§8) stays as it was, for the reasons recorded there.
