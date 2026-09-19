# The template converter

Upload a template somebody has been sending clients for years; get it back set
through the report design system and bound to one of the migrated report
formats.

This is not a ninth format. It is a way *into* the eight that exist — the point
at which an old document stops being a PDF nobody can change and becomes a
structure the programme's renderers can fill.

- **Page**: `/admin/template-builder/converter` (`src/pages/admin/TemplateConverter.tsx`),
  guarded by `<ModuleGuard moduleKey="templates" requireEdit>`.
- **Routes**: `convert-template-document`, `generate-brand-design-system`.
- **Tables**: `template_conversions`, `brand_design_systems`
  (`supabase/migrations/20260823000000_template_converter.sql`).
- **Bucket**: `converted-templates`, private, created by that migration.

---

## What the converter takes, and what it deliberately leaves

Sections, their order, their nesting, and whether they are tabular. Nothing
else.

Not margins, not colours, not where a logo sat. Those are the things the design
system is replacing, and carrying them across would reproduce the document
rather than refurbish it. It is also the only part of a PDF that survives
extraction reliably — positions and fonts do not come back at all from a scanned
source and come back wrong often enough from a native one that a layout-faithful
converter would spend its life in the uncanny valley.

Depth is capped at two (`MAX_BIND_DEPTH`). Nothing in the design system renders a
fourth-level heading as anything but a heading in the body copy, so deeper
headings stay in the prose and simply stop being chapter candidates.

---

## The three steps, and why they are three requests

| Action | What it does | What it writes |
| --- | --- | --- |
| `extract` | Parses the upload, extracts the structure, proposes a binding | A `template_conversions` row at `review` |
| `propose` | Re-scores the **stored** Markdown against a different format | `binding`, `bound_format`, the three counts |
| `render` | Renders the confirmed binding through WeasyPrint | `succeeded`, the file, the counts, the snapshot |
| `list` | Earlier conversions, each with a freshly signed URL | nothing |
| `chapters` | The bound chapters and their prose, for an editable copy | nothing |

Only `render` stamps a failure onto the row. It is the action that moves the row
to `rendering`, so a throw partway through leaves it stuck there unless the catch
corrects it; a failed `propose`, `list` or `chapters` changes no status and reads
a conversion that is perfectly fine, and marking it `failed` would be a lie that
outlives the request.

They are separate because a person sits between them.

`proposeBinding` scores each extracted section against each archetype chapter
and returns its best guess **with the score attached**. Nothing here decides
anything on its own, and that is deliberate: a wrong automatic binding produces
a document where the "Serviceability" chapter is filled with the fee schedule,
which looks entirely correct and is completely wrong. A visible low score is
recoverable; a silent mismatch is not.

`propose` re-reads the stored Markdown rather than the upload, so trying a
second format costs nothing. Parsing a PDF is the slow and expensive half.

### The scorer is intentionally simple

0.7 × token overlap, 0.22 × order proximity, 0.08 × shape, and **zero if no word
is shared**. That last clause is not a tidy-up; it is a defect fix. With seven
chapters and seven sections, order and shape alone created enough score for the
greedy pass to bind every one, so a "Fee Schedule" section landed on "Next
Steps" purely because it sat in a comparable position — and the appendix, which
exists to catch precisely this, was left empty.

The binding is greedy and one-to-one. A section bound twice prints the same
three paragraphs in two places and looks entirely deliberate.

Measured against a realistic seven-section borrowing-capacity template, the
proposal binds five chapters at 87–100 and leaves two unfilled, sending four
sections to the appendix. "Servicing & Buffers" does *not* bind to
"Serviceability" — no shared token — and that is the conservative outcome the
review screen exists to let a person correct by hand.

---

## Three things a chapter can be

- **bound** — a section of the upload plays this chapter. Its prose is set.
- **unfilled** — the format has this chapter and the template offered nothing.
  It is still printed, with a line saying the live report will supply it,
  because dropping it would change the format's own structure.
- **appendix** — a section of the upload no chapter wanted. Printed at the back
  rather than discarded.

That third case is the one worth stating plainly. It is tempting to drop unbound
sections — they are, by definition, the ones the format has no place for. But
somebody chose to put them in their template, and a converter that silently eats
a third of an upload is a converter nobody trusts twice.

---

## Defects found by rendering, and fixed

**C1 — the depth baseline was wrong for the commonest document shape.** One `#`
title over a run of `##` sections made every real section depth 2, so the review
screen reported "0 sections, 8 sub-sections" for a document that plainly has
eight. `extractStructure` now treats a lone shallowest heading as the title and
takes the baseline from the level below it — the same resolution the Report Q&A
migration reached in `chapterLevelOf`.

**C2 — the scorer bound everything.** See above: `if (!shared) return 0;`.

**C3 — the archetype page band was fatal.** A converted draft is not an instance
of the format; it carries appendix chapters the format never has. A seven-chapter
template with four unmatched sections lands at 13 pages against Borrowing
Capacity's `[4, 12]`, which is correct output. The band is now advisory, surfaced
as `bandNote` and shown on the review screen; every other rule `validateSpine`
enforces — illegal slots, duplicate ids, a document with no chapters — is a real
defect here too and stays fatal.

**C4 — the document printed a contents page the format does not have.**
`buildSpine` adds a contents entry only when the archetype declares one, and
Borrowing Capacity declares `contents: false` because a short format does not
carry one. The renderer printed one regardless. Two consequences: the draft
stopped opening *as* the format it claimed to be bound to, and the page budget
under-claimed by exactly one on every render, because the spine costed a page the
document was not printing. Confirmed against WeasyPrint — claimed 13, actual 14 —
and closed by reading the answer back off the spine rather than deciding it
twice. All four fixtures now claim exactly what they render.

**C5 — the chapter list was invented.** The first `FORMAT_CHAPTERS` entry said
*Position Summary, Income, Commitments, Serviceability, Capacity & Scenarios,
Assumptions, Next Steps* — seven noun phrases lifted from the archetype's
*description*. The renderer prints none of them. A comment in the module claimed
the titles were "taken from each format's shipped document rather than
invented"; they were invented. Converting a real Borrowing Capacity Snapshot
bound 3 of 7 chapters and sent 3 sections to the appendix, because the
document's chapters are editorial sentences and the list was functional labels.
`TABULAR_CHAPTERS` keyed off the same invented strings, so the shape signal in
`scoreMatch` had been inert since it was written. Nothing failed loudly — the
review screen showed a plausible binding of the wrong things, which is the
failure mode this whole feature is designed around. Fixed, and locked by
`converterChapters.spec.ts` importing `snapshotSections` — now one row per
declarative format, each against the maximal payload that makes that format
print everything it can. The seven rows were written before the seven lists and
watched to fail; three of them did, on fixtures that were not yet maximal, which
is the only evidence that a guard guards anything.

**C6 — the heading hierarchy arrived inverted.** Our chapters print a small
`SECTION 01` eyebrow above a large title. A model transcribing that page maps
*visual size* to heading level, so the eyebrow returned as `##` and the title it
labels as `#`, for every chapter, and the cover's masthead and client name came
back as `#` headings owning nothing. `extractStructure` now runs four passes:
collect each heading with the body it owns, fold a heading that owns nothing and
reads like a label into the title beneath it, take the baseline from the headings
that actually own content, then emit. The old `titleIsLone` rule is gone rather
than joined — it was a proxy for "does this heading own content?", and the new
rule answers that directly, including two cases the proxy got wrong (a `# Title`
over `## A` / `### A.1`, where it flattened real nesting; and a title carrying a
preamble, which it discarded). `pdfExtractionPrompt` also fixes it at source,
which is worth more than the repair.

**C7 — the document body was flat.** See *The design pass* below. This was the
big one.

**C8 — the format called itself two things on one page.** The cover eyebrow and
the running head printed the archetype's `documentName` ("Borrowing Capacity
Assessment") while the cover's own "Bound to" line printed `formatName()`
("Borrowing Capacity Snapshot"). One name now, taken from the renderer.

**C9 — the first chapter's notice was never costed.** `renderConvertedBody` puts
the lede and the draft notice inside the first chapter's body; `planConvertedChapters`
charged nothing for them. Read off a real fifteen-page render, this was one of
the two pages the budget was missing. `OPENING_NOTICE_LINES` now charges it, and
the remaining gap is a single page from `pagesForLines`' own ±1.

---

## The second round: what the design pass got wrong

