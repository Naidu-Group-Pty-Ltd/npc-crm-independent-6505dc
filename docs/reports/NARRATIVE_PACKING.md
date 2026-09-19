# Narrative packing — the report body on a template's own page

**Status:** live on the Investment Compass path (RS-3c, 14 Sep 2026).
**Modules:** `supabase/functions/_shared/reports/narrativeGeometry.pure.ts`
(the charge model), `markdownPaging.pure.ts` (the packer),
`src/lib/reportTemplate/narrativePlan.ts` (the renderer's pre-pass),
`src/lib/reportTemplate/blocks/markdownBlockContent.ts` (the block's
resolution and memo), `scripts/verify/report-pdf/measureNarrativeMetrics.py`
(the instrument).

Read this before touching the markdown block's styles, the charge model, the
packer, `NARRATIVE_PAGES` in the master builder, or `FOOTER_RESERVE`.

## 1. What was wrong

The report body — `report_content`, the document the model writes — is carried
by a run of forty conditional pages, each holding one bucket of the same
source, each gated on `narrative.pages > n`. The block estimates every
Markdown block's height in lines and packs buckets to a budget. That estimate
was calibrated once, on one family's face at one size over one measure
(`MEASURED_CHARS_PER_LINE = 95`, `CALIBRATED_CONT_LINES = 46`), and then held
back 16% to survive the pages it still got wrong.

Measured through the real journey (Chromium → finalise → local WeasyPrint 69,
`scripts/verify/report-journey/run.mjs`) on the long reference report, every
narrative page of a Midnight render ran its text to y≈800–810pt, through the
running foot at 820, for sixteen consecutive pages. Three independent causes,
each sufficient on its own:

| cause | measured | effect |
| --- | --- | --- |
| figures charged at `MM_PER_LINE` (18.9pt a line, one family's leading) against a 14.7pt pitch | a gauge charged at 62% of its printed height | every figure page overflowed |
| compact figures had no stylesheet in the template path — `.chart-compact { width: 60.5% }` lives in the flowing route's CSS | a gauge drawn for 60% of the measure set across all of it, with the user agent's own `figure` indent | taller than charged, indented for no reason |
| the page bottom was the foot, not the master's `contentBottom` | budget 46 lines from y=114 reaches 791pt; the master sets 744 | 47pt past the line every other block on the page respects |

and two lesser ones: a one-line list item charged at 79% of its own height,
and a five-column risk row charged at seven lines that set at eleven.

## 2. The rule

**A block is charged what it will draw on the page it will print on.** The
geometry the block can read off its own props — the measure, the body size,
the leading, the face — and the styles the block itself emits are enough to
compute that, so they do:

- `MARKDOWN_TYPE` is the block's type scale (heading scales and margins, list
  indent, cell padding, figure margins, callout chrome), declared once and
  read by both `markdownBlock.html.ts` (to style) and the charge functions
  (to cost). The block cannot style a heading one way and charge it another.
- `FACE_ADVANCE_EM` is each face's average advance over ordinary prose, in
  ems, measured with the pinned engine over eighty lines at three sizes
  (Inter 0.48, Noto Serif 0.50, Lato 0.45, Roboto 0.46, Playfair 0.47, IBM
  Plex Mono 0.62). Inter was re-read off real report prose on the Chancery
  render — six full lines of a location list set at 0.462–0.484 em — and the
  instrument's 0.49 charged it three per cent tight. A face not in the table is charged at 0.52 — wider than any
  measured one — so an unknown family packs sparser rather than overflowing.
- `narrativeBottom` recovers the master's own content bottom from the block's
  right edge: `page.height − (page.width − x − width) − FOOTER_RESERVE`. The
  reserve is `NARRATIVE_FOOT_RESERVE_PT`, pinned to `blocks.ts`'s constant
  by a test.
- `NARRATIVE_HOLDBACK` (6%) covers what a character count cannot see — line
  breaking around long words and bold runs — about a line and a half over a
  full page.

Every charge formula was checked against the engine with the instrument,
which sets each probe with the block's exact inline styles and reads the
height WeasyPrint gives it. Paragraph, headings, list, table, figure and
callout agree within 0.4% of a line; the spec
`narrativeGeometry.spec.ts` carries the measured numbers and fails on any
charge that falls below what the engine drew.

Two findings from that instrument are worth keeping. **The box tree is in CSS
pixels** — the first run of the instrument divided pixel heights by a point
pitch and reported every charge 33% low, which is exactly the kind of error a
calibration can bake in unnoticed. And **a lone element's trailing margin
collapses through its container**, so a probe has to establish a formatting
context (`overflow: hidden`) or a heading measures without its own margin.

Tables are the one block whose cost is not a function of characters alone.
Auto layout gives each column its longest word, then shares the remainder by
how much each column has to say — so the "Why it matters" column of a
five-column risk register gets a third of the measure and its 300-character
cell wraps to eleven lines. `tableCharge` models exactly that (damped share
`TABLE_SHARE_EXPONENT = 0.8`, narrow-column wrap loss `TABLE_WRAP_LOSS =
1.12`), verified on the engine's own 10.51 lines a row.

## 3. Who decides the page count

A master carries the same source on forty pages; every instance packs the
whole source and draws its own bucket. The bucket boundaries depend on the
first page's box AND the continuation pages' box, which no single instance
can see — so the renderer computes ONE geometry per run from the template
(`planNarrative`), files it on the context under `NARRATIVE_GEOMETRY_KEY`
keyed by the block's source binding, and every instance packs with it. A
geometry that differed between two instances would print a line twice or
lose it between pages.

The same pre-pass writes each run's true page count over the projection's
`narrative.pages` before any page conditional is read. The projection's
number is a template-blind estimate (it cannot know Noto Serif over 459pt
from Inter over 509pt) and remains what every surface without a template
uses; the renderer's count is what the conditionals see, so a page the
geometry needs is drawn, a page it does not need is not, and the "Not the
whole report" notice fires on the count that is actually true. Both
renderers make the pass (`htmlRenderer.ts`, `pdfRenderer.ts`), and the
buckets are memoised on (source, geometry, palette), so the render that
counts is the render every instance draws from — forty instances used to
render the whole source forty times.

## 4. Filling the page

Once nothing overflowed, the pages ended 60–140pt short of the bottom: a
packer that only pushes leaves the room a block did not fit into empty. Four
rules in `packNarrativeGeometry`, each off by default so the legacy packer is
byte-identical:

- **A paragraph is cut at a sentence** (`splitParagraphBlock`): after
  sentence punctuation, with every inline tag opened in the head closed in
  it, and at least two lines on either side. Nothing is reworded; the parts
  concatenate to the original.
- **A table meets the boundary and splits there** when the room holds its
  head and some rows and the table has six or more — the head repeats, as a
  paper ledger's does. A shorter table is pushed whole rather than orphaned,
  unless it is TALL: a two-row register whose rows are paragraphs
  (`TALL_ROW_LINES`, a fifth of a page in all, `BOUNDARY_SPLIT_TALL_LINES`)
  splits with a head over each row, because a head over one ten-line row is a
  page's worth of reading rather than an orphan. Measured on the sparse
  report: pushed whole, that register left 47% of one page white and stood
  alone on the next. The room must hold the head and the first row, or the
  cut only puts two heads on the next page.
- **A figure floats** past the prose that follows it, up to the next
  heading, and opens the next page. At most two are carried; a figure taller
  than a page is never floated.
- **A tail of at most three lines is folded onto the page before it.** The
  master's bottom sits 76pt above the running foot on every family, so an
  overrun that small lands inside the reserve.

### What the second structure found

The same journeys on the Chancery and Dictionary structures (RS-4) found
four more things, each invisible on Midnight.

- **A charge counts what prints.** Every charge counted the SOURCE —
  `**` around a lead-in, the URL inside `[text](url)` — and a location list
  whose items cite their sources charged 29.9 lines for 24 set.
  `printedChars` / `printedText` count what the inline renderer emits, tags
  stripped; the table model is handed the printed words, because its floor
  is the longest word in a cell.
- **A list is cut where the reader would not notice.** Cutting only between
  top-level items pushed a whole list when one group (a lead-in and four
  three-line children) did not fit the room, leaving 45% of a page white.
  A cut inside a group is allowed where `NESTED_CUT_MIN` children stay on
  each side of it, so a lead-in never stands over nothing and a continuation
  never opens with a lone child.
- **A chunk is cut for the page it lands on.** The first chunk of a table or
  a list is sized to the room left; when it still does not fit (a chunk
  holds a whole row) it opens the next page, so the block is re-cut as if it
  started there — a first row cut for nine lines had stood alone on a page
  70% white while the page-sized chunk behind it could not follow.
- **Inter's advance is 0.48**, re-read off six full lines of real prose.

## 4a. The hole a dropped block leaves

A master lays a page out as a flow and the renderer positions every block
absolutely at the `y` the flow assigned, so a block that is dropped at render
time — its conditional false, or nothing to draw (`blockDrawsContent`) — used
to leave a hole exactly its size. The long reference report's Risk page drew
its heading at 103pt, nothing until 349pt, and the recommendation there: the
register between them is conditional on a risk the record does not carry.

`closeDroppedBlocks` (`src/lib/reportTemplate/closeDroppedBlocks.ts`) moves
the blocks under a dropped block, in its column, up to where it began, so the
gap before it becomes the gap before them. The masters carry no declared
height on a flowed block, so the rule is made safe by what it refuses rather
than by measurement: nothing moves when a drawn block sits in the band between
the dropped block's top and the first follower (a tile beside a dropped tile
keeps its row), only blocks contained in the dropped block's own column move
(a rail beside the column is never crossed), furniture never moves and never
counts, and in the editor nothing moves at all. A block above the dropped one
cannot be crossed either: a flow places each block below the tallest of the
row before it, so a block that ends inside the dropped block's band would
already have overlapped it.

