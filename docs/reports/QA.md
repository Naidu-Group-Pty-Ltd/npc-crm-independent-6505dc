# Report Q&A exports — the contract

The seventh format on the shared report design system, and the first whose
payload is prose.

Every format migrated before this one had a typed payload: `Measure` fields,
arithmetic, columns somebody declared in code. This one has a `text` column
holding Markdown a model wrote. That single difference decides most of what
follows — the sections are discovered rather than declared, the page budget has
to be fitted rather than summed, and the central piece of new engineering is a
Markdown → design-system renderer that did not exist anywhere in this repo.

---

## 1 · What was there before

**Four PDF implementations across three libraries, and a fifth with no caller.**

| # | Path | Library | Reachable |
| --- | --- | --- | --- |
| 1 | `src/components/reports/QAPDFGenerator.tsx` (467 lines) | jsPDF | **No — dead code** |
| 2 | `ConversationReportEditor.tsx:135` — the structured report | jsPDF | Yes, via `ConversationExport` |
| 3 | `MessageReportEditor.tsx:144` — one answer | jsPDF | Yes, `ReportQA.tsx:3859` |
| 4 | `report-qa/index.ts:3715` `generate-qa-pdf` — the transcript | pdf-lib | Yes, `ReportQA.tsx:2251` |
| 5 | `report-qa/index.ts:3651` `export-pdf` | a hand-written `%PDF-1.4` string | No caller |

### D1 — the best-maintained copy is the one nobody can reach

`QAPDFGenerator` is referenced only by a comment (`MessageReportEditor.tsx:122`,
*"mirrors QAPDFGenerator template"*). Its code was copy-pasted twice and has
since drifted: `QAPDFGenerator` measures table rows with `calcRowHeight`
(`:142-151`), while `ConversationReportEditor` still uses a fixed
`rowHeight = 8` (`:268`) plus `doc.text(..., { maxWidth })`, so **multi-line
table cells overlap**. 105 of the record's 562 answers contain a pipe table.

Four copies is how a fix lands in one and not the others. One is how it stops.

### D2 — three filename conventions, one of them invalid

`Summary - ${reportNames.join(', ')}.pdf` (unsanitised, so the commas land in the
filename; and its no-reports fallback is
`Q&A Summary - ${new Date().toLocaleDateString()}.pdf`, which with no locale
argument produces `8/2/2026` — **slashes in a filename**),
`${title}_report.pdf`, and `${title}_message.pdf`.

### D3 — two unrelated hardcoded palettes, neither a token

Client side: `15,18,25` ground and `191,155,80` gold — the `#BF9B50` this design
system retired — plus `59,130,246`, Tailwind blue-500, used as a rule under an
H1. Server side: `rgb(0.07,0.2,0.38)` and `rgb(0.89,0.71,0.31)`. All three client
copies also print the fixed subtitle **"Investment Property Analysis"** at the
top of every content page of a Q&A document.

### D4 — every non-ASCII character is thrown away

`sanitizeForPDF` (`QAPDFGenerator.tsx:24-42`) transliterates a handful of glyphs
and then drops every remaining non-ASCII codepoint outside a Latin-1 whitelist.
Measured against the corpus that discards:

- smart punctuation from **389 of 562 answers** (`— – … ' ' " "`);
- every `✓ ✗ ⚠ → ≤ ≥` from **187**;
- **every non-Latin name**, which is what `fonts-noto-cjk` is installed for
  (`typography.pure.ts:54`).

The *architecture* is right — an allow-list, because a deny-list of bad glyphs
can never be complete. It is correct for jsPDF, whose built-in faces are
WinAnsi-encoded. It is entirely unnecessary against WeasyPrint.

### D5 — the cover is a house asset on a white-label tenant's document

`/templates/npc-qa-cover.jpg` hardcoded in all three client copies; the server
path instead copies page 1 of a single global `report_structure_templates` row
where `template_type = 'qa_export'`. Neither is the tenant's own asset.

### D6 — citations never reach any export

`report_qa_messages.citations` is persisted by `buildStructuredCitations`
(`report-qa/index.ts:969-984`) and shown on screen by `Citations.tsx`. Every
exporter redeclares its own thin `Message` of `role | content | timestamp`
(`ConversationExport.tsx:14-18`), so citations, model version, attachments, tool
invocations and pinned state are dropped before any renderer sees them. A Q&A PDF
today carries no source attribution at all.

Zero messages in the record have a citation, so this is a latent defect rather
than a live one — which is exactly when it is cheap to close.

### D7 — the format was invisible to the design programme

No `docs/reports/QA.md`, no archetype, no ledger, and **no test anywhere named
any Q&A export**. `DESIGN_SYSTEM.md:378` classified Q&A as a Track B format and
never specified it.

---

## 2 · What the record actually holds

Measured before the work: 244 conversations, 1,125 messages, 2 distinct authors.
0 shares, 0 feedback rows, 0 tool invocations, 0 agent-mode conversations, 0
client-linked conversations, 0 citations.

Markdown constructs across the 562 assistant answers
(`coalesce(edited_content, content)`):

| construct | answers | | construct | answers |
| --- | --- | --- | --- | --- |
| inline bold | 392 (70%) | | blockquote | 18 |
| bullet list | 321 (57%) | | inline code | 6 |
| ATX heading | 270 (48%) | | fenced code | 6 |
| inline italic | 193 (34%) | | thematic break | 3 |
| ordered list | 181 (32%) | | bare URL | 7 |
| pipe table | 105 (19%) | | markdown link | **0** |
| smart punctuation | 389 (69%) | | markdown image | 1 |

Heading levels: `#` 290, `##` 1,214, `###` 1,536, `####` 192, `#####` 5.
Tables: p90 **5** columns, max **14**; 101 rows in the largest.

Sizes: answer p50 2,203 / p90 10,575 / max 33,377 characters. Structured report
avg 8,193 / max 18,912, bounded by its producer's `max_completion_tokens: 8192`.
Conversation p50 870 / p90 21,387 / **max 354,406** across 35 exchanges — over a
hundred and fifty printed pages.

