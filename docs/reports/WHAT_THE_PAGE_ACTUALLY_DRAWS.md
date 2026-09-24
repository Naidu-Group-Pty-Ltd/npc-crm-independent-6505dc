# What the page actually draws

**Read this before changing a declared block height, the verdict block, the
running head, `presentStoredMarkdown`, or `SAMPLE_REPORT_DATA`.**

Four defects, reported by the owner against one 36-page Investment Compass on
19 September 2026 — *"the layout, the overlapping, the headers to be clearer,
and duplication of information"*. Each of them passed every gate this
programme has, and they failed for the same reason in four different places:
**the thing that was checked was not the thing the page draws.**

| what shipped | what the gate measured instead |
| --- | --- |
| the verdict heading printed through the KPI band | a 35-character fixture verdict, in a real browser, on 510 renders |
| `Part 05 · Report` on 29 of 36 pages | the call site's *argument*, which 39 masters discard |
| a bracketed pointer into the prompt, mid-sentence | a rule in the prompt telling the model not to write one |
| the same chart drawn five times | the write path, which every stored report predates |

---

## 1. The verdict heading printed over the figures

### What it drew

Page 3 of the 42 Patya Circuit report, under the eyebrow "The verdict":

```
HOLD - Average investment with mixed indicators, monitor market
conditions. Assessed on 4 of 5 dimensions: capital growth, location,
rental yield and demand.
```

156 characters, set at 29pt. `$1,975,000` and `$850` in the KPI band beneath
were struck through by its last two lines.

### Why nothing stopped it

`verdict()` declared `Math.round(c.scale.verdict * 2.2 + c.scale.body * 4.6) + 18`.
At a heading leading of 1.1, `verdict * 2.2` is exactly **two lines** — and
that reservation was never measured against the sentence that fills it.

Measured across all fifty masters at this catalogue's own 0.52 display advance
— the ratio `sectionHeading` has used since it was measured, and the one
`fitToLines` sizes against:

| what `{{recommendation.headline}}` resolves to | length | masters past 2 lines |
| --- | ---: | ---: |
| `RECOMMENDATION_BY_GRADE`, unqualified | 59–89 | **27 of 50** |
| the claim alone, after `splitVerdictScope` | 59–99 | 33 of 50 |
| the whole qualified string, as shipped | 142–181 | **50 of 50** |

So this was wrong from the day the masters shipped. The appended coverage
sentence only made it universal.

**Three measurements, and they do not agree — say which one you mean.** The
table above is the 0.52 model, read deliberately WIDE so an unknown face packs
sparser rather than overflowing. It is what the sizing answers to, and it is an
upper bound rather than a count of collisions. Rendered in Chromium at the
production string with the fit removed, ONE master collides (§3). And the
document the owner reported overlapped visibly at print metrics, which is a
third measurement again. Sizing to the conservative model is what makes all
three safe.

`flow()` fixes the next block's `y` from the DECLARED height and the renderer
positions absolutely, so an overlong block does not push the page down and does
not overflow it. It lays over what comes next, and every arithmetic check in
the build passes.

### The bound is 99, not 89

`qualifyRecommendation` does not only append a sentence. It **rewrites** the
base one first — "across all metrics" becomes "across the metrics assessed",
"in most areas" becomes "in most of the areas assessed" — because a coverage
caveat beside "across all metrics" contradicts itself in one line. That
narrowing is right, and it takes the A+ claim from 89 characters to 99.

**Reading `RECOMMENDATION_BY_GRADE` is therefore not enough to know what the
page receives.** A block sized against that table is sized against a string the
product no longer prints. `verdictVocabulary.ts` walks the qualified forms —
8 grades × 31 coverages, de-duplicated to 16 distinct headlines — and
`VERDICT_HEADLINE_CHARS` is the longest of them, derived on every seed build
rather than typed.

### Why the type moves and the box does not

The dashboard page carries **15pt of slack above the footer on 49 of the 50
masters**. It is full. Growing the verdict block to fit four lines would push
the KPI band, the callout and the footer off the page on every one of them.