The design pass shipped, ran in production, and produced a 27-page draft of a
document that should be about fifteen. It was tempting to read that as WeasyPrint
refusing something, and it was not: the run's ledger row records
`enrichment_model: claude-opus-4-8`, `binding_source: model`, an imported design
system with its own paper and ink, 53 designed blocks
(`{kpi:10, bars:5, table:9, callout:11, sidenote:3, lede:13, prose:4}`), and an
empty `error`. Everything ran. Four things about *what* it ran were wrong, and
all four are recorded here because none of them failed loudly.

**D1 — sub-sections became appendix chapters.** `planConvertedChapters` never
read `depth`. Every section the binding did not want became its own appendix
chapter with an eyebrow, a header and a page break — correct for a top-level
section the format has no place for, wrong for a `###` inside one. The run
transcribed into 20 sections, of which 12 were `depth: 2` sub-headings inside
*How This Was Calculated*: `DTI Ratio` at 61 characters, `Serviceability Band` at
55, `Stress Test` at 78. Each got a page, and the back half of the document read
as a list of stubs.

An unbound sub-section is now folded into the chapter its parent produced —
bound or appendix — with its heading put back at `depth + 1`, since
`ExtractedSection.markdown` has its own heading stripped. A sub-section the
binding *did* want still becomes a chapter, because somebody chose it. Nothing
is dropped either way. One subtlety worth keeping: the appendix counter now
counts *chapters*, not unbound sections. A folded section that consumed an id
would shift every `cv.aN` after it between the planning call that decides what
to ask the model about and the planning call that renders the answers, and every
block would land on the wrong chapter.

Measured on the real source, rendered through WeasyPrint: **26 pages → 16**, with
`DTI Ratio`, `Stress Test` and `Serviceability Band` now sub-headings inside
*How this was calculated* where they belong.

**D2 — the faithfulness guard was deleting the flagship chapter.** The run's
notes carry, twice:

> `Capacity at a glance: rejected: it contains 1 figure the chapter does not: 100`

The chapter says "76% utilisation" and contains no `100`. The model had done
exactly the right thing — a `bullet` with `value: 76, max: 100`, the
*Proposed loan 76%* case the feature was built for — and `enrichedText`
stringified `max` into the prose figure check, where `BARE_INTEGER_FLOOR = 12`
made it read as an invented figure. Rejected, retried, rejected again, fallen
back to flat prose: the most important chapter in the report, destroyed by its
own guard, for the axis of a chart.

`max` is now the one exclusion in `enrichedText`. It is the chart's scale, not a
claim about anybody's finances. `value` and `target` stay checked, because those
are assertions about the client — a wrong `max` mis-scales one bar, a wrong
`value` misstates a figure, and only the second is worth throwing a chapter away
for.

**D3 — callouts were dropped whole for a missing label.** `readBlock` required
both a label and a body; the model routinely returned a body with no label, and
the notes filled with `block 0: a callout missing its label or body`. The label
now defaults from the tone — `caution` → "Caution", `negative` → "Shortfall",
`positive` → "Worth knowing" — and a sidenote defaults to "Note". A callout with
a label and *no body* is still refused, because that renders as an empty box.

**D4 — enrichment ran on 55-character stubs.** All 20 sections went to the model,
so roughly fourteen calls per conversion were spent on fragments with nothing to
design, which is where most of the `the model returned no blocks` notes came
from. `MIN_ENRICH_CHARS = 220` is a floor on whether the question is worth
putting, not a quality bar; it sits just above the longest fragment that run
produced. Fixing D1 removes most of these anyway — this catches the genuinely
tiny top-level section, like a two-line `Warnings`.

The partition lives in `enrich.pure.ts` as `partitionForEnrichment`, not inline
in `enrich.ts`, for one reason: `enrich.ts` reads `Deno.env` at module scope, so
no spec can import it, and a floor that decides how much a conversion costs
should not be a rule nobody can run. Skipped chapters are *reported*
(`tooShortNote`) rather than silently dropped — "4 of 6 designed" with nothing
else said reads as two failures, and they were never asked.

**D5 — the chosen design system's paper and ink never reached the page.** The
render branch selected `id, name, brand_hex, options` and called
`resolveReportPalette({ preset, brandHex })`. `neutrals` was never selected and
never passed, so every conversion resolved to `PRESET_NEUTRALS` — and the four
presets are permutations of the same three constants. A design system imported
from a Claude Design project showed its real ivory, porcelain, obsidian and
hairline in the specimen gallery, which reads the column, and printed on ours.

Nothing failed. The ledger row recorded that a system had been *chosen*, which
is not the same as its grounds having been used, and the two are
indistinguishable from the outside — which is why this survived a round of
diagnosis that had the row open in front of it.

`readDesignSystemRow` in `route.pure.ts` now reads the row and the route passes
all three of `preset`, `brandHex` and `neutrals`. It is a second reader beside
`readBrandDesignSystem` because they take different shapes — Postgres returns
snake_case, a browser or a model sends camelCase — and it is *only* a second
reader: `normalizeReportDesignOptions` and `readReportNeutrals` are shared, so
the two cannot drift on what an option or a ground is. It is in `route.pure.ts`
rather than inline for the same reason as D4's partition: index.ts is an edge
function no spec can import, and this decides what colour a client document
prints in.

The behaviour that was already right stays right. A null row is the house
default with "House design" on the cover, exactly as `designSystemId: null` has
always meant, and an unreadable `neutrals` falls back to the preset whole rather
than half-applying. The six seeded systems are held in
`converterRoutes.spec.ts` with the grounds they actually carry in the database —
copied, not invented, because the defect was that those exact values existed and
went nowhere.

---

## The third round: it worked, and it did not look designed

D1–D5 fixed the pipeline. A render of the same document came back at 17 pages
with the flagship chapter designed, every callout labelled and the sub-sections
folded — and was still reported as "not using Claude Design at all", because the
first page showed the *uploaded filename* running off the edge of the paper.

Worth stating plainly, because it is the lesson rather than the defect: the
programme had been measuring block counts and page counts, and a document is not
either of those. Everything below was visible in any render and needed no ledger
row to find.

**E1 — the cover printed the filename, off the page.** `extractStructure` did
`let title = clean(fallbackTitle)`, seeding the title with the uploaded file's
name, so every `if (!title)` after it — including the rule that reads the
document's own top-level heading — was dead code whenever a filename existed,
which is always. The return already ended `title || clean(fallbackTitle)`, so
the seed was pure damage.

Then the second half: a filename is one unbreakable token, underscores are not a
break opportunity, and `max-width` cannot clip what cannot wrap. At 56pt it blew
`.report-cover` past the trim, and the masthead and footer — both positioned
`right: 22mm` against that stretched box — went off the sheet with it. One
unbreakable word, three broken things: the wrong title, `SERVICESCHANCERY`, and
`PRIVATE AND CONFIDENTIALAE8DDE86`.

The fix is `overflow-wrap: anywhere` plus `table-layout: fixed` on both cover
tables, and `coverTitleFit` — a character count in `typography.pure.ts` that
steps the size down in four stops, because CSS cannot measure a string and a
title is somebody else's. (`word-break: break-word` was tried and WeasyPrint
rejects it as an invalid value; `overflow-wrap` is what does the work.) The
62/38 split on the masthead is not decoration: an even split wrapped a long
company name onto a second line that landed on the cover rule.

**E2 — every chapter took a page, including the two-line ones.**
`.chapter { page-break-before: always }` is global to all nine formats and stays
that way, so a `Warnings` section of one bullet cost a whole sheet. Four of
seventeen pages carried one to three lines. Consecutive appendix sections under
`THIN_CHAPTER_LINES` are now packed into one chapter, each under its own
heading, and the packed chapter names what it holds. A section big enough to
hold a page keeps its own title — the appendix exists so nothing an uploader
wrote disappears, and losing the name of a substantial section is a way of
disappearing it. The decision is taken on the **flat** Markdown cost, never the
enriched one, for the same id-stability reason as D1.

**E3 — the document said things twice.** Three separate repetitions:

- A `lede` restating the chapter title — *How the capacity is built* as a header
  and again immediately beneath it. `dropRedundantLede` drops an opening lede
  that matches the title word for word; one that expands on it stays.
- The disclaimer as a column of ragged half-lines. `disclaimerParagraphs` split
  on `/\n\s*\n|\n/`, so every newline of hard-wrapped text started a paragraph.
  It now breaks on blank lines, and on a lone newline only when the line before
  it ended on sentence punctuation — which reads both the wrapped paragraph and
  the sentence-per-line disclaimer correctly. **This is the closing page of
  every report the repo produces, in nine formats.**
