# Market Intelligence exports — the contract

The eighth format on the shared report design system, and the second whose
payload is model-authored Markdown rather than typed figures. That is why
`_shared/reports/markdown.pure.ts` — built for the Report Q&A migration — moved
out of `reports/reportQa/` to sit beside both formats rather than being copied.

Read [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) first for the shared architecture,
and [`QA.md`](./QA.md) for the Markdown renderer itself, which this format uses
unchanged.

---

## 1 · What was there before

One implementation: `src/components/marketing/MarketIntelligencePDFGenerator.ts`,
a browser-side jsPDF class driven from `MarketIntelligenceExportButton.tsx` and
`MarketIntelligenceHistoryModal.tsx`.

### D1 — the table of contents lists sections the document does not print

The TOC is built from `includedLayers` alone (`:301-345`), while a section is
printed only when its layer came back with content. The edge function runs
layers 1/2/3/6/7 in parallel, each with a `.catch` that returns empty
(`generate-market-intelligence-report/index.ts:616-652`), so a failed layer
produces a silently empty section rather than an error.

**6 of the record's 46 layer bodies are empty strings.** The reader gets a
contents page numbering sections that are not there, and the numbering after the
gap silently drifts.

Here an empty layer gets **no chapter and no contents entry**, and the document
names it in the opening lede and again in a callout — *"2 layers returned no
data: Consumer & Investor Sentiment, Regulatory & Policy Watch"*. The contents
page cannot list something that was not printed, which is the one structural
assertion every format in this programme carries.

### D2 — the correlation block has never been persisted

`MarketCorrelationPanel` passes `correlationData` to the export button in memory
(`MarketCorrelationPanel.tsx:128` → `MarketIntelligenceExportButton.tsx:91`),
which hands it to the browser generator. Nothing wrote it to the row. The
History modal only has the row, so **re-downloading a correlation report has
always silently dropped that whole section**.

Measured: 0 of the 6 stored reports carry a correlation block.

`generate-market-intelligence-report` now accepts `correlation_data`, bounds it
and writes it into `report_data`, and the export button sends it. The six
existing rows still do not have one, and the document says nothing rather than
pretending — there is no section for a block that is not there.

### D3 — `pdf_storage_path` has never been written

`dispatch-marketing-reports:323` reads that column to attach a PDF to a
scheduled marketing email. Measured against production: **6 reports, 0 paths,
and the `marketing-reports` bucket holds 0 objects** — it has been empty since
the DDL created it in April. The first time that dispatch runs it attaches
nothing, silently.

The new route writes it, and `persist` defaults to on for that reason. The
storage path is **stable per report** rather than carrying a random segment,
unlike every other format in the programme: `pdf_storage_path` is one column
holding one location and the dispatch reads whatever is there, so a re-render
replaces the file. That is what "the current PDF for this report" means.

### D4 — the payload is cast, not validated

`MarketIntelligenceHistoryModal.tsx:70` casts `report.report_data` straight to
its interface and typesets whatever arrives. The new route reads the row
server-side and the request carries a report id and nothing else.

### D5 — no ceiling on a runaway layer

One layer's `content` reached **244,332 characters** in the record — twenty
times the 12,169-character average, and four-fifths of that report's entire
payload on its own. The legacy prints all of it.

### D6 — the format was invisible to the design programme

No archetype implementation, no ledger, no contract, no test. The declared
`market-intelligence` archetype's note described *"comparables, trends and
commentary for a locality"*, which is not this document and never was — it reads
as having been written from the archetype's name rather than from the generator.

---

## 2 · What the record holds

Six reports, 46 layer bodies.

| | |
| --- | --- |
| layer body, p50 / p90 / max | 3,892 / 15,229 / **244,332** chars |
| empty layer bodies | 6 of 46 |
| ATX headings / bullets / inline bold | 37 / 31 / 36 of 46 |
| ordered lists / GFM pipe tables | 10 / 11 of 46 |
| URLs, Markdown links, pictographs, dingbats | **none** |
| largest `marketEvents` array | 17 |
| largest citation list | 21 |
| rows with `pdf_storage_path` | **0** |
| rows with `correlationData` | **0** |

