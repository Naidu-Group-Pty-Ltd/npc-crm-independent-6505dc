# S3 — the treatment through the shared path, and what that found

The six-page review composed its figures in a script. This stage moves the
approved treatment into `reportBindingProjection.pure.ts` — the authority all
500 seeded masters and both render routes bind — and draws it for all five
report types from those bindings alone. Everything it found, it found by
drawing the page.

---

## 1 · The four readings are published, not composed

`assessmentReadings.pure.ts` separates what one label was carrying:

| reading | binding |
| --- | --- |
| Performance on the criteria that could be measured | `recommendation.measuredScore`, `measuredGrade`, `measuredLine` |
| Evidence coverage | `recommendation.coveragePercent`, `coverageLabel`, `criteriaMeasuredLine` |
| The grade issued, after any cap | `recommendation.grade`, `gradeCapped`, `capExplanation` |
| Whether the evidence supports an overall conclusion | `recommendation.supportsConclusion`, `conclusionLine` |
| The caveat that belongs beside a weight column | `recommendation.weightRoundingNote` |

Three rules. **Nothing is derived that the record does not hold** — every field
is null where its input is missing, and a null publishes no binding, so a master
drops the line rather than printing a hole. **The cap's figure is the engine's
own sentence**, read from `gradeCapReasons`, never re-derived. And
**`supportsConclusion` is true only where a grade issued AND the evidence did
not cap it** — a capped grade is a statement about what was not measured
wearing the shape of a statement about the property, which is the reason the
activation record requires Growth. That rule decides what the document SAYS; it
changes no score, weight or threshold.

Verified on the stored row at every tier: all five bind all four readings.

## 2 · Three defects the shared path had, which the review script could not see

**D11 — `options.tier` reached the content policy and nothing else.**
`projectInvestmentReport(row, { tier: 'financial' })` on a stored Compass
answered `documentTitle: "Investment Compass"` while publishing all thirty
financial bindings. So a condense fork producing a Financial Analysis carried
the **parent's** title, standfirst and `report.tier` on every page while drawing
the child's content — the defect the identity block's own comment says was
closed, reopened by a second reading of the same question ten lines above it.
One resolved tier now; `assessmentReadings.spec.ts` pins it.