- The template's own `Contact Us` block printed as a chapter, one page before
  the design system printed its own closing page. A *trailing* section whose
  title reads as closing furniture is now dropped and counted in
  `notices.furnitureDropped`. This is the one place the converter deliberately
  loses something, and it is narrow on purpose: a "Contact" in the middle of a
  template is content.

**E4 — it read as a warning about a document rather than as a document.**
`RenderRequest.final` drops the draft callout, the `converted draft` cover
eyebrow and mark, the PDF's own title suffix, and the `From "…"` deks. Absent
means draft, because the safe reading of an unset flag on something that might
reach a client is the loud one. When it *is* a draft the notice is now a
`sidenote` rather than a `caution` callout — the same words at a volume that
does not own the top third of page one.

**E5 — two of the six seeded design systems were the same design system.**
Chancery's `options` were byte-identical to the NPC Services row's: same preset,
density, `bodyScale`, `coverStyle`, `tableStyle`, `chapterStyle`,
`visualIntensity`, every flag. The only thing between them was `neutrals`, and
until D5 that never reached the render. So somebody picking Chancery got the
house design and concluded the design system had no effect — correctly.
`20260826000000_chancery_is_not_the_house_system.sql` gives it the ledger table,
a compact measure and 98% type, matched on the seeded options so an edited row
is left alone. `converterRoutes.spec.ts` now parses the migrations and asserts
no two systems resolve to the same set of decisions.

**E6 — the strict setting was the default, and floats leaked.** The converter
screen opened on `restructure`, under which the model may not write a single new
sentence, so a source line like `Stressed: $787,477` survived verbatim beneath a
sentence that already said it. The screen now opens on `connective`;
`DEFAULT_FIDELITY` stays `restructure` as the *parse* fallback, which is a
different question. And `repairFloatArtefacts` rewrites `9.440000000000001%` —
which a real Snapshot printed in its assumptions table — at **extraction**,
before the faithfulness snapshot, so the guard and the page compare the same
string. Normalising later would make the design pass look as though it had
invented a figure.

### One rule this pass added

**Nothing in `css.pure.ts` may name a company or a client.** Those comments ship
inside every tenant's PDF; `documentBrand.spec.ts` scans the whole document for
our own name and caught a comment of mine, and a second comment named a real
client. Explanatory comments in the stylesheet describe the shape of a failure,
never who it happened to.

---

## The fourth round: reading the pages of eight formats

All eight migrated formats became bindable, and the pages were read as images
rather than as HTML. That found one defect in the new work — the pass-through
binding made a chapter of *every* heading, so eight two-line `###` sub-headings
became eight sheets; fixed above, 19 chapters to 8 and 23 pages to 14 — and four
things that had been there all along and that nobody had looked for.

Three claims made in the first write-up of this round were **wrong**, and are
recorded here because each would otherwise have sent somebody after the wrong
file:

- The `(")` where the source says `(−$19,740 reduction)` is **not** repo code.
  `calculate-borrowing-capacity/index.ts:311,326` writes U+2212 correctly, and
  `neutraliseUrls`, `sanitiseGlyphs`, `normalizeDocumentText` and
  `repairFloatArtefacts` were each executed against the string and left it
  intact. `source_markdown` is produced by asking a model to transcribe the PDF
  (`convert-template-document/index.ts:175-232`) — which is also why the two
  occurrences broke *differently*. No regex does that. It is a transcription
  artefact, and the durable fix is the one `borrowingCapacity/normalise.pure.ts`
  already names: stop the engine formatting figures into prose.
- The `$7`-for-7% audit rows are **not** this renderer.
  `borrowingCapacity/render.pure.ts` already routes them through
  `formatMeasure`, and `audit.pure.ts` already declares the `percent` unit. Only
  the legacy jsPDF generator puts everything through one currency formatter, and
  only it can produce `-$0`. The defect is baked into the uploaded PDF.
- The closing-page wordmark splitting after "Consulting" is **deliberate** —
  `splitCompanyName`'s doc comment records it as a lockup convention reproduced
  from both prior implementations, two more renderers use it, and
  `reportPrimitives.spec.ts` pins it.

**F1 — an appendix chapter was indistinguishable from a chapter.** Page two said
unmatched sections were "kept as an appendix"; the document then printed them in
the main spine as `SECTION 05`…`SECTION 10`, same eyebrow, same rule, same 30pt
serif, separated only by a 9pt italic dek. The cause was structural:
`planConvertedChapters` numbered by array index over the whole list, `kind` was
tested in one place (for `unfilled`), and it was dropped from the projection
before `buildSpine` ever saw it. The two series are now numbered in one pass —
`SECTION 05` / `APPENDIX A` — and `SpineEntry.number` carries the answer, so the
contents page and the openers read one source instead of counting independently
and agreeing by coincidence. No divider page: `borrowing-capacity` is on
`SHORT_SLOTS`, so the `divider` slot is not permitted on the archetype most
conversions bind to.

**F2 — a subhead read as a chapter title.** `h1` and `h2` shared face, colour,
weight, tracking and line-height and differed only in size, so an h2 was a
chapter title set smaller. Invisible while a chapter title sits above it, and
wrong the moment one does not — a chapter always breaks to a new page and
`page-break-after: avoid` regularly puts an h2 at the top of a fresh sheet with
nothing above it but the running head. h2 is now half the title's size rather
than two-thirds, at a lighter weight, on its own `PRINT_SCALE.subhead` token —
`h2` is also the size of a KPI figure and a chart's hero number, and those are
not the same decision. It stays above 14pt at every `bodyScale`, which keeps it
in the `display` contrast band.

The first version drew an accent rule above the subhead as a third signal, and a
render said what that costs: at the top of a sheet a full-measure hairline is
indistinguishable from a header rule, so it separated the subhead from the page
break rather than from the text above it — and eight subheads down two pages
each with their own gold rule read as a rate card rather than as prose. Dropped.
Two signals are enough.

**And the first blast-radius check for this was worthless.** It rendered a native
Borrowing Capacity Snapshot, which contains **zero** `<h2>` — that format emits
its own subhead class — so it proved nothing while looking like a control. The
formats actually at risk are the ones carrying model-authored Markdown through
`markdown.pure.ts`: Report Q&A and Market Intelligence. A native Market
Intelligence report with thirteen subheads across twenty-two pages is the check
that means something, and it is the one this was judged on.

**F3 — a headerless table crossed a page with no label.** A GFM table whose
header cells are all blank has its `thead` dropped, deliberately: an empty tinted
band is not a header and there is nothing for a screen reader or a tagged PDF to
announce. That is right, and `display: table-header-group` is the only
per-page-repeating box the sheet has, so the table lost its only continuation
marker. It now carries a `caption` naming the chapter it sits in — **at most one
per chapter, and never on a table a heading already stands over — including the
chapter's own title, when the table is the first thing in the body.** Two rounds
of reading pages to get that right. The first version captioned every headless
table, so a chapter with two printed the chapter title twice, the second time
directly under a subhead that had just said something else: `Capacity Breakdown` (34pt title), the table, `Additional
Assumptions` (17pt subhead), then `CAPACITY BREAKDOWN` again. Two competing
labels twelve points apart, and the caption was the wrong one — worse than the
unlabelled table it replaced. The second version tested the *preceding* block,
which excluded the one arrangement where the echo is guaranteed: a table opening
the chapter body has no preceding block, and the chapter's own 34pt title
standing over it. Both conversions then printed that stutter on their densest
page. An empty block list counts as named. **The limit is
stated rather than papered over**: a caption renders once, at the start. A true
per-page "(continued)" would mean synthesising header labels the source never had
— inventing text on a client's document to solve a layout problem.

**F4 — a transcribed line break is not a space.** CommonMark says a lone newline
is a space, which is right for the three formats carrying model-authored prose
and wrong for text a model transcribed off a page: a KPI card printed as
`BORROWING CAPACITY $856,932 Estimate` and six `Label: value` pairs as one
unpunctuated sentence. Fixed at *extraction*, before the faithfulness snapshot is
taken, for the same reason `repairFloatArtefacts` is — a change made later looks
like the design pass inventing text.