Glyphs: dingbats U+2600–27BF in 98 answers, arrows in 89, **VS16/ZWJ in 93**,
pictographs in 16.

**204 of 244 conversations have `created_by` NULL.** `resolveReportQaAccess`
returns `denied` for those unless the caller is a superadmin — which is true of
every existing Q&A action, so the new route inherits the behaviour rather than
creating it. Worth knowing before anyone reports the route as broken.

---

## 3 · What was built

```
supabase/functions/_shared/reports/reportQa/
  markdown.pure.ts     Markdown → design-system HTML. The new engineering.
  payload.pure.ts      Three subjects, turns, citations, the budgets.
  normalise.pure.ts    Two tables → a document, or a refusal.
  sections.pure.ts     The discovered spine, and the exact page fit.
  render.pure.ts       The document.
  route.pure.ts        Request, filename, storage path, response.
supabase/functions/render-report-qa-pdf/index.ts
supabase/migrations/20260820000000_report_qa_render_path.sql
src/lib/reports/reportQa/                 six bridges + request/deliver
src/components/report-qa/ReportQaDownloadButton.tsx
```

One shared move: `neutraliseUrls` from
`reports/cashFlowComparison/normalise.pure.ts:131` to
`_shared/reports/text.pure.ts`, re-exported so that format's callers and its spec
are unchanged. Two formats need it; two copies is the defect the move prevents.

One shared edit: the `report-qa` archetype in `reportDesign/structure.pure.ts` —
one union member, one map entry, `FULL_SLOTS`, `contents: true`,
`pageBudget: [4, 30]`.

---

## 4 · Three subjects, one renderer

| Subject | What it is | Spine |
| --- | --- | --- |
| `structured` | `report_qa_conversations.structured_report` — the model's write-up | cover → contents → its own headings become the chapters → sources → closing |
| `answer` | one assistant message, `edited_content` winning over `content` | cover → contents → the answer as chapters, the question above it → sources → closing |
| `transcript` | every exchange as it happened | cover → contents → a chapter per exchange up to twelve, then the rest in one → sources → closing |

`structured` is the only subject that can call a model, and only when the
conversation has no write-up stored and the caller asked for one.

**No charts, and that is a decision.** Every other migrated format has them. This
document is prose, and the only numbers available — message counts, answer
lengths, model mix — are not what the reader wants. Parsing figures out of the
model's own sentences to chart them would put a second answer beside the one the
prose already gives, which is the failure this programme removes: the Borrowing
Capacity waterfall was deleted for disagreeing with the figure beneath it.

---

## 5 · The Markdown renderer

### The stylesheet decides the grammar

`css.pure.ts` styles `h1, h2, h3` (`:635`), `h4` (`:649`), `p` (`:660`),
`strong` (`:666`), `em` (`:667`), `a` (`:668`), `ul, ol` (`:673`), `li` (`:674`)
and the whole `table.data` system (`:239-344`). It styles **nothing** for `h5`,
`h6`, `blockquote` as an element, `code`, `pre`, `hr` or `img`.

Two consequences, both of which changed the obvious design:

1. **`h4` is not a smaller heading.** It is IBM Plex Mono, uppercase, tracked, at
   caption size — the comment at `css.pure.ts:647` says it is the same object as
   `.eyebrow`. A real level to demote onto, but a *labelled sub-section*.
2. **`<pre>` is disqualified.** WeasyPrint's UA sheet gives it
   `white-space: pre`, and there is no `overflow-wrap` or `word-break` rule
   anywhere in the sheet, so a 120-character line of JSON would run off the trim
   edge of a client's document. A fenced block becomes a callout of `<code>`
   separated by `<br>`, which wraps.

`reportQaStylesheet.spec.ts` reads `css.pure.ts` and fails if the module can emit
an element it does not dress.

### The grammar

| markdown | becomes |
| --- | --- |
| paragraph | `<p>` |
| ATX / setext heading | `<h2>`/`<h3>`/`<h4 id>`, demoted relative to the answer's own shallowest heading, clamped at 4 |
| bullet / ordered list | `<ul>`/`<ol>` + `<li>`, depth ≤ 3, deeper items flattened not dropped |
| GFM pipe table | `renderDataTable` — ≤ 6 columns portrait, 7–12 landscape, > 12 keeps twelve and names the rest in a sidenote |
| blockquote | `renderCallout('neutral', 'Note', …)` |
| fenced code | `renderCallout(informative, lang, '<p><code>…<br>…</code></p>')` |
| thematic break | dropped, counted |
| image | alt text only |
| `[a](b)` | the text plus the neutralised host, **never an anchor** |

**Heading demotion is relative, not absolute.** Models are inconsistent about
whether they open at `#` or `##`, and an answer written entirely in `##`/`###`
must render with the same hierarchy as one written in `#`/`##`. And a single
top-level heading over deeper ones is a *title*, not a section — the shape
`summarize-conversation`'s own brief asks for (`report-qa/index.ts:3060`: one `#`
over eight `##`). Taking it as the only chapter gave an eleven-page document a
one-entry contents page, which is how that rule was found.

### Escape first, then emphasis

Both orderings can be made correct; this one is chosen for its **failure mode**.
Escape-first puts `escapeHtml` at one auditable call; get it wrong and the page
prints `&lt;strong&gt;`, which the first test catches. Escape-last is correct only
if every serialiser branch remembers, and the branch that forgets is an
XSS-shaped hole that renders identically to correct output in every test that
does not specifically probe it.

It rests on one property, which is itself a test: `escapeHtml` produces only
`&amp; &lt; &gt; &quot; &#39;`, and **none of `*`, `_`, backtick, `[`, `]`, `(`,
`)` appears in any of those five entities**. Add a sixth entity and the spec
fails rather than a client's document.

### Two ordering rules that are bugs if reversed

- **`sanitiseGlyphs` runs before `neutraliseUrls`.** Stripping a zero-width
  character is what *creates* a scheme-relative URL: `/​/` is inert until
  the zero-width space goes. Reversed, the render throws.