So the block keeps its footprint exactly — no other block moves, no page can
gain or lose one — and `fitToLines` picks the largest quarter-point size at
which `headingChars` still sets in the two lines the block declares. Designed
sizes were 11.5–34.25pt; fitted they are 11.5–19.5pt, and the **23 masters
already inside the model are byte-identical**.

Two rules in that primitive:

- **It never enlarges.** A slot whose vocabulary fits gets its designed size.
- **It steps down until `displayLines` agrees**, rather than trusting the
  closed form. At 481pt of measure and 50 characters a line the arithmetic is
  exact — `481 / (50 × 0.52) = 18.5` — but in binary `18.5 × 0.52` is
  `9.620000000000001`, `481 / 9.620000000000001` is `49.999999999999993`, and
  `Math.floor` takes it to 49. The closed form called a perfect fit one
  character short, on five of the fifty masters. **Deriving a size and then not
  checking it is the same mistake as declaring a height and not measuring it.**

`boundChars` throws when the heading is a binding and no length is declared,
for the reason it already gave for `sectionHeading`: a guessed default is the
silent mis-size the check exists to stop.

### The coverage sentence leaves the heading

`splitVerdictScope` cuts the appended sentence off at the boundary
`qualifyRecommendation` itself creates and publishes it as
`recommendation.scopeNote`. Nothing is dropped and nothing is truncated — and
the report already states the same fact one line below, because `gradedLine`
names the same dimensions in the body of the very same block.

The split is exact rather than a guess: it matches only the sentence that
appender writes, anchored at the end, and returns anything else whole.

---

## 2. Twenty-nine pages that said the same thing

v15 made the running head name the chapter rather than the part. It reached
**eleven of the fifty masters**.

`furniture()` branches on `navigation_style`. A **railed** family draws the
part as an eyebrow and the section beneath it. A **running-head** family draws
the part and **discards the section argument entirely**. So the chapter binding
was composed, published, passed in on all fifty — and drawn on eleven.

The body is ONE part, correctly; renumbering it would be wrong. What was
missing is that a reader thirty pages in had no way to tell the zoning chapter
from the transport one.

`furniture()` now takes an optional `headMarker`, read only by the running-head
branch. The Compass passes `Part NN · {{narrative.chapters.i}}` on its report
pages. The railed eleven, the Compass's own non-report pages and the other nine
formats' 450 masters pass nothing and are byte-identical.

The longest marker the product can compose is `'Part NN · '` plus
`CHAPTER_MAX_CHARS` (64) — anything longer is already the document-name
fallback. 74 characters, measured against the two lines `runningHead` reserves,
on all 39 running-head masters: the narrowest is Sovereign Folio at 6.5pt in
152pt, 38 characters a line, two lines.

### The test that could not see it

`runningChapters.spec.ts` asserted the call site contained
`furniture(DOCUMENT_LABEL, reportPart, '{{narrative.chapters.0}}')`. It did.
The argument is there and on 39 masters it goes nowhere. The call sites are
still checked there, because the railed half reads them; what a source string
cannot vouch for is now asserted against the **built** masters.

---

## 3. A fixture shorter than the product

This is the most useful finding of the four.

`templates:compass:qa` renders all 510 masters in a real Chromium, walks every
text node, takes its client rects and compares every box with every other. It
is a genuine overlap measure — exactly the gate defect #1 belongs to — and it
reported **"no block overflows its page, and none prints over another"** on
every run, while the shipped verdict was printing over the figures beneath it.

Swap the fixture for the longest publishable verdict, take the fit away, and
the same gate answers:

```
✖ 1 block(s) print over another:
  Bullion Rail / p3 "Executive dashboard": 3pt —
    "The verdict STRONG BUY - Excellent investmen"
    over "Purchase price $1,285,000 Contract, before c"
```

With the fit in place it is clean again — 510 renders, nothing over anything.
That before-and-after is the acceptance evidence for §1, and it exists only
because the fixture stopped being shorter than the product.