The one genuinely structured leaf is `marketEvents`, which the edge function
gets back from a forced tool call against a strict JSON schema
(`index.ts:159-188`). Everything else is a prose contract stated in a prompt,
which is why the generator being replaced parses it so fragilely.

The newer fields — `keyInsightsSnapshot`, `actionableStrategy`, `ctaContent`,
`layer7_micro`, `layer8_competitive_edge`, `reportType`, `reportTypeLabel`,
`audienceSegment`, `includedLayers` — are absent on the one `market_pulse` row
and present on the five `full` ones, so a reader has to treat each as **missing**
rather than empty.

---

## 3 · What was built

`supabase/functions/_shared/reports/marketIntelligence/`:

| Module | Owns |
| --- | --- |
| `payload.pure.ts` | `LAYER_ORDER`, `LAYER_TITLES`, the caps, `audiencePanelCount` |
| `normalise.pure.ts` | the four editorial strips, `buildMarketIntelligenceReport`, `narrativeFor`, `layerSummary` |
| `sections.pure.ts` | `planSections`, `chaptersFor`, `contentsPagesFor`, the measured line costs |
| `render.pure.ts` | the document, the events and sources tables, the audience panels |
| `route.pure.ts` | `parseRenderRequest`, the filename, the storage path |

One `export *` bridge each in `src/lib/reports/marketIntelligence/`, constrained
by `marketIntelligenceSourceOfTruth.spec.ts`.

### The layers print out of numeric order, deliberately

1, 2, 3, 4, 6, 7, 8, then **5**. Layer 5 is the 90-Day Strategic Outlook and it
synthesises the others, so it reads last. `generate()`
(`MarketIntelligencePDFGenerator.ts:1013-1147`) has always done this; naming the
order in `LAYER_ORDER` rather than leaving it implicit in a render function is
what stops it being "corrected" by someone sorting the keys.

### The audience is a render-time choice

The segment decides the closing panels on the suburb layer and the cover's
edition line, and **nothing else** — every word of model output is identical
between editions. So an investor edition and a homebuyer edition of one stored
report are two renders rather than two generations, which is what the legacy
required. `parseRenderRequest` constrains it to the three the format knows; an
unrecognised value falls back to the row rather than failing, because a stale
bookmark should still produce the report it names.

`audiencePanelCount` lives in `payload.pure.ts` and is read by both the planner
(to charge for the panels) and `render.spec.ts` (which counts the callouts
`audiencePanels` actually emits). Two facts in two modules would otherwise drift
and the section would simply under-claim by a page with nothing to say so.

---

## 4 · The page budget was fitted by render, not by arithmetic

Every constant in `sections.pure.ts` was pinned by binary search through local
WeasyPrint — a chapter carrying only N of one block, rendered at several N, with
the page count read back to bracket the constant from both sides.

| Constant | Value | Bracketed by |
| --- | --- | --- |
| `SECTION_FURNITURE_LINES` | 3 | the six document fixtures |
| `LINES_PER_CALLOUT` | 6 | 4 / 8 / 12 callouts → 1 / 2 / 2 pages |
| `LINES_PER_SIDENOTE` | 5 | 4 / 8 / 12 / 16 → 1 / 2 / 2 / 3 pages |
| `LINES_PER_TABLE_ROW` | 1.7 | 10 / 20 / 30 / 40 / 50 rows → 1 / 2 / 2 / 2 / 3 pages |
| `TABLE_FURNITURE_LINES` | 4 | the same run |
| `CONTENTS_LINES_PER_PAGE` | 44 | 11 entries with three-line notes fit, 12 do not |
| `CONTENTS_NOTE_CHARS` | 33 | the note column's measured wrap |

### What the renders found

The first pass copied `SECTION_FURNITURE_LINES = 13` from the Report Q&A and
over-claimed every document by four to seven pages, because `pagesForLines`
already floors each section at one page for its chapter header and the copy
charged for it twice. Cutting it to 3 then **under**-claimed by one to three,
and the reason was structural rather than a constant being slightly wrong:
three blocks the document prints were not counted at all — `renderDataTable`'s
rows, the sidenote under each market event, and the callouts the renderer
appends to two sections. A per-line fudge factor would have hidden that;
costing the blocks named it.

Claimed against actual, after:

| Shape | Claimed | Actual |
| --- | --- | --- |
| `market_pulse`, four layers | 14 | 14 |
| `full`, three layers empty | 18 | 18 |
| `full` | 23 | 23 |
| investor edition | 22 | 23 |
| with a correlation block | 24 | 24 |
| the 244,332-char layer, clipped | 31 | 29 |

Four exact, one under by a page, one over by two.

### The contents page needed a second page, and the spine could not claim one

`buildSpine` fixed the contents at one page. This is the first format with
enough chapters — fourteen or fifteen, each with a note — to run onto a second,
so every large report under-claimed by exactly one page and nothing noticed.
`BuildSpineInput` gains an optional `contentsPages`; formats that do not pass it
are unchanged.

The same render showed the last contents entry splitting across the page break —
its number and note on page two, its title alone on page three, so the contents
page listed a section with no name. `css.pure.ts` now sets `break-inside: avoid`
on `.toc-row`.

### The band is set by the caps, not by the observed reports

A deliberate departure from how the other seven bands were pinned. The render
route treats a band violation as fatal, so a band tighter than what
`MAX_SECTION_CHARS` and `MAX_DOCUMENT_LINES` actually permit would throw away a
document that was correct, clipped, and honest about it.

Measured at the caps: one runaway layer clipped to the section cap claims 33,
two claim 39, and a payload where every prose block hits the cap claims 44. All
eight layers runaway claims 36 rather than more, because the document budget
starts dropping sections and the page says so. The band is `[5, 46]`. The floor
is the arithmetic minimum and a render confirmed it exactly: a report whose
layers all failed is five pages.

What the ceiling still catches is a cap that regressed — a document that escaped
the clipping entirely.

---

## 5 · Two caps, and what the page says about each

**`MAX_SECTION_CHARS = 20_000`** clips one section. It sits above the p90 layer
(15,229) and below both runaways, so it clips exactly the two pathological
bodies in the record and leaves the other 44 whole. The clipped section carries
a callout naming the exact residue — *"A further 113,531 characters of this
section are not printed here"* — set in the section itself rather than only in
the opening lede, where a reader twelve pages later would not see it.

The first render of that shape printed the clipped text **with nothing to mark
it**. `planSections` had counted the omission from the first draft and the
renderer never asked for the number. Silent truncation arrived at by omission is
still silent truncation, and it is the one failure this programme exists to
remove.

**`MAX_DOCUMENT_LINES = 1_100`** is a last-resort whole-document ceiling. It
skips the summary, the briefing, the next-steps page and the sources — a missing
executive summary reads as a broken document, while a layer dropped off the end
is named in a callout. It does not fire on anything in the record.

An earlier draft used a 620-line document budget with no section cap, and it
dropped a whole section on the runaway shape, which is worse than shortening
one.

---

## 6 · The lede counted the wrong thing

`buildMarketIntelligenceReport` builds the narrative from the layer count,
because layers are all the normaliser has. The document prints **sections**, and
a `full` report has fourteen against eight layers. So the page read *"Full
Market Intelligence Report for April 2026, in 8 sections"* under a cover reading
`SECTIONS 14` and above a contents page listing fourteen.

The Report Q&A migration had the same defect for the same reason — a figure
built before the thing it describes was decided — and the fix is the same:
`narrativeFor` is exported and the renderer rebuilds it from the plan.

Found by reading a rendered page, not by a test.

---

## 7 · A layer's standfirst was its own first sentence

`PlannedSection` carries `note` and `dek` as separate fields, and a layer has no
`dek`. Its note is the opening sentence of the layer, which is right for a
contents-page gloss and wrong as a chapter standfirst: it printed the same
sentence twice within three centimetres, once in italic under the heading and
again as the first line of the prose. It reads as a rendering fault.

The authored notes — *"Now, what to avoid, and when"*, *"12 dated events"* — are
furniture rather than duplicates, so those stay.

The same render showed `markdownToPlainText`'s hard slice ending a standfirst
mid-word on a hyphenated compound: *"…the board's statement noting trimmed"*.
It now cuts on a word inside the same budget and appends an ellipsis, which the
Report Q&A's question lines get too — they truncate through the same call.

---

## 8 · The events timeline