## 4b. A chart label fits the drawing it belongs to

The same renders found four chart labels set past their drawing: a gauge
caption cut mid-word by the viewBox, a donut legend label printed into its
own percentage, a timeline marker's label set straight through its
neighbour's, and a pictograph title run under its count. There is no text
measurement in a pure module, so `fitLines` (`reportDesign/charts.pure.ts`)
wraps a label by word into the units it may use, from an average advance per
character that was read off the engine's own output (0.55 em at these sizes,
bold included; 0.72 em for tracked capitals), cuts what still does not fit
with an ellipsis, and every drawing grows for the lines it adds. The timeline's
stops sit where each gets the same measure — an end label anchored to the
edge, an interior one centred — because with the stops at 44 units the end
measures were 136 against the interior 208.

The template chart block also draws its axis, tick and legend ink from the
template's tokens (`chartInk`) rather than the flowing route's literal
`#1A1A1A` / `#666` / `#EAE3CB`, which on a dark family printed axis labels in
near-black on a near-black ground.

## 4c. The fenced blocks the generator writes

The prompt asks the model for `::: pullquote`, `::: sidenote`, `::: stat`,
`::: divider` and `::: quote-page`; the flowing route draws all five and this
renderer drew none, so each printed raw — fences, attributes and all — in the
client document on every structure. `renderMarkdown` now reads a fence as a
block: a pull quote (and a quote page) is one sentence at the quote scale
behind a rule with its attribution; a sidenote is the sidenote primitive; a
stat card is its label, its figure at display size with the unit, and its
caption between two hairlines; a divider is the same card stating its `stat`
attribute over its headline. Two rules. **A card with nothing to state is
not drawn** — `statCardHasValue` is the write-path hygiene's own predicate,
imported, so the two ends cannot disagree about "empty". And **a kind with no
drawing here is unwrapped**: the fence goes and the body is read as
Markdown, so nothing a fence carries is lost and no fence is ever printed.
Both are styled from `MARKDOWN_TYPE.pullquote` / `MARKDOWN_TYPE.stat` and
charged by `pullQuoteCharge` / `statCharge`, the same declaration.