The rule itself is worth reading (`reportDesign/prose.pure.ts`), because the
obvious version of it is wrong. `disclaimerParagraphs` already broke on a lone
newline when the previous line *ended on sentence punctuation*, which reads a
hard-wrapped paragraph correctly and reads a KPI card **exactly as wrongly as
CommonMark does** — `BORROWING CAPACITY` ends on no punctuation, so it joins.
Checked against the real transcription rather than assumed. So both ends of the
join are now tested: a newline is a wrap only when the line before it did not
finish *and* the line after it continues — begins lowercase, or on an opening
bracket or quote. One rule, in one module, for both callers.

A line opening on a figure is genuinely ambiguous — `9.44% over thirty years.`
after `…a rate of` is a wrap, `$856,932` after `BORROWING CAPACITY` is not, and
nothing in the text distinguishes them. It breaks, because in this corpus the
second shape is the common one. Pinned in the spec so the choice is visible.

Also: the first version separated *every* block with a blank line, which stopped
every pipe table in the document being a table. Structural runs are now joined by
single newlines and only prose is re-paragraphed.

**F7 — an unfilled chapter said its own callout out loud, twice.** The chapter
dek read *"Supplied by the live report"* in 12pt italic and the callout's eyebrow
forty points below read `SUPPLIED BY THE LIVE REPORT` in 8.5pt mono. The same
four words in two sizes on the same sheet, on the reader's first three pages of a
cross-format conversion. The dek is gone; the callout already says it at length.

**F6 — the disclaimer could vanish without a trace.** Pass five drops the
template's own trailing contact/disclaimer section *because* `renderCompanyPage`
prints the tenant's own — and the drop was unconditional. The tenant's can be
absent five ways, two of which nobody chooses: an unreadable
`global_report_settings` query, which the render routes warn about and swallow,
and a settings row that was never written. Both arrive as `null`, and
`auditSnapshot` guarded on `disclaimer &&`, so those two recorded no gap at all.
The document ended on a page classed `page-disclaimer` with no disclaimer on it.

Now the gap is recorded for absent and empty as well as disabled, and the render
path keeps the template's own closing section when nothing will replace it — it
comes through as an appendix chapter. Losing the tenant's wording in favour of
the template's is a formatting preference; losing the disclaimer from a lending
document is not.

---

## The fifth round: where a page is allowed to break

The fourth round's fixes were judged by reading pages, and reading them found
five more — none in the words on the page, all in where the page ends. Four of
the five are in shared print code, so they reach every format.

**G1 — a contents page stranded its last entry.** Fourteen Market Intelligence
entries put thirteen rows on one sheet and the fourteenth alone on the next, at
0.2% ink, on a named page that carries no running head — page three of a
twenty-two page report was one line floating under nothing, which reads as a
printing fault rather than as a contents page.

The first attempt was CSS: refuse a break after each of the last few rows, the
table equivalent of `widows`. **It did nothing**, because `break-after` is not
honoured on internal table boxes in WeasyPrint — worth writing down, because the
rule looked right and the render was the only thing that said otherwise. So
`renderContentsPage` now splits the entries evenly across sheets itself, from
the same measurement `contentsPagesFor` costs the spine with, and each sheet
carries its own heading. Seven and seven, not thirteen and one. Every other
format passes no cap and is untouched.

**G2 — a section opened two lines before the foot of a page.**
`page-break-after: avoid` on a heading only promises the *next* box, and when
every paragraph is one line the next box always fits — so `Capacity Derivation`
and its single line sat at the very bottom of a sheet with the rest of the
section overleaf. `orphans`/`widows` cannot see this: they count lines inside one
paragraph. Refusing a break after the first block as well keeps heading, first
and second together, which is the smallest unit that reads as a beginning.

**G3 — a chapter printed its own title twice, four lines apart.** At 34pt as the
chapter title and at 17pt as the first heading of its own prose. The natural way
to write a section is to head it with its own name, so a model asked for the
prose of *Executive Summary* opens with `## Executive Summary`. `MarkdownOptions`
gains `chapterTitle`, and a **leading** heading that matches it is dropped —
only the leading one, because the same name further down is a real subsection,
and only for the formats that declare a chapter title separately from its prose.
Report Q&A's body path is deliberately excluded: its chapters are *derived from*
those headings, so removing one would change the document's structure.

**G4 — an entire chapter that is one bullet.** A chapter is a sheet. For a
declarative format that is fine, and for the appendix the packer added in E2
already handles it; a pass-through format is the third case nobody had covered,
because its chapters are whatever the uploaded template's top level happened to
be. A two-bullet `Recommendations` and a one-bullet `Warnings` spent two sheets
on three lines — 0.011 and 0.006 ink against a native document's 0.133–0.221.
Consecutive chapters too thin to hold a page are now packed into one, each under
its own heading, with the same rule and the same helper. The packed chapter keeps
the *first section's* title rather than an invented one, for the reason C5
records. An enriched chapter is never absorbed: its blocks are keyed by its own
id, and a merge would render flat Markdown that the design pass had not costed.

**G5 — a packed appendix dek listed the headings printed below it.**
`From the template` / `Recommendations · Warnings`, and then `Recommendations`
and `Warnings` as the only two headings on the page. The headings are the better
label; the dek is dropped. Same family as E3 and F7.

**And a guard for a mistake made three times.** `css.pure.ts` is one template
literal, so a backtick in a CSS comment ends it — the module stops parsing and
every spec that imports it dies at transform time. The house comment style quotes
identifiers in backticks everywhere else in the repo, which is exactly why it
keeps happening here. `reportCss.spec.ts` now fails on a backtick inside a CSS
comment.

---

## The sixth round: two of the fifth round's five were wrong

Reading the pages again. Three of the five landed clean; **two did not**, and
both were made worse by the fix than by the defect.

**G2 is reverted.** Keeping a heading with its first two blocks did stop a
section opening at the foot of a page — and turned that into a near-empty sheet.
The group it creates is often a chapter's *tail*, and a tail that no longer fits
moves to a page of its own: a subhead and two lines at 1.1% ink, more visible
than the late-opening section it was fixing. The condition that separates the two
cases is "unless this would strand the group", and CSS cannot ask whether the
receiving page would be empty. So the heading keeps its own rule and nothing
more, and the reason is written into the stylesheet where the next person will
look for it.

**G3 and G4 collided, and deleted a heading.** `packThin` builds its body as
`## <title>` per section and returned the first section's title as the chapter's
— and G3 drops a leading heading that matches the chapter title. So the first
member of every packed group lost its heading: `Recommendations` printed at 34pt
with its bullets bare underneath, then `Warnings` at 17pt, which reads as
*Warnings is a subsection of Recommendations* when the two were peers. The
comment claiming "each under its own heading, nothing renamed" was false for the
first one.

Two changes, because there were two faults. `chapterTitle` is not passed for a
packed chapter — its body opens on a real heading, not an echo. And the packed
chapter is named from **all** the sections it holds rather than the first
(`Recommendations & Warnings`), which stops the 34pt title repeating the 17pt
heading below it and stops the first section looking like the parent of the rest.
Their own words joined is not an invented name, which is the line C5 draws.

Three smaller ones from the same read:

- **`From the template` was a machine label on a client-facing chapter opener.**
  Now `Also in the uploaded template` — the same fact in the firm's voice.
- **The cover named the design system opposite the masthead**, wrapped over two
  lines, where it reads as a co-brand on the first surface anyone sees. It is
  build vocabulary and genuinely useful on a draft, so it moved into the meta
  block beside `Bound to` and `Prepared on`, and is absent entirely on a document
  marked final.
- **The page measurer inverted on a page that is mostly card.** A Market
  Intelligence sheet of twelve tinted callouts had the card fill as its modal
  colour by 241,794 pixels to the paper's 234,409, so `measure_pages.py` took the
  cards for paper and the paper for ink: 0.515 coverage and a full-bleed box on
  a page that is neither. An empty page under a >50% fill would have read as 100%
  ink and passed the rubric in silence. The corners settle it — a card is inset
  by the page margin, so whatever the sheet is, it is what the corners are made
  of — and they are only consulted when the two leading colours are close enough
  for the count to be a coin toss.

---

## Looking at the document, and widening what it can be

The third round fixed everything that was visibly broken and the output still
did not look like a designed report beside one generated natively. Three things
came out of comparing them, and the first is a method rather than a fix.

### The rubric, and why it is measured against a real document

`_shared/reports/critique.pure.ts` judges a *rendered* document: near-empty
pages, ink outside the trim, a heading echoed as body copy on the same page, a
block of lines printed on two pages, a page budget that missed.
`scripts/reports/measure_pages.py` produces the measurements from a real
WeasyPrint render — it samples the paper colour rather than assuming one, so a
dark cover does not read as 100% ink — and `scripts/reports/critique.mts` is the
loop:

```
npx tsx scripts/reports/critique.mts <file.html|file.pdf> --keep <dir>
```

The thresholds are calibrated between two real documents rather than invented. A
natively designed report of the same figures measures **0.133–0.221 ink on every
body page and produces zero findings**; the converter's draft had five pages
between 0.017 and 0.053. `SPARSE_PAGE_INK` sits at 0.08, clear of both.

On its first run against a real render it found a defect nobody had spotted: the
"Supplied by the live report" callout printing its own label as its body.

The rubric is a floor, not a standard — it cannot tell you a cover is ugly. The
`report-critic` agent (`.claude/agents/report-critic.md`) runs it and then
*looks at the page images*, which is what actually found every defect in rounds
two and three.

### The vocabulary was nine words in front of thirty primitives

`reportDesign/` ships around twenty primitives and twelve chart types.
`ENRICHMENT_JSON_SCHEMA` named nine of them, and `renderGrid12`, `renderTwoCol`,
`renderWaterfall`, `renderGauge`, `renderDecisionBox` and `renderPullQuote` were
used almost nowhere in the repo.

That was a deliberate decision, recorded in `enrich.pure.ts` as "why the
vocabulary is small", and the natively designed report settled the argument: it
put three headline cards **across** the page, built the capacity up as a
waterfall, and set two note boxes side by side. Every one of those primitives
already existed and no model could ask for one.

The vocabulary now covers what the design system can draw, plus **`row`** — the
one *layout* kind, mapping two or three blocks onto the twelve-column grid. A
chart inside a column is given a context at the column's width, because a chart
drawn for the full measure and scaled into a third of it prints an axis label
four points tall. Rows do not nest: two levels is a layout engine, and nobody
can budget the pages for one.

The original worry — that offering richer shapes invites a model to invent the
data that justifies one — stands, and is answered by the guards rather than by
the omission. A waterfall whose steps do not add up fails `checkFaithful`
exactly as an invented figure in a sentence does. What stays excluded is
anything needing data a transcription cannot carry: heatmaps, calendars,
micro-maps and score wheels want coordinates, dates and dimensions no uploaded
template supplies.

### `surfaceStyle` — ink on paper, or content in containers

A new axis on `ReportDesignOptions`, orthogonal to preset and neutrals. `raised`
gives KPI **cards** rather than a strip, a shell around a table with a tinted
header inside it, callouts and sidenotes as cards, an accent bar beside the
section head, and a faint grid on the paper.

**It defaults to `flat`**, which is every rule the first nine formats shipped
with. Eight of them have golden renders taken against it. Opting in is a
per-design-system decision — `20260827000000` turns it on for NPC Services and
Chancery only, and deliberately not for the other four voices, because six
systems that all print in cards would be one system again.

### What WeasyPrint can and cannot do, tested rather than assumed

The suspicion was that the renderer was the ceiling. It is not. Built as a page
and run through WeasyPrint 69:

| | |
| --- | --- |
| flexbox, **CSS Grid**, `border-radius`, pill shapes | ✅ |
| `linear-gradient` fills, the repeating-gradient paper texture | ✅ |
| rounded table shell via `overflow: hidden`, layered progress bars | ✅ |
| `box-shadow` | ❌ unknown property |
| `filter: blur()` | ❌ unknown property |
| SVG `feGaussianBlur` as a substitute | ❌ also ignored |

Two decorative effects out of everything on a browser-designed reference page.
The soft glow under a card is genuinely unavailable; a gradient fill and a
hairline ring stand in for it. Nothing else needed the renderer changed.

Two things the texture cost, both found by rendering rather than reasoning: a
section's background paints its own box and stops, so the grid must go on the
page box — and the root element's background is propagated to the canvas and
painted *over* that box, so `html, body` must be cleared or the grid survives
only in the margins and reads as a printing fault. And an empty `thead`, which a
key/value table transcribed out of a PDF always has, was invisible until the
header carried a tint and then became a blank band; `renderDataTable` now omits
a header row whose labels are all blank.

---

## Compose: the model lays out the page

The typed vocabulary says *what a passage is* and the design system decides what
that looks like. That split is what makes brand and contrast guarantees rather
than hopes, and it stays. What it cannot express is **composition** — which
things sit beside which, and what fills one page. `row` bought two or three
across; it did not buy a model deciding that page three is a table with a
callout and a sidenote stacked beside it and a decision box across the foot.

`compose: true` on a render request is the other mode. The model writes HTML.

### The bargain

`composeHtml.pure.ts` is the boundary, and it is narrow on purpose:

| | |
| --- | --- |
| tags | a closed list — no `img`, `a`, `svg`, form or media elements |
| classes | a closed list, every one of which `css.pure.ts` defines |
| `style` | **refused, not filtered** |
| colour, size, font, spacing | not expressible at all |
| `src`, `href`, `url()` | nothing may point at anything |
| `<script>`, `<style>`, `<iframe>` | dropped **with their contents** |

Everything else is *unwrapped* rather than dropped — a `<b>` becomes its words —
because losing a paragraph because it was tagged wrongly loses client content,
which is worse than losing its emphasis. What was stripped is reported in the
run's notes.

So the model gains layout and gains nothing else. Every colour still comes from
the resolved palette, every size from the type scale, and the contrast floors
hold. The widest thing a confused or hostile answer can do is arrange the right
components badly, which looks wrong and is not dangerous.

It is written by hand rather than reached for off the shelf: `dompurify` and
`jsdom` are dependencies of the *browser* bundle, this runs in Deno on the
render path, and what is needed is not a general sanitiser but a very narrow
one — a dozen tags and thirty classes. Small enough to read in one sitting,
which matters more than generality for output that is stored, signed and sent
to a client.

### Two guards, adapted

**Faithfulness is stronger here than for blocks.** `enrichedText` is a switch
somebody has to remember to extend; `htmlText` takes the words out of the markup
and is therefore, by construction, everything that reaches the page. The
sanitiser runs *first*, so both guards read what will actually print.

**The quota becomes `composedIsDesigned`.** A model asked for a laid-out page
can satisfy the letter of the request with a stack of `<p>`s — which is exactly
the flat output the feature replaces. A sheet that uses no design-system class
is rejected and retried once.

### The sheet is a page because it ends, not because it is tall

`renderSheet` emits `<section class="sheet">` and the rule is
`break-after: page`. The obvious implementation — give the sheet the height of
the content box so it *occupies* a page — was tried and is wrong twice over: a
chapter header sits above the first sheet, so a full-height box no longer fitted
beside it and the contents were pushed onto the next page under a sheet of blank
paper; and a run of them turned a two-chapter document into ten pages, six empty.

It also must not claim a named page. `.page-body + .page-body { break-before:
page }` exists to separate *sibling* named pages, and a sheet nested inside a
chapter that already is one triggered it — a break before every sheet on top of
the one after it.

Whether a sheet *fills* its page is a question about the composition, not about
the box, and it is answered where it can be: `judgeDocument` measures the ink on
the rendered page.

### Which mode to use

`compose` is absent by default, which means blocks — the path with three rounds
of production behind it. A chapter appears in exactly one of `enriched` and
`composed`, or in neither, in which case it renders as flat Markdown exactly as
the converter always did. The failure of either mode is still the output the
converter produced before any of this existed.

---

## The design pass

### What was wrong

A Borrowing Capacity Snapshot converted in production came back reading far
worse than the PDF it was made from, and the transcription was not the reason:
Claude returned 6,311 characters of Markdown in eleven seconds with every pipe
table and every figure intact. What happened next was
`renderMarkdown(chapter.markdown).html` and nothing else — the renderer imported
*zero* chart functions and never called `renderKpiStrip`, `renderCallout`,
`renderSidenote` or `renderLede` for chapter content. `renderMarkdown` knows
headings, lists, emphasis, blockquotes and pipe tables; every other line becomes
a `<p>`. So the source's KPI strip arrived as a three-column table and its
utilisation bar arrived as a paragraph reading `Proposed loan 76%`.

The design system it was converting *onto* has all of those primitives. None was
reachable from a converted document, because nothing decided which one a given
passage wanted. That decision is the design work.

### Typed blocks, not HTML

A schema-constrained tool call turns each bound chapter's Markdown into blocks
from a **closed vocabulary**, and `renderBlocks.pure.ts` renders them through the
real primitives. The model never emits HTML, never chooses a colour, never sets a
size — it says "these three figures are a KPI strip" and the design system
decides what one looks like under the chosen brand.