`SAMPLE_REPORT_DATA.recommendation.headline` read
`'Proceed to offer at or below $1.29m'`. **35 characters.** Every graded
production row carries one of the 59–99 character vocabulary sentences instead.

**A fixture shorter than what the product publishes turns a real measurement
into a statement about the fixture.** The sample now carries the longest
publishable verdict, so the existing 510-render measure catches this class for
every future change — which is a far stronger guarantee than any static
assertion about a number.

This is the same rule the catalogue already records one level up: *resolve
every bound path against a row taken verbatim from production, never against
`SAMPLE_REPORT_DATA`, which is written in the catalogue's own vocabulary and
passes while production is empty.* The sample is not only too *narrow*; where
it is used as the subject of a geometric measure it must also be the
**longest** thing that can land there.

---

## 4. Two things a stored document must not carry

Both are scrubs that existed and ran where they could not reach a document
already stored. Both now run in `presentStoredMarkdown`, the one read-path
scrub all four renderers apply — the same argument that already moved the
placeholder scrub and the chart-evidence contract there.

### The prompt, quoted back at the reader

The generator pins its planning and infrastructure evidence under four
headings that are INSTRUCTIONS: nobody reading the document has ever seen them.
The pinned block already carries a rule saying so in as many words. The
delivered suite carried the pointers anyway — nine of ten documents with at
least one, one Compass with nine, set mid-sentence:

> …must factor into rental and resale expectations.[Infrastructure section] The
> recorded 680 new dwellings…

`stripEditorialBlocks` wrote the lesson down one file over: the v2.0 prompt
said "at most one per section" twice and production carried ninety a report.
**An instruction is a request; this is the guarantee.**

It **substitutes rather than deletes**, because the claim behind the pointer is
sound — both tables are appended verbatim to the finished document under
*Planning controls and development registers*, so there is a real section to
send the reader to. Deleting the bracket would leave the sentence unsourced,
which is worse than an ugly sentence that is sourced. Where the sentence
already introduces the reference ("See …", "as set out in …"), only the section
is named, so nothing reads "see (see …)".

It is a closed set of four strings the prompt itself wrote. **Prose is never
regex-scrubbed**, and this cannot reach a sentence a model composed.

### The same chart, five times

`dedupeChartDirectives` has existed since Stage 4 and ran on the write path
alone — the post-processor, the fork and the condense. A document stored before
that wiring, or one whose repeats arrive after it, keeps every copy for ever,
and so does every child forked from it. On the reported Compass the identical
three-bar price chart was drawn on five pages and the planning controls table
on four.

The same implementation is imported rather than repeated, and it is a **no-op
on a document that carries each drawing once** — which is what makes adopting
it on the read path safe for everything already correct.

---

## Release

Shipped as seed **v16** (`20261207000000`) plus the active-master refresh
(`20261207010000`), which is identical in mechanism to v15's: a master is
replaced only where it is proven an unedited copy of what the library last
published, everything else is snapshotted and recorded as deferred.

---

## 5. A report body read like a chat message

The clipped tail was deferred above as needing the document to diagnose. It did
not: the constant and its own comment were enough, and they should have been
read before deferring it.

### What the reader was told

Page 34:

> **Not shown** — A further 25,804 characters of this answer are not shown.
> The complete text is in the Markdown export.

### What was actually happening

`renderMarkdown` is the one Markdown implementation in this programme, and it
draws the Investment Compass body — `markdownBlockContent` hands it the WHOLE
source, on both the geometry path and the flat one. It cuts that source at
`MAX_MARKDOWN_CHARS`, whose own header says exactly what the number is for:

> The unit of work is one message, not one conversation … the number this has
> to survive is the largest single answer: 33,377. This is twice that.

That is Report Q&A's bound. `compassSectionRegistry` declares the Compass at
**8,410 words across 35 pages**, before ~107 chart directives a report and the
planning and infrastructure registers appended to it verbatim — so the declared
size of the document is past the renderer's bound *by construction*.

`65,536 + 25,804 = 91,340`. The body was written; 28% of it was never drawn.