**D12 — the scorecard's fourth column bound the criterion's RATIONALE.**
For Yield that rationale IS the modelling ("2.97% gross yield on a $1,490,000
purchase price"), so a tier that withholds modelling drew a labelled blank
cell. Coverage is a fact about the METHOD rather than about the purchase, so
`assessment.N.measuredOn` is published on every tier — "Full method",
"15% of method" — read off `v2.dimensions[].coverage`.

**D12a — and the two lists key the same criterion differently.** `breakdown`
keys it `growthScore`; `v2.dimensions` keys it `growth`. The join is by name
after stripping the suffix, because pairing them by position would put a figure
against the wrong label the first time either list reorders.

**D13 — the Location sentence blamed the customer's evidence for our defect.**
`NOT_ASSESSED_REASON.location` read *"the available location information does
not meet the current verification standard"* for every cause, including the one
S2 traced: readings obtained in full and not carried into the saved assessment.
It is neutral about the cause now — *"no location readings reached this
assessment for the property"* — because a genuinely failed lookup presents
nothing too, and the client sentence may name neither. The operator `detail`
still distinguishes them, and `LOCATION_PRESENTED_UNVERIFIED` is the one case
where the standard really is the reason.

## 3 · Financial content, verified at its destination before it left the Compass

Measured through the projection on the same row:

| tier | financial bindings | assumptions | ten-year series |
| --- | ---: | ---: | ---: |
| compass | 3 | 0 | 0 |
| briefing | 3 | 0 | 0 |
| strategic | 3 | 0 | 0 |
| snapshot | 30 | 4 | 10 |
| financial | 30 | 4 | 10 |

The Compass's three are `purchasePrice`, `weeklyRent`, `annualRent` — facts
about the asset. The thirty are the analysis of a purchase, and they are
present in the Financial report: the rendered page shows the loan amount, the
weekly holding position and the year-ten equity projection drawn there and
absent from the Compass. **The modelling was verified at its destination
before it was removed from the Compass**, which is the order the owner's
correction requires.

## 4 · The harness is one implementation now

`_reviewKit.mts` carries the three passes both scripts need — measure on the
pinned engine, render on the production print contract, then prove the content
survived. Two things it learned:

- **Read the PDF in content order.** `pdftotext -layout` re-flows a page into
  visual columns and interleaves a table's cells, which reported 27 false
  losses. `-raw` follows the content stream.
- **A table row whose cells include a binding is conditional.** The renderer
  drops the whole row when the bound value resolves to nothing, and that takes
  the row's authored label with it. Counting that label as lost content would
  make the check fire on every correct tier separation. A row with no binding
  in it has no such excuse and is still judged.

## 5 · Accessibility, measured on the artefact rather than claimed

The render contract asks WeasyPrint for `pdf_variant: 'pdf/ua-1'`. Asking is an
export setting. This stage put produced files through **veraPDF 1.30.2**, the
reference validator, and the claim turned out to be false on the path this
redesign uses.

`scripts/reports/validateUa.mts` already existed and already refused to pass
without a validator. What was missing was the validator: veraPDF's own
distribution answers `403` through this egress while Maven Central answers
`200`, and veraPDF publishes its **validation model** there. `scripts/reports/
verapdf/get.sh` resolves it and compiles a front end speaking the same command
line — the official engine, a local wrapper, no check re-implemented.

**The ten flowing formats validated clean before and after.** Every failure was
on the template-master path.

| | found | fix |
| --- | --- | --- |
| **7.3** figure without alternative text | every image, on every document | one `imgTag` emitter, non-empty always |
| **7.2 / 43** table rows of unequal width | every table with a band row | band drawn as real cells, not `colspan` |
| **7.4.2 / 1** first heading is not `h1` | the whole 36-page document | the report's title is emitted as its `h1` |
| **7.18.5 / 1** link not tagged | the contents links, once added | the anchor carries text and nothing else |

Four things only a rendered file could say, each measured on the pinned engine:

**`alt=""` is not "decorative" here.** `<img alt="">` and `<img>` with no
attribute produce a **byte-identical** PDF — 7,167 bytes each on a one-image
probe — and in both the figure is tagged `/Figure` with no `/Alt`. The two
sites that carried `alt=""` (the cover mark, the closing mark) were therefore
two of the three production failures, not a mitigation of them. There is no way
to mark an image decorative on this engine, so the only conforming image is a
described one, and `MISSING_ALT` names an absence rather than inventing a
description of a picture the renderer cannot see.

**`colspan` is written without `/ColSpan`.** The spanning cell reaches the
structure tree as `/TD` with `/A {/O /Table, /Headers […]}` and no span, so a
validator counts the row one column wide. Three arrangements were rendered and
compared with the version they replace: full-width cells are clean but the band
label widens the first column and moves every figure in the table;
absolutely-positioned is clean of 7.2-43 and fails **7.2-9**, because the
engine tags an abspos child of a cell as a second `/TD` nested in the first; a
**zero-width block that overflows** is clean, nests nothing, and differs by 4
pixels of 2,005,644 at 144 dpi.

**The document was called `Report`.** `options.title` is passed by the editor's
preview and by nothing on the production path, and no seeded master declares
`meta.title`, so the fallback literal reached `/Title` on every templated
report — with `/ViewerPreferences /DisplayDocTitle true` asking the reader to
show it. A client opening any report saw a window headed *Report*. The binding
data already names the document and the property.

**A picture can be described by the label its designer gave it.** The one
image left undescribed on the 36-page render was the cover monogram, drawn as
an `image` block with no `alt` and no caption — so page one of every report
told a reader the description was missing. The master already names that block
*Brand mark*, which is text a person wrote about it rather than a guess, so the
block reads its own name after the author's `alt` and the caption the page
prints. All three documents now carry **zero** undescribed images.

**A link is only tagged when the anchor holds text alone.** One `<span>` inside
it fails clause 7.18.5 — 32 checks on the 36-page render. So the contents row
stays a flex box, the label alone is the link, and the folio beside it is not.

## 6 · The contents page reaches the report now

`autoToc` has always linked. The `toc` block, which is the one the catalogue's
masters draw, never did: the 36-page render carried 48 bookmarks and **zero**
link annotations, so the only way through the document was the reader's own
page field.

The destination is exact rather than inferred — `renderPage` is handed
`visiblePages` and stamps `id="tpl-page-<index into that array>"`, and
`ctx.pages` is that same array. Verified on the produced file: the contents
prints folios 1, 2, 3, 4, 5, 6, 35, 36 and the eight destinations resolve to
pages 1, 2, 3, 4, 5, 6, 35, 36.

### 6a · And then it named the wrong things

Eight rows, for a 36-page report whose body is twenty-one sections. The
twenty-nine narrative sheets declare `tocContinues` and fold into the one row
named "The report", so everything a reader opens a contents page to find was
inside that row: *Cover · Contents · Executive dashboard · The assessment ·
Risk and recommendation · The report · Sources and methodology · Important
information*. Correct links to page archetypes are not a contents page.

The outline was worse. WeasyPrint builds it from every `h1`–`h6` it draws, and
two very different things were competing to name the document. A
`markdown-block` heading IS a section name — all 44 of them were already
right. A `text-block` heading is DISPLAY TYPE bound to the record, so the third
entry read *"AVOID - Poor investment opportunity with multiple red flags"*, the
first nested one repeated the property's address under the document title, and
the pages a reader knows as "The assessment" and "Risk and recommendation"
appeared under their headlines.

**The sections were there the whole time; nothing had read them.** A
`markdown-block` packs its source into buckets and draws bucket `pageIndex`, so
the headings in THAT bucket are the sections that page opens — a mapping only
the renderer can make, because pagination and conditional content decide it.
`narrativeIndex.ts` is where that index is published and where its key is
named; the contents block renders it and the page's own outline entry stands
down for it, so **the two surfaces cannot describe the document differently**.

Four rules carry it.

**A section the report wrote outranks the page it landed on.** A page that
opens a section lists its sections; a page that opens none keeps the row it
always had. So the archetype pages still appear under the names their designer
gave them and the body appears under the names the report gave itself.

**A sheet in the middle of a section is not a part of the document.** The index
carries every page the run draws on, not only the ones that open a section —
otherwise pages 25 to 28, the middle of the risk register, announce themselves
as "The report (20)" … "The report (23)" in the outline. `tocContinues` was
approximating this, declared by a master rather than read off the render, and
it is now asked only of a page the narrative does not draw on at all.

**A bound headline may not name a part of a document.** The `text-block`
heading keeps its element, its heading role and every drawn pixel; only its
claim on the outline is withdrawn (`bookmark-level:none`), and the page
contributes its own name at level 2 instead. `includeBookmarks: false` still
means no outline property at all.

**Only the run's own top level, unless a master asks for more.** The Compass's
narrative carries 18 `h2` sections and 26 `h3` subsections; listing both is 51
rows on a page that fits about 30, and `fitTocEntries` would then omit the tail
— which loses the END of the document rather than its detail. A complete list
of sections beats a truncated list of sections and subsections. `sectionDepth`
widens it.

Measured on the produced file (Chancery, schema sha256 `53f5fe7549a07387`,
Annabelle's stored row, production print contract):

| | before | after |
| --- | --- | --- |
| contents rows | 8 page archetypes | **22 sections and named pages** |
| folios printed | 1 2 3 4 5 6 35 36 | 1 2 3 4 5 6 7 8 11 14 15 16 19 21 23 24 29 30 31 32 35 36 |
| destinations resolving to those folios | 8 of 8 | **22 of 22** |
| outline entries that name a part of the document | 44 of 49 | **49 of 49** |
| veraPDF 1.30.2, `-f ua1` | PDF/UA-1 | **PDF/UA-1**, 0 failed rules |

A section row's destination is the **heading's own id** — the same id
`renderMarkdown` wrote and the same one the renderer read to find out which
page it landed on — so the reader arrives at the section rather than at the top
of the sheet carrying it.

Two residuals, measured and left: the engine emits **two identical, co-located
annotations per anchor** (harmless to a reader, and the file validates), and
the **flowing** renderer's documents still carry no internal links at all.

### 6b · The review artefact was not on the print contract

`s1TemplateRender.mts` compiled its HTML the way the route compiles it — the
resource boundary, `fontSource: 'container'` — and then handed the file to
`weasyprint in.html out.pdf`, which takes the CLI's defaults. That is a
different document: untagged, no `/StructTreeRoot`, no output intent. It could
not be put through veraPDF and answer for the product's own PDF, which is the
whole point of validating the artefact rather than the export settings. It
renders through `renderWeasy.py` now, on the same six options the route sends.

## 7 · The chips a colourway could not reach

`_chips.html.ts` held eleven literal pairs with no token reference, so a
family's ten palettes restyled the master and left every badge inside it the
same six colours — on a catalogue that is 50 masters × 10 palettes precisely
because a palette is meant to reach what the master draws. They resolve
`token:chip*` now, with today's value as each fallback, which is the shape
every other block in the tree already uses.

They are **not** repointed at the design system's `positive` / `caution` /
`negative` / `info`: those are different values (Chancery's `--color-positive`
is `#157A3A` against the Strong chip's `#065F46`), so adopting them would
change the drawn colour of every badge on a design already accepted. No
colourway declares a `chip*` token, so every document renders as it did —
asserted both ways, and the re-rendered review is still 161 of 161 authored
strings and still PDF/UA-1.

## 8 · Still open

| | stage |
| --- | --- |
| The six review pages are a review artefact; their prose has not been moved into the masters. | S3 |
| The flowing renderer's documents carry no internal links. | S3 |
| The cover's title is positioned display type carrying no heading role, so the document's `h1` is emitted off the visual surface. The better fix is a semantic role on the title the masters already draw — a generator change. | S4 |
| Report selection, editing, saving, reopening, previewing and exporting exercised end to end. | S5 |
| The ten-year outlook's wider source work. | S4 |