## 4d. What the engine reads off an SVG

WeasyPrint reads presentation attributes on SVG text and ignores a `style`
attribute: measured with the pinned engine, `style="font-size:6.5pt"` set at
the inherited 9.5pt while `font-size="6.5"` set at 6.5pt. Every tick label of
every template chart block was therefore a body-size figure crowding its axis
title (`$45k` against `EQUITY` on the Dictionary projection page). The block
writes `font-size`, `fill`, `text-anchor`, `font-weight` and `letter-spacing`
as attributes, and uppercases the axis title itself. And a heatmap value is
set in whichever of the ink and the ground reads against its cell — on a
structure whose accent is its ink, a full cell is as dark as the figure
printed on it, and six "1"s read as illegible.

## 4e. The last page is never a stub

Measured on the long reference report's Midnight render after §4–§4d
(RS-4, 14 Sep 2026): the narrative's final page carried two bullets under
the running foot, 84% of its body white, because a seven-item list met the
boundary of the page before it with sixteen lines of room, was cut where the
room ran out — five items on that page, two on the next — and nothing
followed. `absorbTail` folds a tail of three lines back; this one was five
and a half. A last page that thin is the one page a reader sees as
unfinished, and the packer made it two ways: a boundary cut that filled the
page before and left the remainder alone, and a short run of blocks that
missed the room by a line.