- **`markdownToPlainText` neutralises URLs too.** Questions, contents entries and
  running heads reach the page without passing through the block scanner. Eight
  user messages in the record carry a URL, and without this every one of them
  fails the render with an error naming no field and no line. Found by a test
  that put the URL in a question rather than in an answer.

### Glyphs — scripts are kept, symbol blocks are enumerated

The container installs DejaVu, Liberation, Noto, Noto CJK, Inter, Roboto and Lato
plus the COPY'd Cinzel / Playfair / IBM Plex Mono. **No colour-emoji font.**

The rule: a codepoint is emitted unless it is a control or format character, or
it falls in one of five enumerated symbol ranges and is neither in the keep-list
nor transliterated. Scripts are never touched.

**The first version got this wrong and shipped a copy of D4.** It dropped
everything at or above U+2600 unless explicitly kept — which reads as a safe
allow-list and is not one, because Han starts at U+4E00. A rendered proof
carrying `A non-Latin name: 李小龍 and Ελληνικά` came back reading `A non-Latin
name: and Ελληνικά`. The name was gone. Found by looking at the page, which is
the only way that class of defect is ever found, and now pinned by
`markdown.spec.ts`.

Stripping **VS16** is the highest-value single line — 93 answers. It asks for the
emoji presentation of a character with a good text form; with no colour-emoji
font the engine either ignores it or draws `.notdef`. Removing it turns `⚠️` into
`⚠` and `1️⃣` into `1`, at the cost of nothing.

### Bounds

| cap | value | why |
| --- | --- | --- |
| `MAX_MARKDOWN_CHARS` | 65,536 | Twice the largest answer; the same figure as `MAX_SALVAGE_CHARS` |
| `MAX_TABLE_COLS` | 12 | `renderBandedMatrix`'s own landscape budget |
| `MAX_PORTRAIT_TABLE_COLS` | 6 | At seven, a prose cell gets 24.9mm ≈ 70pt in the 174mm measure |
| `MAX_LIST_DEPTH` | 3 | `padding-left: 14pt` per level; depth 4 has eaten 20mm |
| `MAX_TRANSCRIPT_LINES` | 950 | 25 pages of body, keeping 96% of conversations whole |

**The module never throws.** A caller passing 350 KB gets a truncated document
and a `renderCallout('caution', …)` naming the residue exactly — the same choice
`measure.pure.ts:249` makes returning `null`, and for the same reason: a pure
formatter that throws takes the whole render down and the caller has no better
recovery.

---

## 6 · The page budget is fitted, not summed

Every other format sums its declared section budgets and checks the total against
the archetype band. This one cannot: the sections come from the content, and a
transcript's pages come as much from per-exchange furniture as from prose.

Both facts were learned the hard way.

1. The first budget was in **characters**. A 42,000-character conversation of 70
   short exchanges runs to about 45 pages; the same 42,000 characters in five
   long exchanges runs to about 15. A character cap admits the first and a turn
   cap refuses the second, so neither alone is a budget.
2. The second was in **estimated lines**, and the estimate was ~40% low against
   structured answers, because a four-row table is seven printed lines for a
   hundred characters. A 70-exchange transcript claimed 30 pages and would have
   printed 41.

So `fitTranscript` drops one exchange at a time and re-prices the spine it would
build, until `spinePageBudget` is inside the band. Exact — no estimate stands
between the rule and the thing it is a rule about — and a handful of iterations
on the four conversations in the record that reach it. The coarse character
budget stays in the normaliser, doing the one job it is good at: refusing 350 KB
before a scanner ever sees it.

### Measured against real renders

Ten fixtures through local WeasyPrint. Claimed is what the spine says; actual is
what `pdfinfo` reports.

| shape | claimed | actual |
| --- | --- | --- |
| one short answer | 5 | 5 |
| a typical answer (table, lists, quote) | 7 | 7 |
| an answer with an 11-column table | 7 | 7 |
| an answer full of symbols and non-Latin names | 5 | 5 |
| the largest single answer | 17 | 17 |
| a structured report | 17 | 17 |
| a p50 transcript | 5 | 5 |
| a p90 transcript (5 exchanges) | 14 | 14 |
| a 20-exchange transcript | 30 | 29 |
| a 35-exchange transcript | 30 | 29 |

Band `[4, 30]`. The floor is the arithmetic minimum — cover, contents, one
chapter, closing — and exists to catch a spine that collapsed rather than to
predict a page count; the Client Details band was estimated and refused a
legitimate document on its first render.

### What the renders found

- **The lede and the truncation callout disagreed by six exchanges.** The
  narrative was built in the normaliser from its own estimate; the exact fit cut
  further. The page read "19 of 20 exchanges" three lines above "This document
  carries 13 of 20 exchanges". The narrative is now rebuilt from the fitted
  count, and `render.spec.ts` asserts the document gives one number.
- **A landscape table cost two pages the row count knew nothing about.**
  `renderPage('landscape-table', …)` breaks the portrait flow before and after
  it. `LANDSCAPE_BREAK_LINES` closes it.
- **Nested lists were invalid HTML.** The obvious loop puts the sublist beside
  its parent `<li>` rather than inside it, and WeasyPrint renders it at the
  parent's own indent — so the nesting the author wrote is simply not on the
  page. Invisible to the type checker, visible on the page.

---

## 7 · The render path

`supabase/functions/render-report-qa-pdf/index.ts`.

1. `verifyAuthOrNativeUser`; the service-role identity is refused because it is
   not a person.
2. `requireModulePermission(actor, 'report_qa', 'can_view')` — **not `reports`**.
   `permissions.ts:37-38` maps both Q&A tables to `report_qa`; gating on
   `reports` would let someone read a conversation through a report route they
   could not read directly.
3. **`resolveReportQaAccess`** for the conversation itself, with `isSuperadmin`
   supplied — the resolver takes it as a flag rather than looking it up, and
   without it a superadmin passes the module gate and is refused by the
   conversation gate. This route does not invent a second ownership rule.