| block | renders via | non-degenerate when |
| --- | --- | --- |
| `lede` | `renderLede` | ≤ 240 chars |
| `kpi` | `renderKpiStrip` | 2–4 cells |
| `table` | `renderDataTable` | ≥1 row, ≥1 column |
| `callout` | `renderCallout` | tone ∈ 5, label + body |
| `sidenote` | `renderSidenote` | label + body |
| `bars` | `renderBars` | ≥2 items, not all zero |
| `donut` | `renderDonut` | ≥3 positive segments |
| `bullet` | `renderBullet` | a value **and** a target or a max |
| `prose` | `renderMarkdown` | anything else |

Waterfall, quadrant, heatmap, pictograph, timeline and series-fan are excluded on
purpose: they need shapes a transcription rarely yields, and offering one to a
model that has a page of prose is an invitation to invent the data that would
justify it. `renderGrid12`/`renderTwoCol` are layout, which is the design
system's decision. `renderPullQuote`/`renderDecisionBox` are editorial voice.

Table rows are positional `string[]` rather than keyed objects, because a keyed
row asks the model to repeat a key exactly across sixty rows and one typo blanks
a cell.

### Fidelity

Chosen per conversion, on the render step. Figures are locked at every level.

- **`restructure`** (default) — the same words, in better form. No new prose.
- **`connective`** — may additionally write one opening sentence per chapter and
  short sub-headings.
- **`rewrite`** — may rewrite the prose in house voice, keeping every claim.

The default is the conservative one because a converter that quietly rewrites
somebody's template is not a converter, and nobody has said otherwise yet.
Anything unrecognised on the wire — including an absent field, which is every
request written before this existed — reads as `restructure`.

### Two guards, and one retry

**Faithfulness** (`faithfulness.pure.ts`) runs *enriched → source*: every figure
in the output must appear in the input. Only that direction, because omission is
visible on a review screen and invention is not. Both sides are canonicalised to
numbers rounded to two decimals, so `$856,932` and `856932.00` are one figure —
and so `9.440000000000001`, which this codebase produces whenever a rate is
summed before it is displayed and which appears verbatim in the real failing
document, does not reject an honest answer. Bare integers ≤ 12 and bare years
1900–2100 are ignored on the output side, or "the two scenarios" would fail every
chapter at `connective`. A rescaled rate (`0.0944` → `9.44%`) is *not* accepted:
rescaling is computing.

**The content quota** catches the failure that costs the most and looks least
like one — a model that wraps the whole chapter in a single `prose` block. That
is valid, parses cleanly, and produces exactly the flat output this replaces. A
chapter passes if it produced ≥1 non-`prose` block, **or** if its source has no
table and no figure to promote; that escape hatch matters as much as the rule,
because demanding a chart from three paragraphs of prose is how invented data
gets into a client document.

A chapter that fails either guard is retried **once**, with the rejection handed
back verbatim. Twice is where `designBrief.pure.ts` settled for the same reason:
a model that answers all-prose twice is telling you the chapter is prose.

### It cannot fail the render

Every failure path — no key, a timeout, a refusal, a guard rejecting twice, zero
blocks, a primitive returning `''` — resolves to that chapter having no entry in
the `enriched` map, and a chapter with no entry renders exactly as the converter
always rendered it. The worst outcome of the entire design pass going wrong is
the output the converter produced before it existed. One call per chapter rather
than one per document, so six chapters are six independent chances.

### Saying whether Claude ran

`fidelity`, `enriched_chapters`, `enrichment_model`, `enrichment_blocks` (counts
per kind), `enrichment_notes` and `binding_source` on `template_conversions`;
chips on the result block and in *Earlier conversions*; every guard rejection
listed under the result. *"Is the converter running this through Claude at all?"*
is now answerable from the screen. It was not, and the honest answer at the time
was "for the transcription yes, for the design no".

---

## Binding: proposed, then confirmed

`proposeBindingWithModel` asks a model which section plays each chapter, showing
it the titles and the first 200 characters of each. The answer goes through
`readBindingPlan` — the same reader that validates a plan a person edited in the
browser — so every index is re-checked against the structure and one-to-one is
enforced. On any failure, and on an answer that bound nothing, the word-overlap
scorer's plan is used and the row records `binding_source = 'scorer'`.

The scorer is not a poor relation: for one of our own reports read back it binds
*Capacity at a glance*, *Income and commitments* and *How the capacity is built*
at 88, 96 and 91 with no model involved. What it cannot do is reach
"Serviceability Assessment" → "How the capacity is built", which share no word —
and that is the case a stranger's template is made of.

A person still confirms every row. Nothing here decides anything.

---

## Brand design systems

A name, a brand colour, **optionally its own paper and ink**, and a full
`ReportDesignOptions`. Managed at `/admin/template-builder/brand-systems`.

### Importing one from Claude Design

The published NPC Services Design System's `_ds_manifest.json` carries
`tokens[]` as `{ name, value, kind, scope }` — already parsed — and the token
names it exports are **exactly** the ones `reportDesign/tokens.pure.ts` names as
the source of every print value: `--background` → paper, `--muted` → paperAlt,
`--card` → paperBright, `--aurixa-obsidian` → the cover field, `--border` →
rule, `--foreground` → body ink, `--muted-foreground` → muted ink, `--brand` →
the accent.

Until now that derivation existed only as prose in comments.
`brandDesign/import.pure.ts` makes it executable, and
`src/lib/brandDesign/__tests__/import.spec.ts` runs it over the committed real
manifest and requires the result to equal `PRINT_SURFACE`, `PRINT_INK` and
`PRINT_BRAND.base` **to the byte**. That spec is the acceptance test for the
whole feature: if the derivation reproduces our own design system exactly, it
works on somebody else's for the same reason.

Two input shapes are accepted, because a person will have whichever they have:
`_ds_manifest.json`, or a `tokens/*.css` copied out of the project. The CSS
parser handles the `@kind` annotation sitting *after* the semicolon and the
minified single-line form — `tokens/typography.css` really does put twenty
declarations on one line, and a line-oriented parser loses nineteen of them.

Every role has an ordered fallback chain and **taking any but the first is
recorded and shown**. A project with no `--aurixa-obsidian` takes its dark
theme's own page colour as the cover ground; one with no `--brand` takes
`--primary`. Three roles have no honest substitute — without `paper`, `bodyInk`
or `field` there is no document — and the import is refused rather than
half-completed against our values.

**The app cannot call claude.ai/design.** `DesignSync` is a Claude Code tool
authenticated by a person's claude.ai login; the browser holds an anonymous key
and the edge functions a service-role one. So this consumes what Claude Design
*exports*. The panel says that rather than offering a Connect button that cannot
work.

### An imported system keeps its own paper and ink

`resolveReportPalette` gained one optional input, `neutrals`, and everything
downstream is unchanged — the worst-ground search, the accent correction and the
frozen Category B spread now all run against the *imported* grounds, which is
what makes an import safe rather than merely possible. The converter's render
route passes it (see **D5**); the other eight pass `{ preset, brandHex }` and
cannot pick a design system at all, so their behaviour is byte-identical —
`printContrast.spec.ts` asserts that over every preset and every tenant brand
rather than assuming it.

It is read **all seven or none**. A half-read set would print somebody else's
obsidian cover on our ivory, which looks like a deliberate choice and is a parse
error; a null sends the caller back to the preset whole.

### Category B is now corrected, not copied

The four semantic colours were a bare spread of `PRINT_SEMANTIC`, which was
right while the grounds were four permutations of three values we chose. They
are tuned to clear 4.5:1 on NPC's darkest stock **by about a percent** —
`negative` is 4.58:1 on `#F2EBDE` — so a design system whose panel is slightly
darker pushes all four under the floor and the audit refuses the import. It
would be refusing it for our calibration rather than for anything the imported
system did.

They now go through `ensureContrast` against whichever ground they read worst
against, which walks lightness only and preserves hue. "A tenant cannot make
risk green" is preserved and strengthened: the hue comes from a frozen constant
and no input reaches it; only the lightness moves, and only far enough to be
readable. For all four presets it is a no-op, and the spec proves that by
comparing byte for byte against `PRINT_SEMANTIC`.

The same pass fixed a latent assumption in the accent derivation — "correct
against the darkest ground" is right only while the ink is darker than the
paper, which was guaranteed while the grounds were ours. It now finds whichever
ground the ink actually reads worst against and re-checks after correcting.