`balanceTail` (on for every geometry-packed run, off for the legacy packer)
answers both. **A cut that would leave a stub is made shorter**: the first
piece takes only what leaves the last page a fifth of a page
(`TAIL_MIN_FRACTION`), so the page before still fills and the ending holds
three bullets rather than two and a void — judged on the cut actually made,
because a cut lands on whole items and rows and the lines the room could
not take are the stub's. A list whose head would be a single item, or a
paragraph with too little room for an honest cut, opens the last page
whole instead. The first attempt refused the cut altogether and set the
whole list on the last page, which put a heading and its callout at the top
of one half-empty page and the list they introduce at the top of the next —
two pages a reader sees as accidents in place of one. **A short last page
draws whole blocks down** from the page before it until it holds that
much: never a table, whose chunks each repeat their head; never a piece the
packer cut from a larger block, which would sit beside its sibling as a gap
inside one list or one paragraph; never so many that the page before is
left emptier than the stub it avoids, because a short last page is an
ending and a short penultimate page is a mistake; and whatever comes down
brings its heading or lead-in with it.

## 5. What the projection still owns

`projectReportNarrative` is unchanged: it publishes the source and a
template-blind estimate through the calibrated profile. `resolveNarrativeProfile`
carries `geometryAware`, and a format is packed by geometry when its profile
says so OR when `geometryAwareFormat` names it — Report Q&A and Market
Intelligence joined that way on 14 Sep 2026 (§7), after the legacy arithmetic
they had kept was measured against their own renders and found to fill a
fifth to a half of each page.

## 6. Verification

- `narrativeGeometry.spec.ts` — every charge against the engine's measured
  heights, the bottom rule, the face table, the reserve pin.
- `markdownPagingGeometry.spec.ts` — the four page-filling rules, the tall
  two-row table, and that each is off unless asked for.
- `closeDroppedBlocks.spec.ts` — the column reflow at both the pure and the
  renderer level: the hole closes, a row keeps its tiles, a rail is never
  crossed, the editor is untouched.