4. Two reads, with **`error` checked before `data`** on both. A failed query that
   returns nothing is not an empty conversation, and printing it as one is a
   transcript with exchanges silently missing.
5. `structured` with nothing stored and `generateIfMissing` set → the same call
   `summarize-conversation` makes, **metered** through `logApiUsage`, and
   persisted so the second render is free.
6. Brand snapshotted then referenced; the cover from the tenant's own asset;
   `assertSafeRenderResources` before the POST.
7. `validateSpine` problems are fatal. This is the only format whose sections
   come from model output, so it is the only one where an illegal spine can
   happen at runtime.
8. No fallback. Every attempt leaves a row in `report_qa_renders`.
9. Optionally writes the attachment shape `PDFAttachmentMessage.tsx:39` already
   reads, so the in-place email composer reaches the new document unchanged.

**Filename:** `Q_and_A_<Report|Answer|Transcript>_<Title>_<YYYY-MM-DD>.pdf`,
replacing all three conventions in D2. The `[^a-zA-Z0-9] → _` rule the legacy
uses is kept exactly, so old and new files sort together.

**Storage:** `qa_exports` — the private bucket the legacy server path already
writes to — at `report-qa/<conversationId>/<date>/<uuid>-<name>`.

**Metering.** This is the first route in the programme that can spend tokens.
`summarize-conversation` makes the same gpt-5.2 call today and logs nothing; a
new route is not the place to inherit that. `report_qa_renders.generated_summary`
is how a spend in `api_usage_log` traces back to the document that caused it.

---

## 8 · The front end — additive

| Surface | Before | Added |
| --- | --- | --- |
| `ReportQA.tsx:2251` "Export PDF" | pdf-lib transcript → chat attachment | the typeset document beside it, same attachment shape |
| `ConversationExport.tsx:150` dropdown | "Export as Structured Report (AI)" → jsPDF | a typeset entry above it |
| `MessageReportEditor.tsx` footer | jsPDF single answer | the typeset answer beside it |

Nothing was removed. The four raw exports (`.txt` / `.csv` / `.md` / `.json`) are
untouched and are the uncapped escape hatch the truncation callout points at —
`legacyPathStays.spec.ts` asserts they still exist for exactly that reason.

`requestReportQaPdf` takes **no legacy fallback**. Substituting a jsPDF export
whose tables overlap, whose punctuation has been transliterated to ASCII and
whose cover is our letterhead rather than the tenant's would send somebody a
different document from the one they chose. On an undeployed route it fails,
naming the exports that work.

### Names that must stay

`QAPDFGenerator.tsx` is dead code and **stays** — removing it was outside this
migration's scope. `legacyPathStays.spec.ts` records that it is unreachable, so
nobody ports a fix into a file no one can reach. So do
`ConversationReportEditor`, `MessageReportEditor`, `generate-qa-pdf` and the four
raw exports.

---

## 9 · Deliberate losses

Recorded here because each is a decision, not an oversight.

- **Emphasis inside a table cell.** `renderDataTable` calls `escapeHtml` on every
  cell, so `**Yes**` would print its asterisks. Markers are stripped instead: a
  cell loses weight, not words, and the table is already differentiated by mono
  uppercase heads, banding and tabular figures. The alternative — a forked table
  emitter — would cost alignment, `tabular-nums` and the `<th scope="row">` that
  makes the table navigable, which is the point of the migration.
- **The thematic break.** It carries no content and the design system's own block
  rhythm already separates. 3 answers.
- **Columns past twelve.** Kept twelve, named the rest in a sidenote. The corpus
  max is 14, so this case is real.
- **Code in a callout rather than `<pre>`.** See §5.
- **Pictographs.** Dropped, leaving the words — the house vocabulary is
  decorative-prefix-plus-word, so `🏠 Owner Occupied` becomes `Owner Occupied`
  and reads perfectly. `🔴 🟠 🟢` are dropped rather than mapped to `●`, because
  three identical discs destroy the distinction they were carrying.
- **The transcript's tail past the page band.** Said on the page, counted in the
  ledger, and the uncapped `.md` export is named as where to get the rest.

---

## 10 · Tests

| File | Guards |
| --- | --- |
| `reportQaSourceOfTruth.spec.ts` | one bridge per canonical module; import discipline; purity; no PDF library |
| `markdown.spec.ts` | the grammar, the escape invariant, the resource policy, the glyph policy, the bounds, determinism |
| `normalise.spec.ts` | turn pairing, citations, refusals, the transcript budget, the framing sentence |
| `render.spec.ts` | the contents page matches what was printed; the spine is legal and in band; one exchange count; the tenant's brand; escaping |
| `stylesheet.spec.ts` | every element the module writes has a rule in `css.pure.ts` or an exemption with a reason |
| `legacyPathStays.spec.ts` | all five legacy paths still exist and are still wired; the new control returns a Blob; the route's two gates |

230 assertions. Five were verified by **deliberately breaking the thing they
guard** — the glyph/URL ordering, the CJK keep, positional table keys, the escape
order and list nesting — and each failed exactly one test.

Three of the assertions were themselves wrong on first writing, all in the same
way: they read a module's **prose** rather than its code, because these files'
doc comments name the legacy libraries they replace. Comments are stripped first
now. It is the same mistake the copied import check makes when a doc comment ends
in `from '`.

---

## 11 · Deployment

1. ~~Apply `supabase/migrations/20260820000000_report_qa_render_path.sql`.~~
   **Applied to production** — `report_qa_renders`, its six indexes and the
   superadmin-only SELECT policy exist, and the migration is recorded under its
   own version so `supabase db push` does not attempt it a second time (it
   would fail: `CREATE POLICY` has no `IF NOT EXISTS`).
2. Deploy `render-report-qa-pdf` — **still pending**. `npm run deploy:report-qa-render`.

The DDL was executed against production inside a transaction — including an
insert against real conversation and message rows, to prove the shape is usable
and not merely creatable — and rolled back, with `to_regclass` confirmed null
afterwards. It has since been applied for real.

### What an undeployed route looks like from the app

Worth recording, because it cost a support round-trip and the message was
actively misleading.