`toEvents` orders the table upcoming-first and then past most-recent-first,
which is the right reading order and looked like a sorting bug on the page: an
August row above a July one with nothing to explain it. The `upcoming` flag had
been derived since the first draft and nothing read it. It is now a **Timing**
column.

Each event's description is a sidenote under the table, labelled with the event
rather than only its date — those blocks run onto a page of their own once there
are more than a few, and a date alone makes a reader flip back to the table.

---

## 9 · The render path

`supabase/functions/render-market-intelligence-pdf/index.ts`.

1. `verifyAuthOrNativeUser`; service-role refused because it is not a person.
2. `requireModulePermission(actor, 'marketing_analytics', 'can_view')`. **One**
   gate, unlike the Q&A's two: these reports are not client-scoped — there is no
   `client_id` on the table and no per-row sharing — so whoever may read the
   Marketing Analytics module may read its reports. `requireModulePermission`
   already lets a superadmin through.
3. One read of `marketing_intelligence_reports`, with **`error` checked before
   `data`** — the defect that 404'd a Borrowing Capacity render and cost a full
   debugging cycle. A row that is not `completed`, or has no payload, is a 400
   the caller can act on rather than a 500.
4. Brand snapshotted then referenced; the tenant's own cover asset. The legacy
   has no cover image at all — it fills page one with a hardcoded navy
   (`:222-233`) — so this gives the format a tenant cover for the first time
   rather than replacing ours.
5. `assertSafeRenderResources` **before** the WeasyPrint POST. No fallback: the
   legacy produces a different document and silently substituting it would send
   somebody something nobody chose.
6. Upload with `upsert: true` to the stable path, then set `pdf_storage_path` —
   after the upload succeeded, so the column can never point at a file that is
   not there. A failure to set it is logged, not fatal: the caller has a working
   signed URL either way.
7. Every attempt leaves a row in `market_intelligence_renders`, succeeded or
   failed.

`supabase/migrations/20260821000000_market_intelligence_render_path.sql` creates
the ledger. The DDL was executed against production inside a transaction with a
real INSERT and an UPDATE round-trip, then rolled back; `to_regclass` confirmed
null afterwards. Indexed on `(report_id, created_at desc)`, on failures, on
`layers_empty > 0` — *"how often are we sending a report with a layer
missing"*, the question D1 creates — and on `persisted`. RLS +
`has_role(superadmin)` select, service-role write.

---

## 10 · The front end — additive

| Surface | Today | Added |
| --- | --- | --- |
| `MarketIntelligenceExportButton.tsx` | generate → jsPDF → download | the typeset control in the success panel |
| `MarketIntelligenceHistoryModal.tsx` | re-download → jsPDF from the stored payload | the typeset control on each completed row |

`MarketIntelligenceDownloadButton.tsx` carries the edition selector and the
"save for the scheduled email" toggle, and repeats in its toast what the
document says on its own pages — somebody about to email a client a report with
two sections missing should find that out before they send it.

`requestMarketIntelligencePdf` takes **no legacy fallback**. On an undeployed
route it fails naming the button that still works.

### Names that must stay

`legacyPathStays.spec.ts` asserts each of these, and each assertion was checked
by breaking what it guards:

- `MarketIntelligencePDFGenerator.ts` — still present, still imports jsPDF
- `generateMarketIntelligencePDF` — still called from both call sites, and
  specifically still inside the History modal's `handleRedownload`
- both legacy buttons — still mounted
- the new modules — import neither jsPDF nor pdf-lib
- `deliverMarketIntelligencePdf` — returns a `Blob`

The History-modal assertion needed scoping to the handler: the modal calls the
legacy twice, once for the re-download and once for the flatten button, so a
file-wide match passed with the re-download gutted. It did exactly that when the
mutation was tried.

---

## 11 · Deliberate losses

- **Emphasis in table cells.** `renderDataTable` escapes every cell, so `**Yes**`
  would print its asterisks. Markers are stripped rather than printed. A cell
  loses weight; it does not lose words.
- **The clipped runaway layer.** Named on the page with its exact residue.
- **Empty layers.** No section, no contents entry, named twice on the page.
- **`sanitise`'s Latin-1 sweep is not carried.** The generator drops every
  codepoint outside a Latin-1 whitelist because jsPDF cannot set them. WeasyPrint
  can, and the container installs `fonts-noto-cjk` precisely so it does.
  Carrying that rule across would cost smart punctuation and delete every
  non-Latin name.