- `reportCharts.spec.ts` ("a label never runs past the drawing it belongs
  to") and `chartInk.spec.ts` — the fitted labels and the token ink.
- `narrativePlan.spec.ts` — one geometry per run, the count written over the
  estimate, every instance on the same buckets, the cut notice on the true
  count, and the compact figure at the compact width.
- The journey (`run.mjs --report … --template …`) plus
  `scripts/verify/report-pdf/measure.mjs` on the PDF it produces, which is
  where every number in this document was read. `measure.mjs`'s OVERLAP
  reading pairs text runs by bounding box and pairs a figure's alt text with
  the running foot on two pages of the long report — checked by
  `pdftotext -bbox`, no body line on either page reaches below 771pt.

## 7. Market Intelligence and Report Q&A on the geometry (RS-5c.6)

Neither format had a narrative profile, so their thirteen (MI) and one (Q&A)
markdown runs packed with the legacy line estimate at the schema's
`linesPerPage: 34` against a box that holds about 46 — and the estimate
over-charges on top. Measured through the format journeys on the Chancery
masters (14 Sep 2026): MI continuation pages 20–40% full while the layers
under them were clipped by 6, 9, 14 and 9 pages, 4 of 41 pages carrying
nothing but the "This section continues" callout, an orphan heading closing
page 24; Q&A answer pages 47–57% full while the answer was cut at 8 of an
estimated 26, the cut notice on a page of its own, and the transcript budget
cutting the conversation to one exchange so the further-questions table did
not draw at all.

Five rules, each a renderer change — no stored row and no re-seeded master:

- **A format joins the geometry by being measured, not by being calibrated.**
  `geometryAwareFormat` names MI and Q&A beside the calibrated Investment
  profile. It changes ONLY where the renderer files a geometry — a block
  rendered on its own packs exactly as before, and the template-blind
  estimates the projections publish are untouched.
- **The pages path is read off the template, not assumed.** A continuation at
  `pageIndex` n sits on a page conditional on `<path> > n` —
  `narrative.pages`, `marketIntel.layers[0].pages`, `qa.answerPages`,
  `marketIntel.prose.strategyPages` — and `planNarrative` writes the true
  count at whatever path the master wrote, copying along it with arrays kept
  as arrays (`layers[0]` still answers after the copy).
- **The omission is folded onto the last allowed page.** The pre-pass finds
  the master's own note page (no markdown block, gated on a key beside the
  pages path, a block binding that key), clears the key so that page never
  draws, rewrites the note's counts from the estimate to the renderer's truth
  (`rewriteNoteCounts`: the estimate and the pages it hid, swapped in one
  pass, "page"/"pages" agreeing), files it under `NARRATIVE_NOTES_KEY`, and the
  block drawing the last allowed page packs with that much room held back
  (`PackOptions.reserveLines`, `PageReserve`) and sets the note as a callout at
  its foot. Same words, same page the reader is on, true numbers. MI went from
  41 pages to 36 and the notes from "6 / 9 / 14 / 9 further pages" to
  "2 / 4 / 6 / 3"; the Q&A cut note reads "runs to 17 pages" for the 26 the
  estimate said.
- **A numbered step keeps its bulleted sub-points, and its number.** The
  scanner ended a run on any change of marker kind, so `1.` over four-space
  `*` children (a model's plan) opened a new list at every step; a nested run
  of the OTHER kind now belongs to the item above it (nesting by RANK of
  indentation, so a four-space child is one level down, not two) and
  `listHtml` opens each level with the kind of its own marker. And the
  resumed ordinal is written as the CSS counter the engine reads: WeasyPrint
  69.0 ignores `<ol start>` and `<li value>` (measured) and honours
  `counter-reset: list-item N-1`; `styleTags` merges a tag's own style with
  the block's rather than writing a second `style` attribute the parser drops;
  the browser painter counts from the same `start`.
- **A budget is stated in the units the page is measured in — or not applied
  where it buys nothing.** The Q&A masters set the first answer (bounded by
  their eight answer pages) and LIST the further questions; the flowing
  route's transcript budget only cost that table its rows, so the templated
  path keeps every turn (`BuildInput.keepAllTurns`; `CAPS.turns` and
  `MAX_QUESTION_CHARS` still bound the list) and the projection's note says
  what the document sets: *"The first exchange is set in full; 3 further
  questions are listed without their answers."*

Verified by the journeys (MI 18/18, 36 pages, 0 hard findings; Q&A transcript
17/17, 13 pages; Cash Flow 22/22 ×2 unchanged; Investment 30/30 unchanged) and
by `narrativePlan.spec.ts` (the MI-shaped run: pages path off the
conditional, array kept, note folded with the true count, note page dark, a
run that fits draws no note), `listNumbering.spec.ts`,
`reportQaProjection.spec.ts` (renegotiated on the sentence). One instrument
reading to know: `measure.mjs` flags the word "undefined" as a placeholder
TOKEN wherever it appears — on the Q&A transcript it is the author's own
prose ("an undefined or improvised installation"), which is why the runner
judges TOKEN by eye rather than failing on it.