An absent function is a 404 from the **Supabase gateway**, not from the
function, and a gateway 404 carries no `Access-Control-Allow-Origin`. So the
browser refuses the response, `fetch` rejects with `TypeError: Failed to fetch`,
and `invokeSecureFunction` rewrites that into *"Network/CORS error calling
render-report-qa-pdf. Please check the function deployment and auth/CORS
configuration."* — which is what a person pressing **Typeset PDF (WeasyPrint)**
saw. Nothing about this route's CORS is wrong; it never ran.

`requestReportQaPdf` was written to catch exactly this and say so, but its
`looksUndeployed` matched on `failed to fetch` — a string that no longer
survives the transport. It matches the transport's `network` flag now (minus
`provider_timeout`, which is the opposite failure: the route answered, slowly),
so the undeployed case reads as *"render-report-qa-pdf has not been deployed to
this project"* and names the exports that do work.

The deploy is a CLI job rather than an MCP one: the route pulls in 32 shared
modules through `../_shared/**`, and the CLI is what resolves them.

---

## 12 · How this format got onto the Investment Compass families

This section used to explain why it could not be. The argument was sound about
the vocabulary it was written against, and it named the two things that would
have to change. Both changed, so the section now records what they were and what
holds the result in place.

### What blocked it

The Template Builder's blocks had **no Markdown renderer and no block that
accepted HTML**. `text-block` escapes its body, which is correct — it is the
reason a model-authored string cannot inject markup into a client's document —
and the consequence was that an answer bound to one printed its own source:
`## Yield analysis`, `**gross yield**` and `| Gross yield | 3.71% |` all set as
body copy. Against the corpus that was not an edge case: **394 of the 565
answers (70%) carry inline bold**, 271 (48%) an ATX heading, 315 (56%) a bullet
list and 106 (19%) a pipe table.

And the structure is discovered at render time against heights a master declares
at build time:

| | p50 | p90 | max |
| --- | --- | --- | --- |
| answer, characters | 2,193 | 10,591 | **33,377** |
| sections discovered in an answer | 1 | 16 | **63** |

### 1 · `markdown-block` takes source, not HTML

The half of the argument that had to stay true is the escaping. A block that
accepted rendered HTML would be a hole in `PRODUCTION_SAFE_BLOCK_TYPES` — a
security allow-list — for exactly the content least able to be trusted.

So the block takes Markdown **source** and renders it itself, through
`_shared/reports/markdown.pure.ts`: the programme's only Markdown
implementation, already shared with this route, and **escape-first** —
`escapeHtml` runs at one auditable call before any parsing. That makes safety a
property of the renderer rather than of the caller: there is no input to the
block that produces markup the model chose, whatever is bound to it. A second
implementation would have been a second set of escaping decisions.

`markdownBlock.spec.ts` asserts it on the **tag set** the output contains rather
than on substrings — a fully-escaped `href=&quot;javascript:…&quot;` still
contains the text `javascript:` and is inert, and a substring assertion there
fails for the wrong reason and teaches you to loosen it.

### 2 · Conditional pages, sized by the same function the block uses

The block renders the whole source, packs the resulting blocks into buckets of
`linesPerPage` and emits bucket `pageIndex`. A master declares one answer page
plus seven continuations, each conditional on `qa.answerPages > N`, and a
conditional page that does not render costs nothing because `visiblePages`
filters before layout. A median answer therefore produces a five-page document
and the longest produces twelve, from one set of masters — the Client Details
Form pattern.

`packMarkdownPages` lives in `reports/markdownPaging.pure.ts` because the
projection and the block both need it and **must not disagree**: the master makes
page N conditional while the block decides what page N holds, and a drift of one
line prints a blank page or loses the end of an answer. `reportQaOnTheFamilies.spec.ts`
asserts the composer's lines-per-page equals the module's.

Packing never splits a Markdown block, so a table taller than a page keeps its
header instead of reading as two unlabelled tables.

### What the masters draw, and what stays here

**One exchange in depth** — the question, its answer, the sources it was grounded
in, and a list of what else was asked. That is the document a fixed page sequence
suits.

A whole transcript is not: conversations reach 70 turns, and
`render-report-qa-pdf` paginates one properly. It remains the default, and the
adapter's `legacyFallback` says so rather than implying the template replaces it.

`reportQaOnTheFamilies.spec.ts` replaces `reportQaNotOnTheFamilies.spec.ts` and
keeps its central assertion — that **`text-block` still escapes**. The fix was to
add a block that renders safely, not to relax the one that escapes.

---

## Addendum (RS-5c.5b, 14 Sep 2026) — the structured write-up stays on the flowing route

The templated path (`tryTemplateDocument('qa', …, { variant: 'structured' })`)
used to route the structured subject whenever a write-up was stored, and the
document it produced was a shell: the projection never publishes
`structured_report` (see "What it deliberately does not publish" in
`reportQaProjection.pure.ts`) and every content page of the Q&A masters binds
`qa.answer`, so a conversation holding a 5,460-character write-up came out as a
cover, "The question" with *"This document carries 0 of 4 exchanges; 4 are not
shown"*, the sources page and the back cover. `qaAdapter.resolveRoutingContext`
now declines the structured subject; `deliverReportQaPdf` falls through to
`render-report-qa-pdf`, which draws the write-up; and
`qaStructuredNotTemplated.spec.ts` holds the refusal exactly while no master
binds the write-up. `docs/reports/RUNTIME_CONSOLIDATION.md` §9 RS-5c.5b carries
the measurement.

## 13 · The Intelligence Hub Summary (28 Sep 2026)

The owner exported a suburb shortlist from the Intelligence Hub's "Export as
PDF" dialog. It came out in the legacy in-browser layout, with three faults:

- the file was named `QA_Summary_-_28_09_2026_1.pdf`;
- it printed "Investment Property Analysis" as the document's heading;
- the blockquotes printed as a raw `>`.

The template they had chosen was ignored because the dialog had two PDF
buttons. "Typeset PDF" honoured the chosen template. "Export PDF" was the
jsPDF generator, which never read it.

