# The source's classification, kept

## The gap

`mapDoclingToRawBlocks` reads Docling's label on every text item it extracts —
`title`, `section_header` with a level, `page_header`, `page_footer`, `caption`,
`footnote`, `list_item`, `code`, `formula` — and *uses* it. The label picks a
default weight, a default size, the block type, and it routes page furniture to
a master page.

Then `blockToOverlay` dropped it. `groupId` crossed the plan boundary and
nothing else, so a stored template knew the geometry of every box on the page
and the meaning of none of them.

## What that cost, measured

`render-template-pdf` asks WeasyPrint for `pdf/ua-1` with `tagged: true`, and
WeasyPrint builds the structure tree from the **element name**. Every text
overlay rendered as a `<div>`.

A Docling document through the real production path — `mapDoclingToPagePlan` →
`applyTemplateImportPlan` → `parseTemplate` → `renderTemplateToHtml` →
WeasyPrint 69 → PyMuPDF:

| | before | after |
|---|---|---|
| headings in the structure tree | **0** | `H1` ×1, `H2` ×1, `H3` ×1 |
| `Div` structure elements | 16 | 10 |
| figures carrying `/Alt` | **0 of 1** | **1 of 1** |
| extracted text layer | — | byte-identical |
| page raster at 300 DPI | — | **byte-identical** |

A document claiming conformance to an accessibility standard whose whole point
is that structure is present, with a completely flat structure tree.

The engine was never the limitation. A probe on the same WeasyPrint build shows
`<h2>` tags as `/S /H2` and `<img alt="…">` writes `/Alt` verbatim — the missing
classification was the limitation, and we already had it.

## What was built

**`pdfImport/semanticRole.pure.ts`** maps a Docling label onto a `SemanticRole`
this codebase can act on, and returns **null** for a label it has not been
taught. It is not a classifier: it carries a call the source pipeline already
made. A wrong role is worse than none, because the renderer asserts it into the
exported document's structure and later stages restyle from it.

**`templateSchema.ts`** gains `semantics` on every overlay (`role`,
`headingLevel`, `readingOrder`, `listGroupId`) and `alt` on image overlays. A
field the Zod object does not declare is stripped silently — that is how
`containedRegions` was lost earlier in this programme — so the annotation tests
assert survival through `parseTemplate`, not just through the mapper.

**`blocks/_shared.html.ts`** emits a heading role as `<h1>`…`<h6>` and an
image's alternative text as `alt`.

## Rules that keep biting

**Annotation moves nothing.** This stage may add meaning and must not move a
single point. Proven by SHA-256 of the 300 DPI raster, before and after, on both
a synthetic page and the full production path.

**A heading element needs its margin reset.** The box is absolutely positioned,
so a UA-stylesheet margin moves it. Everything else `h1`–`h6` set — `font-size`,
`font-weight` — is already written inline by `textOverlayStyle.pure.ts` on every
text overlay, so `margin:0` is the only reset needed. That is a fact about the
shared declaration builder, not a coincidence: if it ever stops emitting
`font-weight` unconditionally, every imported heading turns bold.

**Give the flex container a real child.** Vertical alignment makes a text
overlay a flex container. WeasyPrint emits a structure element for the anonymous
flex item it then has to create, and that element **inherits the tag** — so a
bare `<h1>` produces `/H1` nested inside an identical `/H1`. Wrapping the
content in a `<span>` produces `/H1` over `/Span` instead, and is pixel-identical
at 300 DPI. Measured; not a style preference.

**Never a heading element around split paragraphs.** `<p>` inside a heading is
invalid, and a parser recovering from it closes the heading early and leaves the
rest of the copy outside the structure element. The renderer falls back to a
`<div>` when the body contains a `<p>`.

**Docling states a caption by reference.** `picture.caption` is usually empty
while the caption's words sit in their own text block, linked by `$ref`. The
pairing function returned only a group id, so a figure's alternative text could
never see the caption printed directly beneath it and fell through to the
classifier's `"Bar chart"`. It now returns the words as well.

**No placeholder alternative text.** `[image]` satisfies a checker and tells a
reader nothing, which is precisely the failure this stage exists to stop
asserting. Absent stays absent: source description → caption → paired caption
text → the classified kind, then nothing.

## Known gaps, stated

These are real PDF/UA shortfalls that this stage does **not** close, because
each needs something the absolute-positioning model cannot express:

- **Lists.** PDF/UA wants `L > LI > LBody`. Each list item is its own
  absolutely-positioned overlay, so they are siblings with no container to be
  the `L`. `listGroupId` is now stored, which is what a future grouping pass
  would need.
- **Figure/caption association.** `<figure><figcaption>` needs the two to nest;
  ours are two independently positioned boxes. The `groupId` link survives.
- **Running headers and footers as artifacts.** PDF/UA wants page furniture
  marked as an Artifact rather than content. WeasyPrint marks *margin-box*
  content as an artifact automatically; ours is ordinary flow content, and there
  is no HTML-level way to say otherwise. The `pageHeader`/`pageFooter` roles are
  now recorded, so the decision has somewhere to live.
- **Reading order.** DOM order **is** paint order — every image is emitted below
  every text run so that stacking is correct — and the structure tree follows
  DOM order. `readingOrder` is now stored from the source, but reordering the
  DOM to match would change what the page looks like, which this programme does
  not trade away. The order is recorded so a tagging pass that can reorder
  structure without reordering paint has the number it needs.
- **Page rasters and region crops.** A raster-only page and a contained-table
  window are `<img>` elements emitted by `htmlRenderer` rather than overlays, and
  they carry no `alt`. Honest alternative text for "the whole page, as pixels"
  is a different problem from a figure's description.

## Verification

`npm run test` covers the pure mapping, the render contract, and survival
through `parseTemplate`. The structure-tree numbers in the table above come from
WeasyPrint 69 plus PyMuPDF and are reproduced by the harness in the PR
description; veraPDF is not installed in this environment, so conformance is
asserted at the structure-tree level rather than machine-validated.