### The specimen gallery

The page is laid out as the Claude Design pane: grouped cards, each with a name,
a subtitle, a declared viewport, a mono token line and a paragraph saying why
the thing is the way it is — the four fields and two lines a real `@dsCard`
carries.

Each card renders **`buildReportCss` plus the actual primitives** into a
sandboxed iframe (`sandbox=""`, nothing granted), scaled from its own viewport.
So changing `chapterStyle` redraws the Chapters card into what WeasyPrint will
print, rather than into a React impression of it. There is no second
implementation of the design system to drift from the first.

### The seeded house systems

Six rows: the NPC Services Design System derived from the committed manifest,
and the five report voices — **Chancery, Broadsheet, Slip, Marque, Cadastre** —
which already existed in Claude Design as `report-templates/voices.card.html`
and in code as `scripts/template-library/designSystem.ts › VOICES`, and were not
in the picker at all. Each carries its own paper, panel, cover ground and
hairline; every row was resolved and cleared `auditPaletteContrast` with zero
problems before the migration was written.

**They carry a voice's colour and rhythm, not its typography.** Chancery is
Playfair Display, Broadsheet is Fraunces, Marque is Cinzel, Cadastre is Public
Sans — and `ReportDesignOptions` has no font axis: `PRINT_STACK` is fixed and
`REPORT_RULES.md` records that Cinzel is not installed in the WeasyPrint
container. A font axis is separate work with a container change in it.

### The original contract

A name, a brand colour, and a full `ReportDesignOptions`. That is the whole
surface, deliberately — it is exactly the surface the report design system
already reads, so a saved system is a *position* on the existing rendering path
rather than a new one. Every migrated format picks it up for free.

A system can be authored in the form or drafted by Claude from a brief. Both go
through `readBrandDesignSystem` and both are gated on `auditBrandDesignSystem`;
which end the value came from is not one of their inputs.

### The palette is never stored

`brand_design_systems` holds the brand hex and the options. The palette is
resolved at render time, every time. Storing it would freeze it against the
preset it was derived under, and presets disagree about the paper grounds —
`minimal_ink` has a champagne `paperAlt` where `signature` has ivory, and a
stored `accentOnPaper` derived against one is not legal on the other. That exact
bug is recorded in `brandResolve.pure.ts`.

### The audit is a backstop, not a common failure

`resolveReportPalette` already corrects the two accent roles against the worst
ground each prints on, so most hues a model or a person picks are *rescued*
rather than refused — a near-white `#FBF8F0` comes back as a legible darkened
accent rather than an error. `auditPaletteContrast` then checks every ink role
against every ground, and a system that still fails is refused with the failing
role, its ratio and its floor named. In practice that only happens if a preset is
added without its grounds being checked; running it anyway is what turns "we
derive contrast correctly" from a claim into something the route can refuse on.

Refused, not corrected. Nudging the hue until it passes hands somebody a colour
nobody chose, under a name that says it was designed for them.

---

## The source never becomes a stored file

The upload's bytes arrive in the request and the extracted Markdown is stored on
the row. No bucket for the source, so an abandoned conversion leaves no orphaned
object — which matters here because the repo's artifact retention job
(`pdf-import-retention`) is dry-run by design and never deletes anything.

The cost is a request-size ceiling: `MAX_SOURCE_BYTES` is 6 MB, checked in the
browser and again on the route.

A `.md`/`.txt` source is decoded and needs no model at all. A PDF is transcribed
to Markdown by Claude, sent as a `document` content block so a scanned template
goes through the same path as a native one rather than needing an OCR branch.
The prompt asks for ATX headings above everything else — headings are the only
thing `extractStructure` reads, and a transcription with none produces a
one-section document and a notice saying so — and forbids summarising,
reordering or improving. A converter that quietly rewrites somebody's template is
not a converter.

---

## Where the output lands, and why it is a new bucket

`converted-templates`, private.

Not `report-templates`, where the Template Builder's own assets go: that bucket
is **public**, and its public-ness is load-bearing — asset URLs from it are
embedded in saved template JSON (`secure-storage:52`). A converted draft carries
whatever prose was in somebody's uploaded template, which does not belong behind
a guessable public URL.

Not `template-import-artifacts` either, private though it is: that bucket belongs
to the PDF import subsystem, whose monitoring reports any object it cannot tie to
an import as an orphan (`pdf-import-monitoring:149`). Borrowing it would create a
standing false alarm.

The path carries the conversion id and the upload is `upsert: true`, because
re-rendering one conversion after changing its binding is the normal way the
screen is used and each render is the current draft of that conversion.

---

## Where the feature lives, and how you find it

`/admin/template-builder/converter`, reached from the **Template Builder**
landing page — the split control beside the title, whose menu explains each way
in — and from the command palette (`Cmd/Ctrl+K`, "converter").

That needed fixing rather than documenting. `/admin/template-builder` was an
orphan route: not in the sidebar, not in the command palette, linked only from
the PDF Import Engine page and the editor's back arrow. The sidebar's
`Templates → /templates` led to a **"Builder" tab that duplicated the whole
landing page** — its own search, sort, grid and New-template button, with a
weaker delete that skipped the `is_active` / `locked_for_review` guards. The
reachable surface was the copy; the converter sat on the original. That tab is
now a pointer into the real page, so there is one template list.

The three ways a template comes into existence are written down once, in
`src/lib/reportTemplate/templateStartRoutes.ts`, and rendered in the split menu,
the zero-template empty state and the Templates page. The distinction that
matters:

> **Import keeps the layout. Convert throws the layout away and keeps the
> argument.**

`templateStartRoutes.spec.ts` pins that copy, including the `outcome` line, so a
later refactor cannot quietly drop the sentence that resolves the confusion.

## Finding a conversion again

`convert-template-document` answers a `list` action, and the converter page and
the Template Builder's activity accordion both render it as **Earlier
conversions**.

Before this, a conversion was write-only. The PDF goes to a private bucket that
grants `authenticated` no object access at all, so a stored `storage_path` could
not be turned back into a URL from the browser; closing the tab made the
document unreachable forever. Every listing re-signs each row's URL as it
returns it — a separate `resign` action would have required the UI to know when
a signature expired, which is a clock it cannot see. A row whose signing fails
comes back with `url: null` and no Open button rather than a link that 404s.

**`list` and `chapters` are parsed above the format check.** `parseConvertRequest`
validates `format` for every other action *before* it branches, and neither of
these names a format. Put either below it and the request is refused with an
error about report formats that has nothing to do with what was asked — and the
history panel silently shows nothing. `converterRoutes.spec.ts` guards the
ordering.

## Opening a conversion as an editable template

The result block offers **Open as an editable template**, which asks for the
conversion's `chapters` and lays them out as pages in the visual editor
(`src/lib/reportTemplate/convertedTemplateSchema.pure.ts`).

Three things are worth knowing about that copy:

- **It is not a reproduction of the PDF.** The converter keeps structure and
  discards layout, so the editable copy is the chapters set as text — not the
  design you just looked at. Use **Import a PDF** if you want the original's
  layout back.
- **Its page breaks are estimated, not measured.** The editor schema has no
  reflow — every overlay is an absolute box on a fixed page — so the prose is cut
  using the same `CHARS_PER_LINE` / `LINES_PER_PAGE` estimator the PDF renderer
  uses. Page breaks therefore land roughly where the PDF's do, and a page that
  runs a little long is expected and adjustable.
- **Tables become plain text** in the editable copy. The PDF keeps them.

Creation goes through `manage-templates`, not a direct insert: the
`report_templates` INSERT policy is `WITH CHECK (auth.uid() = created_by)` and
the browser client never holds a GoTrue session, so an anonymous insert is
always rejected. `useReportTemplateMutations().create` already posts to that
function, and is reused unchanged — which also means `is_active`, `is_default`
and `version` stay at the values `validateReportTemplateInsert` waves through.

## The design-system picker, and why it was empty

`generate-brand-design-system` answers a `list` action, and the picker reads it
through `invokeSecureFunction`.

It previously read `brand_design_systems` with the browser Supabase client. That
client uses the anon key with `persistSession: false` and never receives a
session — this app authenticates with custom HttpOnly cookies — and the
converter's migration does `REVOKE ALL … FROM anon` with no re-grant, so the
request failed at the *grant* level before RLS was consulted. The page caught
the error and returned `[]`, which made a refused read indistinguishable from an
empty table: the picker was silently, permanently empty for everybody. Saving a
new system made it worse — the save succeeded, the id was selected, the refetch
returned `[]` again, and Radix rendered an empty trigger for a value with no
matching item.