**The choice and the act are separate controls now.**

- "Choose template" (`ChooseTemplateButton.tsx`) only chooses. It opens the
  Template Library's own picker and names the current choice in the footer.
- Export PDF is the one thing that makes a file. It goes through
  `render-report-qa-pdf` in that choice. A single answer uses the `answer`
  subject; the conversation write-up uses `structured`.

As for every report type but Investment, a template dresses the standard pages
rather than re-paging them (`TEMPLATE_PARITY.md`). The route reads the stored
answer, with `edited_content` winning, so the editor's text is written first.
A write that fails stops the export. The call answers a refusal in its value,
and the old save reported "Saved" either way. The jsPDF layout remains only for
an editor with no conversation behind it, which the route cannot read.

**One name, and the topic.** `documentIdentity.pure.ts` holds three things:

- `HUB_DOCUMENT_NAME` ("Intelligence Hub Summary"), which is also the
  archetype's `documentName`, asserted equal;
- the topic, which is the answer's own first heading, else a conversation title
  somebody gave, else the question;
- the filename, `Intelligence Hub Summary - <topic> - 28 Sep 2026.pdf`.

Every Hub download uses them: the typeset route, both editors' fallback
layouts, the chat toolbar's pdf-lib transcript and the raw `.txt`/`.md`/
`.csv`/`.json` exports. Email subjects use `hubEmailSubject`. The storage key
stays URL-safe (`storageSafeFileName`), because the readable name is what a
person is handed and the key is where the bytes live.

**The memo runs on.** Measured on the owner's answer across all 50 designs and
the standard layout, the document went from 11 sheets to 7–8. Three fixes:

- The answer's own `#` title was also its first section, holding only the
  "Asked" callout. It is now on the cover alone (`withoutLeadingTitle`).
- Every `##` opened a page. For `answer` and `structured` the sections now run
  on (`qa-run-on`), each keeping its numbered header, contents entry and running
  head. A transcript keeps a page per exchange.
- The closing disclaimer stood alone on the last content page in 29 of 50
  designs. It is now bound to the block before it (`qa-keep-tail`), and only
  when it is short. `break-before: avoid` changed nothing in WeasyPrint 69.0; a
  wrapper that may not break inside is honoured.

## 14 · The adviser's report, not an export of a chat (30 Sep 2026)

The owner exported one Hub answer in two designs — Institutional Research ·
Exhibit (`ir-01`) and Dark Executive · Obsidian (`de-01`) — and asked for the
layout to be finished: smaller subheadings, a flow that reads as one document,
and whatever else a careful reader would find. Everything the answer said had
reached the page. How it was set had not been designed for a report the adviser
hands over.