### Raising one bound is not enough, and that is the part worth keeping

The first version of this fix raised `maxChars` alone. Measured on a
90,000-character body:

| | blocks drawn | source cut | blocks cut |
| --- | ---: | --- | --- |
| today's defaults | 401 | 24,553 chars | yes |
| `maxChars` raised, nothing else | 401 | none | **yes** |
| all three guards raised | **892** | none | no |

`MAX_BLOCKS = 400` carries the same comment one line down — *"A p90 answer is
60–120 blocks. This is a runaway guard, not a budget."* Another answer's guard
on a report's body. Freeing the source and then losing the document at the next
ceiling is the same loss wearing a different notice, and it is the reason the
three guards are now **one `REPORT_BODY_LIMITS` object** rather than three
call-site numbers.

### The notice spoke another product's language

A Compass is not an "answer" and has no "Markdown export". `truncationLabel`
already existed as an option for precisely this and had **zero call sites**, so
every format received Q&A's words.

`maxChars`, `maxBlocks`, `maxHeadings`, `truncationSubject` and
`truncationDestination` are the caller's now, each defaulted to today's value —
so every existing caller is byte-identical and Report Q&A keeps its own words
on its own path. A report says "report", and names **no destination at all**:
with the larger guards this notice should never draw, so it is a fault signal
rather than routine copy, and a client document must not send a reader to a
dashboard or an export they may not have.

### Both sides that count pages read the same limits

`markdownBlockContent` draws the body and `reportBindingProjection` estimates
how many pages it makes. They must agree or the master's page conditionals and
the block's own count drift — the defect that module's header already forbids.
Both spread `REPORT_BODY_LIMITS`, and a test asserts it at the source, because
the two live in different trees and neither imports the other.

### What these numbers are, and are not

Derived from the registry's declared budget with the ratio each original
constant was chosen on — a guard at roughly three times the largest legitimate
input, so that reaching one is a fault to investigate rather than an ordinary
day. They are **not** measured against the stored corpus: 91,340 characters is
one observation, and one observation is not a distribution. That measurement is
the follow-up.

## 6. The body slot the gate had never measured

§3 closed the heading half of the fixture defect. The same blocks bind a body,
and executing the measurement rather than reasoning about it showed the fixture
carried neither field:

| slot | bound by | production maximum | fixture carried |
|---|---|---|---|
| `recommendation.gradedLine` | `verdict()` | 115 chars | *(absent)* |
| `recommendation.gradedDetailLine` | `recommendation()` | 193 chars | *(absent)* |

`renderTextBlockHtml` draws nothing at all for a bound part that resolved to
nothing, so every one of the 510 renders measured a two-element block where a
client's page carries three. The measurement was not wrong about what it looked
at; it was looking at a shorter document than the one the product makes.

Both maxima are the A+ / 100 / four-of-five form, and it is worth saying why
that is not the five-of-five form: `assessedOfTotal` returns null once every
dimension is scored, so the coverage qualifier and the longest weighting clause
are longest *together* one dimension short of complete.

`gradedSlotBound.spec.ts` walks the grade × total × measured-subset × coverage
space `gradedLine` can be called with (1,984 combinations) and asserts the
fixture states the longest string that walk produces — derived, never typed,
for the reason the heading's own bound went stale at 89.

**The outcome is that today's masters survive it.** With both slots at their
true maxima, all 510 renders are clean: no block overflows its page and none
prints over another. That is the honest result and it is worth stating plainly
— the finding is a closed blind spot rather than a repaired document. A
correction to record with it: an earlier reading of the seeded catalogue
counted five `Recommendation` blocks as setting past *two* lines, borrowing
`verdict()`'s two-line allowance. That block declares 96pt and holds three
heading lines plus its body; the two-line rule was never its.

## 7. The same section, written twice

`PLANNING_CONTROLS_IN_THE_REPORT.md` §7 recorded this as a named residual
against the regenerated 262 Pallas Street Compass: the **Due Diligence
Checklist** on pages 24–25 and again on 25–26, the **Final Recommendation** on
page 25 and again on page 26, and one checklist item cut mid-sentence in the
second copy.

