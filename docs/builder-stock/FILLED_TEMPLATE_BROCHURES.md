# The brochure a builder produced by filling a template

Read this before touching `pdfText.ts`'s `fieldTextByPage`, `readWidgets` /
`widgetBaseMatrix` in `pdfPageImages.pure.ts`, or the widget descent in
`pdfSourcePhoto.ts`'s `collectDrawnImages`.

## What was measured

The Luxton Homes stock list holds 26 property rows. **13 carry a brochure
link**; the other 13 have no link at all, and nothing in this document or
anywhere else can give those a photograph — there is no document to read.

Of the 13 that do, the readers here resolved a primary image for **8**. The
five that came back blank split into two causes, and three of the five shared
one:

| lots | what the reader said | what was actually true |
|---|---|---|
| 231, 516, 6706 | *no page states this property's identity together with its package information* | page 2 states the address, the price, the land size, the build size and the bed/bath/car count — in **AcroForm fields** |
| 313, 318 | *the property cover page presents no photograph* | page 2 presents the facade render, the floor plan and the logo |

This document is about the first three. The last two are a different problem
and are not solved by anything here.

## The text is not only the content stream

`getTextContent` reads what a page **draws**. A brochure produced by filling an
InDesign/Acrobat template draws its *labels* and carries its *values* in form
fields, so page 2 of Lot 231 read as

> `01 01 01 01 Land Price Land Size House Price Total Size Total Size House & Land …`

with not one number in it, and the string `231` appeared on **no page** of a
nineteen-page document about Lot 231. `pageStatesIdentity` cannot match a lot
the reader never handed it, so `findPropertyCoverPages` designated nothing, so
the card stayed blank in front of a document that names the property five
times.

`fieldTextByPage` reads the values and appends them to the page that carries
them. Three rules keep it honest, each pinned by a test:

- **Only what is displayed.** `/F` Hidden or NoView is skipped, and the
  annotation must be a `Widget` — a comment somebody left on the file is a
  reader's remark, never the document's own statement.
- **Only the value, never the name.** "Land Price" is the template author's
  label for a box and the page already draws it. What was missing is
  `$405,100`, and that is all that is added.
- **It can never fail the read.** No AcroForm, a reader build with no
  annotation support, one page that throws — each contributes nothing and
  leaves every other page exactly as extracted.

Nothing downstream is new: the values are page text, judged by the same
identity, package-fact and other-lot-excluded rules as text that was set.

## The picture is not only in `/Resources`

The facade render is inside the appearance stream of a form field the builder
named `Facade image`: `/Annots` → `/Subtype /Widget` → `/AP /N` → a form
XObject whose resources hold a 2000x1250 JPEG. The page's own
`/Resources /XObject` names nothing at all, so every reader here walked the
content stream and the forms it draws, found no raster on the page, and
refused.

`readWidgets` reads the visible ones and `collectDrawnImages` descends them
exactly as it descends a drawn form. Two rules, both tested:

- **A hidden or no-view widget is not on the page**, for the same reason a
  hidden field is not page text.
- **Only the normal appearance.** `/AP` may also carry `/D` (being clicked) and
  `/R` (hovered); neither is what the page shows at rest.

What an appearance needs beyond a form is *where the page puts it*: an
appearance is authored in its own coordinates and the viewer fits its `/BBox`,
transformed by its `/Matrix`, onto the widget's `/Rect`.
`widgetBaseMatrix` performs that mapping (PDF 32000-1 §12.5.5). Using the
identity instead would report the render's page-area share as whatever the
appearance's own box happened to say, and the share floor would then accept or
reject it for a reason unrelated to what the page shows.

### The bug inside the fix

The first version of `readWidgets` resolved `/Annots` with `dictionaryFor`.
`/Annots` is an **array**, not a dictionary, and Adobe's exporter writes it
behind an indirect reference — so it read the empty string, which is
indistinguishable from a page carrying no annotations. Every widget was
invisible and the measurement looked exactly as it had before. `arrayFor`
exists for that, and it is why `/Annots N 0 R` is the shape the test fixture
writes.

## What changed, measured

Same 13 rows, same brochures, same rules downstream:

| | before | after |
|---|---|---|
| resolved a primary image | 8 | **11** |
| and it was the property's own facade render | 8 of 8 | **11 of 11** |

The three recovered are 231, 516 and 6706, each on page 2 — the page whose form
fields state its address — from the field its builder named `Facade image`.

313 and 318 still resolve nothing. Their cover page presents three rasters: the
facade render at 480x339 (below the pixel floor), the Luxton wordmark at
3423x1588 (above it, and rejected only by the page-area floor), and the floor
plan. Nothing in the document says which is the house. That is the case the
picture classifier exists for, and it is deliberately not addressed by
relaxing a floor here: admitting the 480x339 render admits the floor plan too,
`selectCoverHero` then sees two photographs where it saw none, and a page that
resolves today could stop resolving. Widening discovery is only safe where
something else can narrow it again.