Both files were reproduced exactly before anything changed: the same composer
and the pinned engine (WeasyPrint 69.0, the service's own render options) set
every heading at the position the delivered PDFs carry. The answer's Markdown
was reconstructed from the delivered PDF — heading levels from the sizes the
renderer set for each level — which makes it a measuring fixture, not the
stored row.

### What the export showed

1. **The firm's name was the title.** The answer opened on
   `# NAIDU PROPERTY CONSULTING SERVICES`, then
   `## Strategic Investment Acquisition Report`. The first heading won, so the
   cover, the running foot and the file were all named after the issuer.
2. **The first facts were about the chat.** "Document: Single answer" and
   "Exchanges: 3" led the cover; the answer's own "Investment Budget" and
   "Purpose" were printed inside the body, beside "Prepared for: [Client Name]"
   and "Date: [Insert Date]".
3. **The first sentence was the machine room's.** "One answer from an
   Intelligence Hub conversation grounded in no attached reports. Answers came
   from report_qa." — `report_qa` is the Hub's own agent key, which is what
   `model_provider` records.
4. **The instructions were printed.** An "Asked" callout carried three sentences
   typed to the Hub — "make it into a very forefronting property consulting
   reporting manner" — above the report they produced.
5. **Two numberings.** The contents read `01  1. EXECUTIVE SUMMARY`, and the
   answer wrote `## 1.` a level deeper than `# 2.` to `# 10.`.
6. **Chapter-sized section titles.** 31pt titles, each under a 13pt
   "SECTION 02", stood over 12.8pt subheads — a 2.4× step with nothing
   between, and a heading block a third of a page tall between sections.
7. **Labels shouting.** "STRATEGIC RATIONALE: BALANCED GROWTH, RENTAL DEMAND AND
   HOUSE ACCESSIBILITY" set in two lines of tracked capitals.
8. **A step's label ran into its sentence.** `3. **Select two priority
   markets**` and the line under it printed as one line.
9. **Tables split to a row.** A five-row table broke three and two; one row of
   an eight-row table sat alone under its head at the foot of a page.
10. **The answer's own disclaimer at body size**, as though it were analysis.
11. **The masthead wrapped at the foot of every page** — "NAIDU PROPERTY
    CONSULTING / SERVICES".

### What the page does now

**The title block is read, and every part of it placed**
(`readTitleBlock`, `documentIdentity.pure.ts`).

- A first heading that names the issuer is the **letterhead**. The masthead
  already carries it, so it is not printed again. The route passes the firm's
  names from the brand snapshot (`issuerNames`); nothing guesses a letterhead
  from the page.
- The heading under it is the **title**, and a deeper one the **subtitle** —
  but only where front matter or a rule closes the block. A heading with prose
  straight under it heads that prose.
- The **front matter** is placed. "Prepared for" and "Prepared by" go on the
  cover, and the firm's own name as the preparer is dropped. A date is dropped,
  because the cover carries "Prepared on". A slot (`[Client Name]`, `TBC`, a
  dash) is omitted rather than printed. Every other fact becomes the brief at
  the head of section 01 (`BRIEF_CLASS`), labels on one line.
- A **section's name is not a document's title** (`isGenericSectionHeading`).
  An answer that opens on "## Executive summary" keeps it as its first section.
  The cover takes the conversation's title, which the Hub writes after the
  first exchange. The section's name stands only where nothing better exists,
  and ahead of the question.

**Nothing about the chat reaches a finished answer.**

- An `answer` or `structured` document has no framing sentence (`narrativeFor`).
- It has no question above it.
- Its cover facts are the report's: Prepared on, for, by, and the reports it
  draws on.
- A transcript keeps one sentence ("… as it happened — its one exchange").
- No document prints which system answered. The provenance line keeps
  "edited before export", the source count and the date, and so does the
  master's projection, which restates it.

**One numbering, one level** (`planFromMarkdown(…, { continuous: true })`).

- A numbered heading written one level deeper, beside a consecutive sequence at
  the chapter level, is promoted into it.
- The number is taken off the title only where the numbers run consecutively
  from 1 in step with the sections themselves. The design system numbers them.

**A memo section, not a chapter** (`MEMO_CHAPTER_CLASS`, all three subjects).

- The title is one modular step above the section's subheads
  (`MEMO_TITLE_RATIO` = 0.62 of a chapter title): 19.3pt over 12.8pt in
  Institutional Research, 15.7pt over 10.4pt in Dark Executive.
- The drop that seats a chapter title low on its page is a small lead instead.

**Labels, steps and caveats.**

- An `h4` longer than `LONG_LABEL_CHARS` (48) is set as a sentence
  (`SUBHEAD_CLASS`): same element, same outline level.
- A line that is only a bold label keeps its line break (`labelLineBreaks`).
  That is a Markdown option, off by default, so every other format is
  byte-identical.
- The answer's closing caveat is set as fine print under a hairline
  (`finePrintStart`). It is read from the heading alone — the last heading, and
  only when it names a disclaimer or warning — and its words are never touched.

**A table moves whole only when it is short in HEIGHT** (`presentedBlock`).

- Row-level keeps do nothing once rows are unbreakable in WeasyPrint 69.0. So a
  table of three rows or fewer, or one estimated at `KEEP_WHOLE_TABLE_LINES`
  (7) lines or fewer, is kept whole.
- Anything longer is three row groups (`groupTableRows`). The first row may not
  be followed by a break, and the last two may not break inside. Undisplayed
  parity rows keep the striping, and `LAST_ROW_CELL` reads the table's own last
  group, so the ledger style's rules stay between groups.
- The first cut asked for six rows and 1,200 characters. Measured across the
  fifty designs, that admitted a five-row, four-column table standing 35–47% of
  a page tall, so a third of a page stood empty in front of it on ten designs.
- `estimatedTableLines` wraps each cell at its share of `TABLE_MEASURE_CHARS`
  (100), which was calibrated at ~20px per estimated line against every table
  of the owner's answer. That bounds the gap a whole table can leave to about a
  quarter of a page.

**The page furniture.**

- The masthead's tracking steps down until it fits its half of the foot
  (`footerMastheadTracking`). A masthead that fits at the widest is
  byte-identical.
- The running head is one line (`runningHeadFor`, 72 characters, cut at a word).
  A transcript's section title is its question clipped at a word to 90
  characters (`turnTitle`). The full question is printed under it only where
  it was clipped, so a question is printed once.

**Before export.** Both editors name the slots still in the text
(`PlaceholderNotice`, from `findPlaceholders`). A slot in a sentence cannot be
taken out without rewording it. The editors' own filenames (Markdown and the
no-conversation layout) are read with the issuer's name too.

### Measured

The owner's answer was drawn in all fifty catalogue designs and the standard
layout, before and after, and measured from WeasyPrint's own box tree (CSS px;
content height 956px):

| | before | after |
| --- | ---: | ---: |
| Pages across the 51 documents | 866 | 812 |
| Table split leaving one row alone at a page foot | 61 | 0 |
| Table split carrying one row alone onto a page | 10 | 0 |
| Tables split at all | 279 | 27 (each with ≥ 2 rows on both sides, head repeated) |
| Running-foot boxes set on two lines | 614 | 0 |
| Body pages ending more than 25% short | 13 | 0 |
| Worst body-page gap | 28.5% | 24.4% |
| Lines past the measure | 0 | 0 |

A kept-whole table still moves to the next page when it does not fit, and the
body pages ending 15–25% short rose from 29 to 74. That is the price of never
stranding a row, and it is bounded: the worst is the acquisition-structure
table moving whole, and nothing leaves a quarter page.

The transcript, in all 51 designs, sets no running head or foot on two lines.
Four designs were sampled before the change, and between them they carried 152
wrapped boxes. The structured write-up carries no stranded row, and its foot
wraps went from 45 to 0 across the four designs sampled.

### Not verified here

- **PDF/UA-1 validation.** veraPDF is not installed in the environment this was
  built in. The structure is unchanged in kind: `h4.subhead` is still an `h4`,
  and a parity row has no box, no tag and no text. The claim still rests on CI.
- **The deployed route.** `render-report-qa-pdf` changes with the edge deploy
  and the editors with the frontend publish. The proof is the owner re-exporting
  the same answer in both designs.
- **`deno check` of the function itself.** The environment cannot reach
  `deno.land`. The ten shared modules it imports were checked, and the function
  is checked by CI's edge gate.

## 15 · The Preview is the document (30 Sep 2026)

The owner sent a screenshot of the export dialog, open on the Dark Executive ·
Obsidian design, and asked to see "the entirety of how the document's layout
will be" in the chosen template, and to edit it there before downloading. The
Preview tab used to render the editor's Markdown as a web page: the app's
typeface, no cover, no contents page, no running head, none of the template.
Whichever design was chosen, what was previewed was never what was exported.

### What it is now

- **The Preview draws every page of the export**: cover, contents, each
  section and the closing page. It uses the same route
  (`render-report-qa-pdf`), the same record, the same brand snapshot and the
  same design resolution (`standardDesignFor('qa')`) as Export PDF. Nothing on
  the Preview's side knows about templates, so it is right for all fifty
  catalogue designs and the standard layout by construction.
- **A preview keeps nothing** (`preview: true`).
  - It writes no `report_qa_renders` row, stores no file, signs no link and
    attaches nothing. `generateIfMissing` and `attachToConversation` are
    forced off, so it spends no tokens either.
  - It skips the frozen brand snapshot, because a snapshot records a document
    that was kept.
  - The PDF comes back in the answer as base64: 103–151 KB across the 54
    renders measured in §14.
  - The browser draws it with the build-pinned PDF.js, one page at a time,
    as images (`PdfPageStack`).
- **An unsaved edit is previewed as it would print** (`draft`). The route puts
  the draft where Save would write it — the answer's `edited_content`, or the
  conversation's `structured_report` — on its own copy of what it read, and
  draws that (`applyPreviewDraft`). Nothing read is changed.
- **A draft needs the same rights as the edit it shows.**
  - Only a writer with `report_qa` `can_edit` may send one; anyone else gets
    403.
  - A stored record can be previewed by anyone who can read it, so the editors
    send their text only when it differs from what is stored.
  - The write-up editor counts text as stored only once a write has answered,
    not when it is generated. The generated text is cached in the background,
    and until that write returns, the text is sent as a draft.
- **Bounds** (`parseRenderRequest`): a draft is accepted only in a preview,
  never for a transcript, never empty, and at most
  `MAX_PREVIEW_DRAFT_CHARS` (150,000) characters.

### How it behaves

- **It is drawn when useful, never on a keystroke** (`useHubDocumentPreview`):
  - the first time the Preview is shown;
  - when the chosen template changes while it is shown;
  - when it comes back into view after an edit.
- An edit made with the pages on screen (Side by side) marks them "Edited
  since this preview". The person redraws with the button, or with Ctrl/⌘ +
  Enter in the editor.
- A failure is shown with Try again and is never retried in a loop.
- Updating keeps the old pages on screen until the new document's first page
  is drawn.
- **Page by page, or every page at a glance.** The overview sets the whole
  document side by side (`PdfPageStack` `layout: 'grid'`), which is where a
  section's start, a page left short and the flow of the design are seen at
  once. A thumbnail opens its page in place.
- **A page names every section it carries** (`previewSections.ts`).
  - The document's own bookmarks say where each section starts: the page,
    and how far down it (`/XYZ`).
  - A page whose top ends one section and whose middle opens the next names
    both.
  - Every bookmark ends what came before it, so the closing page is nobody's
    section.
  - Choosing a section lands on its heading, not the top of its page.
- **Each section leads back to its words.**
  - "Edit this section" selects the section's heading in the editor
    (`findSectionHeading`). It reads a heading by the parser's rules: `#` and
    underlined headings, emphasis, links and closing hashes, with the
    section's own number optional and a clipped title matched by how it
    begins.
  - The first section, when it is the opening before any heading, opens the
    text at its start.
- **Side by side is a desktop's view.** Below 1024px the tab is not drawn at
  all (`useBreakpoint`), because the app's phone rule sets every
  `[role="tab"]` to `display: flex` and so beats a `hidden` class. The zoom
  steps leave the phone toolbar, which pinches instead.
- **A template the route did not use is said on the Preview**, in the words
  the export would use (`DESIGN_NOT_USED_TITLE`).
- **The rendered text is still there**:
  - for an answer with no conversation behind it, which the route cannot
    read;
  - as "Show the text instead" when the service cannot draw, with a way back
    to the pages.

### Two rules

- **A preview is never assembled in the browser.** A second renderer is how
  what you see and what you get come to differ. There is one route and one
  engine.
- **An older route's answer is never shown as a preview.** A route deployed
  before previews ignores `preview` and makes an ordinary export of the
  STORED record. Showing that would present the words the person replaced as
  the words they typed, so the client refuses it and says what is missing
  (`PREVIEW_UNSUPPORTED_MESSAGE`).

### Deploy order

The edge function ships first, then the frontend. Merging deploys the edge
functions, and the frontend is published afterwards, so no preview reaches the
old route. If one did, the old route reads `attachToConversation` and
`generateIfMissing` as false unless sent `true`. It would neither attach nor
spend tokens, but it would store an ordinary export: a ledger row and a file.

### What the tests and the browser found

- **The section jump did nothing.** Radix mounts a tab's content one render
  after the tab changes, so the effect that applied the selection ran while
  the textarea did not exist, and it never ran again. The textareas are now
  held in state rather than refs, so the selection is applied once the
  textarea is really there. `MessageReportEditorPreview.spec.tsx` drives it
  through the real tabs.
- **A page was credited to the wrong section.** The real dialog in Chromium
  showed it, drawing the owner's answer through the production composer and
  WeasyPrint 69.0. Page 9 opens on the end of the suburb shortlist, and the
  financial framework starts halfway down it. The caption and the list named
  only the framework, so "Edit this section" beside the shortlist's own table
  led to the wrong words. `previewSections.spec.ts` pins the rule on that
  document's bookmarks.
- **A phone showed a clipped "Side by side" tab**, and the preview toolbar ran
  off the sheet.
- **The phone sheet sat 32px left of centre.** That was this dialog's own
  width classes on the shared bottom sheet, and it predates the preview;
  `mx-auto` centres it at every width.

Measured in that browser, against a local render rather than the service:

- 16 pages were on screen 9–10 seconds after the Preview was opened, the local
  composer and engine run included.
- The design was redrawn by itself on a change of template.
- An edit was marked stale, and Ctrl + Enter redrew it.
- There was no console error.
- No request to Supabase was attempted: the harness blocked them and counted
  none.

Tests: `preview.spec.ts` (the route's rules, and the order of the preview's
return before every write), `requestReportQaPreview.spec.ts`,
`useHubDocumentPreview.spec.tsx`, `MessageReportEditorPreview.spec.tsx`,
`ConversationReportEditorPreview.spec.tsx`, `previewSections.spec.ts` and
`sectionHeading.spec.ts`.

### Not verified here

- **The deployed route answering a preview.** That needs the edge deploy. The
  proof is effect-based: after the deploy and the publish, the Preview draws in
  the chosen design, and neither Generated Reports nor the conversation gains a
  file.
- **Draw time against the deployed service.** A preview costs one engine
  render, the same as an export.