The registry is not the cause — `compass.riskDashboard` (9),
`compass.dueDiligenceChecklist` (10) and `compass.finalRecommendation` (11) are
three distinct entries sharing no `sourceHeadings`. The model wrote the latter
two inside the Risk Dashboard's own chunk as sub-headings and then wrote them
again as their own sections. `partitionByRegistry` is right to keep an
unrecognised sub-heading with the section above it; what it cannot know on its
own is that this particular sub-heading is a section the document goes on to
write properly further down.

The rule `foldStraySections` applies: **a heading nested inside one section's
body that names a section the document ALSO writes at its own level is that
section starting early**, and it is carried forward rather than dropped. Four
things decide the shape.

**It merges rather than choosing.** On the document that prompted this the
NESTED copy was the complete one — the standalone copy is where the truncated
item was — so a rule that kept the structurally-correct copy would have deleted
the better text. Where one copy says everything the other does the merge is
exactly the fuller copy; where they genuinely diverge, neither half is lost.
Same answer `captureObjectsFor` gives to the same question.

**A checklist is ONE block, which is why the comparison is not blocks.**
Executing the first version showed it immediately: the nested copy is `1.` /
`2.` / `3.` with no blank line between them and the standalone is `-` / `-` /
`-`, so each is a single block, the two differ in their third item, and nothing
collapsed. A reader still met every obligation twice. A list is compared ITEM by
item, and an item carries its own continuation lines because a wrapped item is
one obligation rather than two.

**A cut-off item is not a fourth obligation.** `- Ask a local property manager`
is `3. Ask a local property manager to confirm the achievable weekly rent`
with its second half missing, and printing both puts a sentence fragment in a
client's checklist. A unit that is the beginning of one already kept, at a word
boundary, is dropped; and a unit that something already kept is the beginning
OF replaces it, so which copy came first stops mattering.

**It acts only where the document names the section properly somewhere else.**
A nested heading with no section-level counterpart is a section buried as a
sub-heading — a different defect, whose fix would re-level a heading, move it
in the contents and change documents carrying no duplication at all. This is a
de-duplication and nothing else, so on a document that repeats nothing it is a
byte-for-byte no-op.

It runs in `presentStoredMarkdown` — the one scrub all four renderers apply —
and **on the read path only**. `report_content` is the source of truth and
`SECTION_STORAGE.md`'s rule is that a repeat is an occurrence to be walked in
order; folding it into storage would make the record disagree with what the
model produced and would re-key the section index. What a reader is shown is
this module's business; what is kept is not.

## 8. A label guillotined at fourteen characters

Found while looking for the three clipped labels §7's residual list names, and
it is a **fourth** rather than one of them. `renderWaterfall` drew its category
labels through

```ts
b.label.length > 16 ? `${b.label.slice(0, 14)}…` : b.label
```

— a hard cut that never wrapped and never once asked how wide the bar's slot
is. Measured 19 September 2026 on the five-step shape a Compass acquisition
build-up draws: the slot is **133 units and holds 19 characters a line**, and
`fitLines` sets all four of the long labels whole in two lines, while the
renderer printed

| the record says | the page drew |
|---|---|
| Stamp duty and transfer | `Stamp duty and…` |
| Legal and conveyancing | `Legal and conv…` |
| Building and pest inspection | `Building and p…` |
| Total acquisition cost | `Total acquisit…` |

The case that settles it needs no production document at all. `{{waterfall:}}`
is one of the twelve chart directives the generator's prompt asks the model to
write, and its own worked example in `vizDirectives.pure.ts` is
`{{waterfall: Gross rent +$50,000, Non-mortgage outgoings -$13,101, Room
=+$36,899}}`. Rendered through the real renderer, that example's own label came
out as **`Non-mortgage o…`** — the documentation cut by the module it
documents.