Three things changed and all three matter: the read goes through the route, the
error is no longer swallowed (a failure renders an alert saying the house design
will be used), and the trigger falls back to the house design when the selected
id is not in the list.

## Access

Both routes gate on `templates` / `can_edit` — the module the Template Builder
page is already guarded by. Creating a design system is an edit even though
nothing client-facing changes, because it decides what every generated document
looks like.

`convert-template-document` additionally re-checks ownership on `propose` and
`render`: a conversion is readable by whoever asked for it and by superadmins.
The table's RLS says the same thing, but the route runs as service role, so it
has to say it again itself.

The binding a person confirms is re-validated on arrival. `readBindingPlan`
re-checks every `sectionIndex` against a structure re-derived from the stored
Markdown — not against the stored `structure` column, which is a convenience for
the review screen — so a hand-edited jsonb column cannot point a chapter at a
section that is not there. An out-of-range index becomes `null` rather than an
error, because "this chapter has nothing bound" is a state the document already
handles.

---

## What stays

Nothing is replaced. `ImportPdfDialog` brings a PDF into the visual editor
keeping its layout; the converter refurbishes one onto the report design system
and binds it to a report format. Different destinations, and both live in the
Template Builder's start menu with a sentence each saying which is which.

---

## Deliberate losses

- **Layout.** By design. See the top of this document.
- **Emphasis inside table cells.** The shared Markdown renderer sets pipe-table
  cells as plain text.
- **Headings past level two.** Kept in the prose, no longer chapter candidates.
- **Sections under `MIN_SECTION_CHARS` (40).** A section that short is a label.
  Counted in `notices.tooShort` and reported, not silently dropped.
- **Anything past `MAX_SECTION_CHARS` (12 000) or `MAX_SOURCE_CHARS` (400 000).**
  Counted in `notices.charsOmitted`.

---

## Formats it can bind to

All eight formats migrated onto the report design system can be bound to.
`bindableFormats()` is the list, and it drives the route's validation, the
`chapters` action's gate and the page's dropdown alike — there is no second
place a format has to be registered.

Seven of the eight **declare** their chapters in `FORMAT_CHAPTERS`:

| Format | Chapters |
|---|---|
| Borrowing Capacity Snapshot | 6 |
| 10 Year Cash Flow Analysis | 4 |
| Cash Flow Comparison Analysis | 10 |
| Client Details | 8 |
| Portfolio Performance Review | 9 |
| Property Comparison Analysis | 12 |
| Market Intelligence Report | 15 |

Each list is the **longest** the format can print. Most of these formats emit a
section only when the payload has something to put in it — Borrowing Capacity's
last three need an explanation, an audit or scenarios; Client Details omits
*Where they live* for a renter — and the converter offers every one regardless.
An unfilled chapter is a state the document already handles, and a template that
*does* carry an audit section should be able to bind it.

Three things are worth knowing about how those lists were arrived at:

- **They are the renderers' own titles, and a spec proves it.**
  `converterChapters.spec.ts` imports each format's section function, builds a
  payload that makes it print everything it can (`formatPayloads.ts`), and
  asserts the two lists are equal in the same order. That spec exists because the
  first version of this list was invented: see **C5** below.
- **Market Intelligence is imported, not retyped.** Its layer titles come from
  `LAYER_TITLES` in `marketIntelligence/payload.pure.ts`, read in `LAYER_ORDER`.
  Eight strings copied by hand is eight chances to make the C5 mistake.
- **Two Cash Flow titles interpolate the projection's term** — *The 10-year
  projection*. A converted template has no payload and so no term; the literal
  is ten, the catalogue standard, and the spec's payload is built at ten so the
  choice is checked. It never affects matching: `tokens()` discards anything two
  characters or shorter, so `10` never reaches the scorer.

**Report Q&A is the eighth, and it has no list.** Not an oversight:
`planFromTurns` titles each chapter with the client's own question and
`planFromMarkdown` uses whatever headings the answer carries, so there is no set
of strings that could be written down and be true. Writing one anyway is exactly
C5. Instead it is a **pass-through** format (`PASSTHROUGH` in `binding.pure.ts`):
the archetype contributes the spine, the page band, the chapter label and the
document name, and the uploaded template supplies the chapters. They are bound
in order, at full confidence, and nothing goes to the appendix. The plan is
rebuilt from the structure rather than read back — rows are matched by chapter
title, and a template with two sections called *Notes* would otherwise collapse
to one row and silently unbind the other.

**The chapters are the template's *top-level* sections, not every section.** The
first version bound all of them, and a render said what that costs: a Snapshot
whose 19 sections are 8 `##` and 11 two-line `###` came out as 19 chapters, so
fourteen of its twenty-one body pages carried a heading and one to three lines —
page 11 at 0.6% ink. `.chapter { page-break-before: always }` is global, so a
chapter is a sheet, and eight two-line sub-headings became eight sheets. It is
the same defect **D1** records fixing, arriving by a different door:
`planConvertedChapters` folds a sub-section into its parent only when the binding
did not want it, and a pass-through binding wanted everything. Fixing it took the
document from 19 chapters to 8 and from 23 pages to 14, still with nothing
unfilled and nothing in the appendix. The real Report Q&A renderer already agreed
— `planFromMarkdown` picks one heading level with `chapterLevelOf`. A sub-section
with *no* shallower section before it still becomes a chapter, because it has no
parent to fold into and `unbound` is empty for this format, so dropping it would
lose it.

Adding a format is one entry in `FORMAT_CHAPTERS` (or one in `PASSTHROUGH`).
Three other places may need a line at the same time:

- `TABULAR_CHAPTERS`, if any of its chapters is characteristically a table —
  the shape signal in `scoreMatch` is keyed off the real titles.
- `CONVERTED_REPORT_TYPES` in `src/lib/reports/converted/reportType.ts`, which
  files an editable copy under an adapter key. That map is exhaustive over the
  archetype union, so a new archetype fails the compiler here rather than
  quietly inheriting the wrong report type.
- The drift-guard row in `converterChapters.spec.ts`, with the maximal payload
  it needs.

---

## Deployment

1. Apply `20260823000000_template_converter.sql`. It creates both tables, the
   `converted-templates` bucket and its policies.
2. Apply `20260824000000_converter_enrichment.sql`. Additive only — six
   nullable-or-defaulted columns recording the design pass.
   Then `20260825000000_brand_system_neutrals.sql` (a design system's own paper
   and ink), `20260825000100_seed_house_design_systems.sql` (the house system
   and the five voices; idempotent on `slug`) and
   `20260826000000_chancery_is_not_the_house_system.sql` (E5 — a single UPDATE
   guarded on the seeded options, so an edited row is untouched) and
   `20260827000000_raised_surfaces_for_the_house_systems.sql` (the raised
   surface style, guarded on the *absence* of the key rather than on the whole
   blob, because the migration before it rewrote one of the two rows).
3. Deploy `convert-template-document` and `generate-brand-design-system`.
   D1–D5 need no migration; D1–D4 are in `_shared` and D5 spans `_shared` and
   the function, so all five reach production only on a redeploy. E1–E4 and E6
   are `_shared` too and land the same way; only E5 carries a migration.

   **`.github/workflows/deploy-supabase-functions.yml` will not do this until
   `SUPABASE_ACCESS_TOKEN` is set.** Without the secret it reports what it would
   have deployed and stops — by design, so that adding the file did not start
   pushing code to anyone's project. The consequence is that it is green and a
   no-op, which is the same silent failure the workflow was written to prevent,
   one level up. Check the run's `Deploy` step: `skipped` means nothing shipped.
4. `ANTHROPIC_API_KEY` must be set for PDF sources, for the design pass, for the
   binding proposal and for drafting a design system from a brief. Without it,
   `.md`/`.txt` sources still convert, the binding falls back to the word-overlap
   scorer, and every chapter renders as flat Markdown — the route says which,
   rather than failing opaquely.
5. `WEASYPRINT_SERVICE_URL` + `WEASYPRINT_SERVICE_TOKEN`, as for every other
   render route.

Both migrations' DDL was executed against production inside a transaction and
rolled back. The first covered the bucket insert, the storage policy, both
foreign keys and a full insert/update round-trip; the second inserted a row
carrying all six new columns and confirmed that the `fidelity` and
`binding_source` CHECK constraints reject an illegal value. `to_regclass` and a
column count confirmed nothing was left behind.