- **`stripMarkdown` is not carried.** The Markdown is the point.

## 12 · Tests

`src/lib/reports/marketIntelligence/__tests__/` — 135 assertions across six
files: source-of-truth, normalise, sections, render, route, legacyPathStays.
Fixtures are fictional.

Every guard was verified by deliberately breaking the thing it guards. Two
passed while their subject was broken and were rewritten:

- the KEEP-set assertion was **vacuous** — the budget accumulates only over
  sections it keeps, and a non-KEEP section is dropped exactly when it would
  push the total past, so the running total never climbed high enough to
  threaten anything. The fixture now puts every prose block at the section cap,
  and a companion assertion checks that the same document does drop what it may.
- the History-modal assertion, above.

## 13 · Deployment

1. Apply `20260821000000_market_intelligence_render_path.sql`.
2. Deploy `render-market-intelligence-pdf`.
3. Redeploy `generate-market-intelligence-report` (the correlation write).

Still outstanding from the previous migration: apply
`20260820000000_report_qa_render_path.sql` and deploy `render-report-qa-pdf`.

---

## 14 · On the Investment Compass families

Fifty masters, plus the projection and adapter that make them production-ready.
This was the last of the ten migrated formats to get them.

### It goes through the normaliser, not the row

Not a preference. `cleanLayerContent` applies three editorial strips before a
word reaches a page — the model's data-limitations hedging, its empty regulatory
sections, and the brand tagline it repeats under the letterhead already carrying
one. An adapter reading `report_data` directly would put all three back on a
client's page, which is the single strongest reason
`marketIntelligenceAdapter` calls `buildMarketIntelligenceReport`.

The brand name is an **input** to that strip rather than decoration, so the
adapter loads the organisation *before* building the report instead of merging it
in afterwards as the other adapters do. Passing an empty name silently disables
one of the three strips.

### The page budget is fitted to what the record holds

Measured across the six stored reports — 48 layer bodies:

| | |
| --- | --- |
| absent entirely | **8** |
| `layer1_rba`, median | 2,291 chars |
| `layer8_competitive_edge`, median | **15,055** chars |
| largest single layer | **244,332** chars — about ninety-nine pages |

No fixed page sequence carries that range. Each layer therefore gets one page
plus two conditional continuations under `marketIntel.layers.N.pages > i`, drawn
by `markdown-block` — the same block Report Q&A uses, which renders Markdown
**source** through the escape-first renderer and so cannot emit markup the model
chose.

Where the allocation bites, the projection publishes a whole sentence naming the
pages not shown and the master gives it a page. That is this format's own
contract rather than an invention: §1 already describes it as the one that clips
a section and says so.

### Empty layers are dropped, and still named

The payload carries empty layers so a document can say it asked. Publishing them
in place would leave holes in the index a template binds by — `layers.3` empty
while `layers.4` has content — so a master would need a conditional per position
*and* per layer.

Instead the projection drops them, leaving `layers.0…n` contiguous, and names
them in `layersOmitted`: *"2 sections were requested and returned no content:
…"*. The document still says what it asked for and did not get.

### Two things deliberately not published

`prose.ctaContent` — the generator's copy for the email the legacy attached this
PDF to. A "book a call" panel in the middle of a market report reads as an
advertisement.

An absent `relevanceScore` stays absent rather than becoming `0`, which would
sort and print as a real judgement of "no relevance".

### One divergence this surfaced

The first build failed on all fifty masters: **`market` is in the TypeScript
`TemplateLibraryCategory` union but not in
`template_library_entries_category_check`**, which accepts `suburb`, `postcode`
and `statewide` instead. The two vocabularies have diverged and the column is the
one that decides.

The masters use `statewide` — of what the column accepts, the only
market-analysis category at a broad geographic scope. Adding `market` to the
constraint would be the better fix and is a migration rather than a template
change.

Worth noting how it was caught: by the seed builder's category guard, at build
time. That guard exists because the Client Details masters shipped the same class
of mistake and were rejected by Postgres **mid-apply, after 290 rows had already
been written**.