The fix is the rule `fitLines` exists for and the timeline already answers to:
**increase the component's space before shrinking its text**. The plot keeps
its 260 units and the GROUND grows one line-step per extra line, so a second
line is never set past the bottom of the drawing. Three things follow. A chart
whose labels already fit is **byte-identical** — the documented three-item
example and a short-label chart both stay at 360, and only the five-step
build-up grows to 373. The ellipsis is **demoted, not removed**: a label no two
lines of the slot can hold still says it was cut, because silently dropping the
tail is worse than the truncation this replaces. And the regression guard is
stated as the defect rather than as the fix — no drawn label may be an ellipsis
at exactly the length the old cut produced.

## 9. One number per part, the chapter a page opens in, and the closing page's inset (23 Sep 2026)

Three defects on the 23 Sep 2026 Compass for 97 Poole Road. Each one was
correct as the master declared it and wrong as the page drew it.

**The section numerals skipped numbers, and the page's own head disagreed.**
The openers ran 01, 03, 04, 07, 09 while the running heads above them read Part
01 to Part 06, so the Method page said "Part 06 · Sources" over "09 How this
assessment was reached". The Compass master counts parts when it is
composed, and the tier drops Financials, Cash flow and Projection when it is
rendered. `healedPartNumbers` has renumbered a static `Part NN` marker over the
pages that actually draw since the comparison report's Part 12 → Part 19. The
numeral comes off the same counter (`nextNumeral()` returns the number
`nextPart()` just took) and nothing healed it. It is healed with its marker now
(`healSectionNumeral`), and only where it EQUALS the page's static part number,
so a number an author typed is never touched. The same pass had never read the
rail: the heal looked for `Part marker` and not the `Rail marker` eyebrow, so
the eleven railed masters kept every hole. The heal is in the renderer, so it
reaches the v19 masters already active in production as soon as the frontend
ships, without waiting for a seed.

**A page that opened on a new chapter was headed with the one that had just
ended.** Page 28 opened on "Monitoring & Review Plan" under the head "Due
Diligence Checklist". The first body page opened on "Executive Verdict" under
"Property & Locality Snapshot", the chapter that starts at its foot, because
nothing had been carried in. `runningChapters`' header states the rule as "the
last top-level heading at or before its first block", and the loop read only
what came before the page. A page whose first block is a chapter heading is in
that chapter now. A page that ENDS on a new heading still keeps the chapter it
spent its body in.

**The closing page set its copy 20pt from the paper's edge.** Every other page
sits on the master's margin, about 45pt on that master. The `disclaimer` block
hard-coded `padding: 40pt 20pt`. A master now passes its own `margin`, and a
template that passes none keeps the old inset byte for byte. This one is a
master change, so it rides seed v20.

The Method page gap itself (a callout left under two rows the Compass never
fills) does not arise under v20. That page is drawn only where the front matter
does not flow, and on that tier every row resolves.

## What is still outstanding

One item from the same report is **not** closed here, because closing it from a
description rather than from the document would be guessing: **the repeated
planning table and growth figures across different sections**, beyond the
identical-directive repeats §4 closes and the whole-section repeats §7 closes.
It needs measuring against a regenerated document rather than against a
recollection of the one that was reviewed.

Two of the four residuals `PLANNING_CONTROLS_IN_THE_REPORT.md` §7 named are
also still open: **labels clipped in three primitives** and **the timeline
drawing horizons no item reaches**. Both are geometry inside a drawing rather
than between blocks, which is the one class the 510-render collision measure
cannot see — it compares a block's ink against its neighbours', and a label
clipped inside its own chart overlaps nothing.

A correction to that residual's wording, from reading the code rather than
recalling the document: it says the three "truncate instead" of wrapping, and
that is **not** true of the timeline. `renderTimeline` calls `fitLines`, gives
a lone milestone four lines, and grows the drawing for them; its own comment
names the ellipsis as the rare case where four still is not enough. Whether the
clipped stop on page 13 is that documented case or something else needs the
document. §8 above is a fourth instance of the class, found by reading the
primitives while looking for the three, and it is closed.
