# The property's photographs in a client's report

Read this before touching `_shared/reportPhotographs.pure.ts`,
`_shared/listingPagePhotographs.pure.ts`, the `photographs` option on
`get-investment-reports`, the `capture_report` or `capture_brochure_photograph`
operations on `listing-images`, `src/lib/reports/urlExtractPhotographs.ts`,
`src/lib/reports/brochurePhotographs*.ts`, `BrochurePhotographsPicker`,
`src/lib/reportTemplate/adapters/reportPhotographs.ts`, `withCoverPhotograph`,
`floorPlanPage`, `src/lib/reports/investment/investmentPdfPictures.ts`, or the
`property.images` / `property.floorPlans` bindings in the Investment Compass
masters. §6 is the URL-extract path; §7 is the cover photograph on the other
masters; §8 is the PDF brochure path; §9 is the floor plan; §10 is the standard
presentation, which is what a report comes out in when no template is chosen.

## 1. What was asked, and what was actually wrong

On 25 Sep 2026 the owner asked for images to reach the report automatically,
without managing them by hand. They had opened Hero Image Studio for the
60 Lawley Street Compass, and it answered "Couldn't load library". That error
was the Studio's own. It is fixed in `6d7b750b7`: the function imports the
shared request guards again.

Behind it was a finding that mattered more. **Nothing the Studio places reaches
the document a client receives.** `report_hero_placements` is read by one
consumer only: the standard (pdf-lib) presentation. That presentation draws
the placements stacked on a figures page after the body, and only when
`includeHeroImages` is switched on, which it is not by default. The
template-drawn document never read placements at all. That is the WeasyPrint
render through a chosen design, and it is the one the Lawley PDF was. The
legacy renderer did read them per chapter, and nothing calls it any more.

The design system had been built for photographs, and waited on a producer.
Five of the fifty Investment Compass masters bind `{{property.images.N}}`:

| Master | Cover photograph | Full-page plates |
|---|---|---|
| Atelier (`le-01`) | yes | 4 |
| Atelier Plate (`le-02`) | yes | 6 |
| Grand Folio (`le-03`) | yes | 4 |
| Frontispiece (`le-04`) | — | 3 |
| Elevation (`ap-03`) | — | 4, captioned as figures |

`platePage`'s own header called the binding "forward-looking": the day an
adapter carries photographs, every plate fills itself with no template change.
No adapter ever did. Meanwhile the image library held the photographs of every
listing-sourced report, stored, de-duplicated, classified by the server, and
signed for the marketplace. The report pointed at the same listing through
`property_listing_id`, which every fork and condense child inherits.

## 2. The path

1. `investmentReportAdapter.buildBindingContext` asks `get-investment-reports`
   for the report with `photographs: true`. It is one read, behind the same
   `reports` permission as the row.
2. The broker reads the listing's stored images and the reuse reading.
   `photographsForReport` decides which of them may lead a client's document,
   and the broker signs only those, for ten minutes, from the private
   `listing-images` bucket.
3. The adapter turns each signed URL into a `data:` URI
   (`inlineReportPhotographs`). The renderer may make no network request of its
   own (`RENDER_BOUNDARY.md`), and a signed URL expires minutes after it is
   minted. A web-sized JPEG, PNG or WebP goes through byte for byte. A camera
   original, or a format the print engine may not decode, is redrawn to 2,000 px
   on its long edge. That is an A4 plate at about 240 dpi, and it keeps six
   photographs well inside the 25 MB document ceiling.
4. They bind as `property.images`, set after the projection so nothing
   overwrites them. Every photo slot is conditional, so a report with no
   photographs draws exactly the document it drew before.

Every failure costs one photograph and nothing else: an unreadable image table,
a reuse reading that failed, a signing error, a fetch that timed out or an image
that would not decode. A missing picture is what every slot is designed for. A
document that fails to draw because a photograph could not be fetched is not.

## 3. The rule: the gallery's own judgement, tightened for a document

A marketplace gallery and a client's report differ in what an absence costs. A
gallery must never blank a card, so `bandOf` demotes and never filters. A report
has a designed absence. The cost of leaving a picture out is a cover without a
photograph; the cost of putting the wrong one in is somebody else's house on a
client's document. So a report takes, in the gallery's own order and after its
de-duplication:

1. **Positive evidence that it is a photograph.** That means
   `visual_kind = 'photo'`, the server's verdict on the pixels. An image nobody
   has looked at can be a floor plan behind an opaque Google Drive id; 6 of 16
   sampled marketplace heroes once were.
2. **Nothing the gallery would demote.** `bandOf` must say `standard`: not a
   graphic, not chrome, not a thumbnail, and not a photograph another listing
   also holds (a stock render once led seventeen listings). If the reuse
   reading cannot be taken at all, nothing is taken, because "unique" cannot be
   read from a failure.
3. **Enough pixels to print.** A picture known to be under 1,000 px on its long
   edge prints soft at plate size. Unknown dimensions are evidence of neither,
   so they pass.
4. **Of the report's own address and property.** The owner's rule
   (25 Sep 2026): the photographs must be only of that address and property,
   and a slot is never filled with a picture chosen to fill it. The
   photographs are always their source's own. What can differ is the report:
   its address is typed before it is generated and can be edited in the
   report editor afterwards. So on every read the report's address is held
   against the address the photographs belong to
   (`photographsAreOfReportAddress`):
   - on the listing path, the listing's own address, composed from its record
     exactly as the marketplace composes it;
   - on the URL-extract path, the address the extraction read (§6).

   The comparison is `isSameProperty`, the rule the marketplace applies
   before it attaches a photograph to a card:
   - street number, street name and suburb must agree after normalisation;
   - units must agree whenever either side names one;
   - an address with only a lot number never matches, because a lot is not a
     street number.

   Anything that cannot be verified takes nothing: a missing suburb, a
   suburb-only address, or a listing the cache no longer holds.

At most six photographs are carried: the largest number any master binds.

## 4. What this does not do

- **A report made through URL extract had no photographs.** The owner has
  since decided it should carry the listing's own (25 Sep 2026); §6 is how.
- **Eleven masters have no photograph on the cover.** Since seed v21 the
  other thirty-four carry the lead photograph (§7). The eleven are paper
  covers, which need a different design to carry one, not an added block.
- **Duplicate intake records lose their photographs.** One property forwarded
  twice is two listings holding the same pictures, and rule 2 cannot tell that
  from a stock render, because the reuse reading carries counts, not addresses.
  This is the conservative side on purpose.
- **The standard presentation's cover was unchanged** when this section was
  written: it is a static page. §10 puts the lead photograph in the field below
  its lockup, measured off the page, without changing the page itself.
- **A URL-extract report's floor plans came later** (§9, "From a listing
  page"). realestate.com.au publishes a listing's plans as a separate list in
  the same page data, and the capture now reads that list beside the
  gallery. A report made from a listing in the intake carries its plans from
  the image library.
- **A document already produced in a tab is not redrawn** when a photograph is
  harvested later, because the template path's cache fingerprint does not
  include the images.

## 5. Verified, and not

Verified locally:

- `reportPhotographs.spec.ts` (the rule, the reuse reading, the broker's shape)
  and `reportTemplate/__tests__/reportPhotographs.spec.ts` (inlining) pass.
- `investmentReportAdapter.photographs.spec.ts` passes.
- Each rule was removed in turn and the tests failed.
- The Deno type-check of `get-investment-reports` adds no error.

**Not verified: that a real listing-sourced report draws a photograph through
a photographic master.** That needs this deployed, a report whose listing holds
analysed photographs, and one of the five masters above chosen for it. It is
PENDING until someone does that and reads the PDF.

## 6. A report made through URL extract

The owner's decision, 25 Sep 2026: a report made from a listing link carries the
photographs that listing publishes. It reverses the caution recorded in §4 for
this one route, and only for the listing's own pictures.

### The path

1. **The extraction names them.** `scrape-property-listing` now asks the page
   reader for the page as served (`rawHtml`) beside the markdown it already
   read, and `photographCandidatesFromPage` names the listing's own
   photographs from it. On realestate.com.au that is the gallery in the page's
   embedded data, attributed by the listing id in the URL: the "similar
   properties" beside it carry other ids and are never taken, and floor plans
   are a separate list, named apart (§9). **Anywhere else, nothing.** A page's `og:image` was
   the fallback in the first version. It says what the page wants shown when
   it is shared, not which property a picture is of; on a portal or an agency
   site it is as often a banner, an office or a stock photograph as the house.
   It is not read any more. Domain answers this sandbox 403 on every page, so
   its embedded gallery was never measured and a Domain listing names
   nothing. The names are URLs stored on the job; nothing is fetched, and
   nothing about naming can fail the extraction.
2. **The report asks for them to be kept.** Once the report row exists the
   browser sends `listing-images` one request, `op: 'capture_report'`, naming
   the report and the job. Only the report's author may start a capture, only
   from their own finished extraction, and never for a derived report (a fork
   or a condensed child reads its parent's photographs). And only when the
   address the extraction read (`extractedAddress`, `extractedSuburb`) is the
   report's own address (rule 4). Otherwise the request is refused before
   anything is fetched or written. That address goes into the record, and a
   resume stops if the report has since been re-pointed at another address.
3. **The server keeps what passes.** Each photograph is fetched through the
   SSRF guard, must state at least 1,000 px on its long edge, must be judged a
   photograph by the server's own reading of its pixels (a floor plan or a
   graphic is refused), and must not be a copy of one already kept, by checksum
   or by picture. It is filed under the report:
   `report-photographs/<report id>/<place>-<w>x<h>-<checksum>-<signature>.<ext>`.
   Nothing is written to `listing_images`, so the marketplace's reuse reading
   is untouched.
4. **Every document in the family reads them.** `get-investment-reports`
   falls back to the report's folder when the report has no listing, reading
   the parent's folder for a derived document, and signs them exactly as it
   signs a listing's. It serves them only where a readable record vouches
   that they are of the report's address as the report reads now.

### "What if the photographs are not fetched within the browser's minute?"

The owner asked this, and the first version of this route deserved the
question: it did all the work inside the one request the browser sent, so a
closed tab, a dropped connection or a slow host could leave the report with
none, and nothing tried again. Three changes answer it.

- **The minute no longer matters.** The server writes down what was asked, in
  a small record beside the photographs (`capture.json`: the job, the author,
  the attempts, and which candidates are decided), answers at once, and does
  the work after answering (`EdgeRuntime.waitUntil`, as the extraction job
  itself runs). A report takes minutes to generate, and the photographs are
  only needed when its document is drawn.
- **An unfinished capture is finished by the next document drawn.** A picture
  its host did not answer for, or one the time allowance could not reach, is
  left for another attempt; a verdict about the picture itself (not a
  photograph, too small, a copy, a 404) is final. The broker reports a capture
  with work left over as `pending`, and the Investment adapter asks for the rest
  before it draws, waiting at most 45 seconds and never failing the document.
  After four attempts, whatever was kept is what the report carries.
- **The listing's order survives a late photograph.** A photograph's file name
  carries its place in the listing's gallery, not the order it was kept in, and
  a capture is not final while a place ahead of the sixth kept one is
  undecided. So a lead photograph whose host failed on the first attempt still
  becomes the cover on the second.

The start itself is sent again, twice, if it fails in transit (a network
failure, a 429 or a 5xx), never after a refusal. The one case nothing recovers
is a start that never reaches the server at all while the tab is closed within
the same instant; that report is drawn without photographs, which is how every
report was drawn before.

### Why the record is a file and not a table

The link from a report to the extraction it came from is stored nowhere else.
`data_sources` is rebuilt when the report finishes, `manual_overrides` is the
operator's own figures and reaches prompts and templates, and a new column is a
migration. The report's own folder already holds everything else about its
photographs, and the object names describe the photographs, so the two extra
facts (the extraction, and the address its photographs are of) sit beside
them. If the bucket refuses the record, nothing is fetched: no reader may serve
a photograph that no record says is of the report's address.

### Verified locally

- `listingPagePhotographs.spec.ts` (which photographs a page attributes to its
  listing) and `urlExtractPhotographs.spec.ts` pass. The second drives the
  capture's decisions over several attempts against a scripted host: a lead
  photograph that failed first still leads, a host that never answers is given
  four attempts and no more, and a floor plan or a removed picture is never
  asked about twice.
- The same spec pins the joins by reading the source: who may start and who may
  resume, the record written before anything is fetched, the answer given
  before the work, fetches only through the SSRF guard, nothing written to
  `listing_images`, the broker's reading of the family's folder, and the
  adapter's bounded wait.
- Rule 4 is pinned the same way:
  - the address cases: typed differently but the same property; another
    number, street or suburb; a unit against its building; a lot; a suburb
    alone; a street with no suburb;
  - the order of the checks in `listing-images` (address before the record,
    the record before the fetch) and in both of the broker's paths;
  - the page reader naming nothing from an `og:image`.

  With the comparison replaced by an unconditional yes, three of the spec's
  tests fail. With any one of the three checks removed (the capture's start,
  the broker's listing path, the broker's captured path), that check's own
  test fails.
- The REA image host was measured from this sandbox: it serves JPEG whatever
  the request's `Accept` header says, so the server can always read the size and
  judge the picture, and both renditions pass the page-furniture and
  property-image rules.
- The Deno type-check adds no error to `listing-images`,
  `get-investment-reports` or `scrape-property-listing`.

### Not verified

- **A real capture has not run.** It needs the function deployed and an
  extraction of a live listing. It is PENDING until someone does that and reads
  the PDF: the cover should be the listing's lead photograph.
- **Deleting a report now removes its photographs.** Since #2780 (merged and
  published 26 Sep 2026), deleting a report removes its photographs, plans and
  kept document. It never removes the rendered PDF, which a client portal may
  hold. The rules are in `WHITE_LABEL_DOCUMENTS.md` §14. Folders left by
  reports deleted before then remain; clearing them is a destructive sweep and
  waits for the owner's decision.
- **How many existing listing reports rule 4 withholds photographs from.** A
  report whose address was written in a form `isSameProperty` cannot match to
  its listing loses its photographs, on the conservative side. Measuring that
  needs a read of production rows this environment is not permitted to make.
  After deploy, the broker logs `listing photographs are of another address`
  for each one, which is where to count them. PENDING.

## 7. A cover photograph on thirty-four more masters (seed v21)

The Lawley PDF was drawn with one of the forty-five masters that had no photo
slot: a dark cover with an empty field where a reader expected the house.
The owner asked for the photograph on those covers (25 Sep 2026). Seed v21
sets the report's lead photograph (`property.images.0`) by the cover's
ground (`withCoverPhotograph`, and the table in
[`07-investment-compass-families.md`](../template-library/07-investment-compass-families.md)):

- **Sixteen field covers** take it behind the whole sheet, under two passes
  of the field colour's scrim.
- **Eighteen banded covers** take it inside the band, under the same two
  passes.
- **Eleven paper covers** are left as drawn.

Two passes, where Atelier uses one, because these covers carry small type
designed for a flat field. Over a white facade one pass leaves it at 3.48:1;
two come to 7.89:1, above the 7:1 print floor.

It is the same photograph whichever route found it: the listing's own
library (§2) or the URL-extract capture (§6). The rules in §3 still decide
which photographs a report may carry, rule 4 included: only this address.
A report with none draws exactly the cover it drew before. Nothing is ever
put in the space to fill it: no stock image, no photograph of the suburb and
no picture of a similar house. The binding has no fallback.

### Verified locally

- `investmentCompassCoverPhotograph.spec.ts` renders all 34 masters through
  the production renderer. Without a photograph, each draws exactly the HTML
  of the same master with the three new blocks removed. With one, every other
  box on the cover stands where it stood without it. With the slot removed,
  38 of its 74 tests fail. With the layer rule in `closeDroppedBlocks`
  removed, 32 fail: the sixteen field covers, whose cover would otherwise
  rise when the photograph is absent.
- Parsed and compared against v20, row by row: 34 of 543 rows differ, each
  by exactly those three blocks (in `schema` and `preview_schema`), plus
  `property.images.0` in `required_bindings` and, on fifteen field masters,
  `hero` in the block types.
- `templates:library:seed:check` confirms the migration is what the
  definitions produce.

### Not verified

- **A real report drawn through one of these covers.** Both migrations
  (`20261222090000` seed, then `20261222100000` refresh) have been applied
  through the reviewed workflow. What remains is a report whose photographs
  pass §3, and reading its PDF. PENDING (close-out step 1.1).
- **The Claude Design catalogue, read from here.** The slot is composed in
  code from a ground the catalogue declares, and `source.json` is untouched.
  On 26 Sep 2026 the owner reported the catalogue updated to match:
  - Private Banking, Modern Fintech, Dark Executive and Wealth Management each
    have an "A · Cover — with the report's photograph" page with an empty
    image slot.
  - Institutional Research, Corporate Advisory and Data / Analyst carry a
    one-line note that the photograph sits inside the band.
  - Every family has a "Floor plan" page (§9).
  - `Template Catalogue.dc.html` is unchanged.

  That is the owner's report. It was not read from this repository: the
  project is not a design-system project, so the design-sync tool cannot list
  it. The catalogue is the design record. The generator still composes the
  photograph from code.

## 8. A report made from a PDF brochure

The owner, 25 Sep 2026: a new-build report is usually made from the builder's
PDF brochure, uploaded in the PDF section of the Reports page, and the
brochure holds images of the property or its design that the report should
carry. Nothing read them: the browser rendered the brochure's pages for the
parser and the report was written without a photograph. The same rules as
every other route hold here, and rule 4 is the one that decides most: only
this address and property, and never a picture chosen to fill a slot.

### The path

1. **The browser reads the brochure beside the parse** (`readBrochurePhotographs`).
   pdf.js walks each page's operator list, so the walk knows where every
   picture is drawn and how large, whether it is drawn on the page, inside a
   form (how a Canva or InDesign export arrives), or in a form field's
   appearance (how a filled-in template carries its facade). pdf.js decodes
   every encoding the format allows, so no encoding is guessed at.
2. **Floors that need no pixels** refuse a logo or an icon (under 6% of its
   page), a banner (a shape more extreme than 1:4), anything under the 1,000 px
   print floor, and a raster that IS the page: a scan, whose "photograph" has
   the brochure's type baked into it. A picture drawn more than once on a page,
   or on three pages or more, is furniture and is never offered.
3. **The server's own judgement of the pixels** (`listingImageVision.pure.ts`,
   the same module on the same 64-pixel square) says which survivors are
   photographs and which are floor plans. A graphic is never offered. A floor
   plan is offered apart from the photographs and filed apart from them (§9).
4. **The pages are read for the property, in the words the page prints.** A
   page that names the property's lot, or its street number and street, is
   where its pictures are; a page naming another lot is that lot's.
5. **Only a page that names this property can offer a picture.** This is the
   rule the owner's own brochure decided, and §8's measurement below is why.
   The largest photograph on such a page is ticked as the cover; the adviser
   can tick up to six and untick any.
6. **The ticks are filed once the report exists** (`op:
   'capture_brochure_photograph'`, one request a photograph, in order, never
   awaited by the generation). **The page is held while they are in flight**
   (`fileWhilePageHeld`): the pictures exist nowhere but that page, so closing
   or reloading it asks first, and the report is announced and the form
   cleared only once they have landed or a minute has passed. Before this the
   filing was fire-and-forget behind an announcement that invited the adviser
   to leave, and a close in those seconds lost the pictures for good (Codex's
   review of #2775, P1). The server authenticates, asks for the
   `reports` permission, meters (30 a minute for a person, 60 for an address),
   files only for the report's author, never for a derived report and never
   beside a listing capture. It writes `brochure.json` first (the brochure's
   SHA-256, the address it names, who asked and when), holds the report's
   address to that address, then keeps a photograph only on its own verdict:
   at print size, judged a photograph, not a copy of one already kept. Each is
   filed where a capture's are, named by its place.
7. **Every document in the family reads them.** The broker reads
   `brochure.json` where the folder holds no `capture.json`, and serves the
   photographs only while the report's address, as it reads now, is the
   brochure's. The Financial, Due Diligence, Briefing and Snapshot documents
   are made only from a Compass (the condense route refuses any other parent,
   the fork forks the composite), so all five read the same folder.

### What the owner's brochure measured

The example the owner sent (a VERV "NEX 20" house-and-land package, nine pages,
Lot 1629 Hornsea Street, Palomino Estate, Armstrong Creek) found two faults
the synthetic tests could not.

- **The lot line was unreadable.** pdf.js hands a page's text over in runs,
  and a run ends wherever the PDF changes font, which a designed brochure does
  mid-word. That line is seven runs: `L` · `ot` · ` ` · `1` · `629` · ` ` ·
  `Hornsea Street`. Joining every run with a space read it as `L ot 1 629`, so
  no page could name its own lot. pdf.js already writes the spaces the page has,
  so `joinPageText` joins runs with nothing, and separates them only where the
  page does: a line ends, the next run sits on another line, or it starts clear
  of where the last one finished.
- **A builder's brochure is one page about the lot and eight about the
  builder.** Seven pictures pass the floors: page 1's facade render (a
  photograph) and floor plan, a couple walking through another estate on
  page 5, and four homes the builder built elsewhere on page 6. The first cut
  offered every photograph on a page naming no property, unticked, for the
  adviser to judge. That put five pictures of other places in front of the
  person choosing a client's cover, with nothing on screen to tell them apart,
  so a page that names no property now offers nothing, and the picker says
  why. Measured through the real page in Chromium after the change: one
  photograph offered, the 1,280 × 720 facade render, ticked as the cover, and
  filed byte-identical to the brochure's own.

### The address rule for a lot

`isSameProperty` refuses an address that is only a lot, which is right for a
listing and wrong for a new build: `Lot 1629 Hornsea Street` is the only
address the property has. `brochurePhotographsAreOfReportAddress` accepts it on
one condition, that both sides name the same lot, and then everything either
side states must agree: street number, unit, street and suburb. Any other
address goes through `isSameProperty` unchanged.

### What this does not do

- **A design render on a page that names only the design.** A brochure that
  shows the facade on a page titled "NEX 20" and names the lot elsewhere offers
  nothing from that page. That is the conservative side of the rule above.
- **A brochure whose text is drawn as outlines.** It has no words to read, so
  no page names the property and nothing is offered.

### Verified locally

- `brochurePhotographs.spec.ts` (the walk, the floors, the lot rule, the page
  reading, the offer, the filing and the source scans of `listing-images`, the
  broker and the generator), `brochurePhotographsPdf.spec.ts` (the walk through
  the real pdf.js over a brochure built for it, with a picture on the page,
  inside a form, in a form field's appearance, and a full-page scan) and
  `brochurePhotographsPicker.spec.tsx` pass.
- The whole flow on the real Reports page in Chromium, every Supabase call
  answered by the harness double: parse, picker, generate, then one filing
  request a ticked photograph with its place, the brochure's digest and its
  address. Run against synthetic brochures (one lot, several lots, no lot) and
  against the owner's brochure.
- The Deno type-check adds no error to `listing-images` or
  `get-investment-reports`.

### Not verified

- **The parse's answer for the owner's brochure was simulated.** The journey's
  double answered `Lot 1629 Hornsea Street`, `Armstrong Creek`, which is what
  page 1 prints; `parse-property-pdf` was not called, because it spends a model
  call. PENDING.
- **A real filing has not run.** It needs `listing-images` and
  `get-investment-reports` deployed, a report made from a brochure, and the
  PDF read: the cover should be the brochure's facade. PENDING.

## 9. A floor plan, on a sheet of its own

The owner, 25 Sep 2026: "maybe we should consider inserting the design and
floor plan if applicable … and in the brochure". A new build's brochure
usually carries the plan the house will be built to; the owner's example
carries one on page 1, beside the facade render (1,199 × 751, which the server
judges a floor plan). A buyer reads a plan before almost anything else a report
says about a house.

### Why a sheet of its own, and never a photo slot

Every photo slot in the catalogue fills its frame and crops what does not fit.
That is right for a facade and wrong for a plan: a cropped plan is a plan with
a room missing, and nothing on the page says so. So a plan is never bound to
`property.images`; it has its own binding, `property.floorPlans`, and its own
page, on which it is drawn whole (`contain`), centred, never rotated (a rotated
plan has lost its north). Two rules follow from "whole":

- **The sheet is conditional on the plan.** Most reports have none, and a
  report without one loses the page rather than printing an empty sheet.
- **A plan is not a photograph, in storage or in the broker.** It is filed
  under `report-photographs/<report>/plans/` (`floorPlanFolder`), judged
  `floorplan` by the server before it is kept, capped at
  `REPORT_FLOOR_PLAN_LIMIT` (2), and served as `floorPlans` beside
  `photographs`. A listing report's plans are the image library's
  `visual_kind = 'floorplan'` rows, under the same reuse and print-floor rules
  as its photographs.

### The path

1. **Offered in the picker, apart.** `buildBrochureOffer` keeps a picture the
   server's vision reads as a plan in `plans`, under the same page rule as a
   photograph: only a page naming this property. The picker shows them under
   "Floor plan", drawn whole (`object-contain`), up to two ticked.
2. **Filed with `kind: 'floorplan'`.** The same `capture_brochure_photograph`
   operation, with a second target folder and limit; it refuses anything its
   own judgement does not call a plan (422 with the reading), so a photograph
   cannot be filed as a plan or a plan as a photograph.
3. **Served and bound.** The broker lists the plans folder beside the
   photographs, signs them, and the Investment adapter inlines them as
   `property.floorPlans`.
4. **Drawn.** Every Investment master (seed v22) carries two sheets, "Floor
   plan" and "Floor plan, continued" (`floorPlanPage`), each conditional on its
   own plan: the family's own section heading and the address, the plan in the
   room between, and a three-line title block at the foot: not to scale, where
   it came from, and to check it against the contract drawings.

### From a listing page

A report made through URL extract (§6) takes the listing's own plans the way it
takes its photographs, and files them where a brochure's go, so steps 3 and 4
above serve and draw them unchanged.

1. **The extraction names them apart.** `floorPlanCandidatesFromPage` reads
   `media.floorplans` from the realestate.com.au listing object that names the
   page's own listing id: the same attribution as the gallery, and only the
   list the page itself calls floor plans, never a guess from the gallery. They
   are stored on the job as `photographs.floorPlans`, at the photographs'
   rendition (`2000x2000-fit`, the original's frame: never cropped, padded or
   enlarged). Up to four are named, for a report that carries two.
2. **An asset the page lists as a plan is never offered as a photograph**,
   even where the agent put it in the gallery as well. The server's reading
   refuses most plans as photographs anyway, but a coloured or rendered plan
   can read as a photograph, and a photograph can lead a cover.
3. **The same capture keeps them.** `capture_report` runs the same attempts
   under the same record and the same address check (rule 4), in two passes
   that share one allowance, photographs first, because the cover is what a
   reader sees first. A plan is kept only on the server's own `floorplan`
   verdict, at the print floor, one copy each, at its place in the page's list,
   in `plans/`. Its list is settled apart in the record (`plans`), because one
   asset can sit in both lists: refused as a photograph for being a plan, and
   still tried as a plan. The capture is finished when both lists are
   (`captureFinish`). With no plans named, every answer is exactly what it was
   before plans were read, which is every record already written.
4. **The furniture rule is a photograph's, not a plan's.** It refuses a file
   called `floorplan`, which is how a plan is kept off a photo card and exactly
   what a plan may be called. So it is lifted for a listing's plan and for
   nothing else, and in its place a stored plan must be on realestate.com.au's
   own image host, the only host any plan is read from.
5. **The browser asks where the extraction named either.** A listing whose page
   names a plan and no photograph still has its plan kept.

### Where the sheet goes

After the cover, the contents and any photographic plates, and before the
executive dashboard, in all fifty masters. The owner chose "own page after the
overview"; the overview is not a page, though. The front matter flows straight
into the report's body on the same sheet (seed v20), so a page placed after it
would stand between the body's first page and its second. The first place a
page can stand without splitting prose is before the verdict, where the
pictures of the property are met together: the cover shows the home, the plan
shows its layout, and the assessment follows. Moving it to the back of the
document is a one-line change in `templates.ts` if the owner prefers.

It has no running head, like the plates beside it. A running head names a part,
and giving the sheet a part would renumber every later page's head in all fifty
masters, which would break the promise below.

### What the release is, measured rather than claimed

Parsed out of the v21 and v22 seed files, 543 rows each:

- **50 of 543 differ**, exactly the Investment masters. The other nine formats'
  450 masters and the 43 voice templates are byte-identical.
- Each gains **exactly two pages**; every existing page is byte-identical, in
  its old order, under its old id. 44 gain 10 blocks and 6 gain 8.
- Outside `schema`, only `page_count` (+2) and `required_bindings`
  (`property.floorPlans.0` and `.1`) change.

`20261223100000` refreshes the active masters by the v15 mechanism, unchanged.

### Verified locally

- `investmentCompassFloorPlan.spec.ts` renders all fifty masters through the
  production renderer: without a plan each draws **byte for byte** what the
  same master draws with the two sheets taken out of its schema; one plan
  prints one sheet, two print two, each drawn `contain`; all five documents
  keep the sheets, graded or not.
- `templates:compass:qa` with both sheets drawn: 410 renders, no overflow, no
  collision, no unresolved binding.
- `templates:library:seed:check`: the v22 file is byte-identical to what the
  definitions produce.
- The owner's plan drawn on the sheet in ten families, wide and turned tall.
- The listing-page plans: `listingPagePhotographs.spec.ts` (the page names
  them apart, by the listing id, capped; a listed plan is never a photograph;
  a stored list is re-checked, and a plan called `floorplan` survives) and
  `urlExtractPhotographs.spec.ts` (a record written before plans reads as one
  that asks for none; with no plans every finish is the photographs' own; the
  capture finishes only when both lists do; the lists settle apart; the
  source-level order of the two passes, their shared allowance and the plans
  folder). Seven deliberate mutations of those rules each fail a test.

### Not verified

- **v22 is applied.** The seed and its refresh ran through the reviewed "Apply
  a migration" workflow after merge, as v21's did (runs #110 and #112). A
  customised active master is deferred by a refresh and does not take the
  floor-plan sheet; which ones, if any, is read from production (close-out
  step 5.4).
- **A real filing of a plan has not run**, for the same reason as §8's. PENDING.
- **A listing page's plan has not been fetched from realestate.com.au.** The
  owner's rule is that no outside picture is used for testing, so the plan
  list's shape is the one the photographs were built against, and what the
  image host serves for a plan (its format and size) is unmeasured. A plan it
  serves as GIF or WebP is refused `unreadable`, because the capture decodes
  only JPEG and PNG; the refusal is counted in the record's `plans.refused`
  and in the capture's log line, so production will say so. PENDING: the
  first URL-extract report made from a listing with a plan.

## 10. The standard presentation

The standard presentation is what a report comes out in when no template is
chosen: `investmentPdfDocument.ts`, drawn with pdf-lib over the brand cover and
the content page of `public/templates/npc_template.pdf`. Before this it drew no
photograph and no plan, whichever route found them; §7's covers and §9's
sheets reached only a chosen template. It now draws both, from the same reader
(`loadInvestmentReportWithPhotographs`, exported from the adapter), so a report
does not gain a floor plan or lose its photograph by being left on the default.
The pictures are read only when this presentation is the one being drawn, after
the template route has declined, so a templated document costs no second read.

### The cover

The cover is a finished brand page, so everything was measured off it
(`investmentPdfPictures.ts` header) rather than assumed:

- the gold borders end at x 12.5 and resume at 581.5;
- the divider under the tagline runs x 59.5–554.5, its lower edge 560.5pt
  down, centred ten points right of the page (like the tagline);
- the bottom-right ornament's first grey is 592pt down.

The lead photograph takes the whole field below the lockup, from 590pt down to
the trim between the borders, so the ornament lies under it rather than beside
it. It fills the band and is clipped to it, and a gold hairline closes its top.
The address is set between the divider and the band in ivory capitals, because
a photograph on a cover should say which property it shows. Ivory, not gold:
REPORT_RULES §2 forbids a saturated accent below 10pt.

Two things only a render found:

- **The template's box does not start at zero.** Its MediaBox is
  [0 7.83 595.5 850.08], so a band placed against a 0–842 page sat 7pt low and
  left the ornament's tip standing above the photograph. Every vertical
  measurement is taken from the sheet's visible top edge and placed against
  the page's own box.
- **The ornament overlaps the right border.** From 592pt down the border's gold
  starts at 586.5, not 581.5, so a photograph covering the ornament to 581.5
  left a five-point sliver of it beside the band. The border's own gold (flat
  across its width, graded down its height, both sampled) is drawn back over it.

Without a photograph the cover is the page it always was.

### Whose cover it is

That cover is **NPC's artwork**: the monogram over NAIDU PROPERTY CONSULTING
SERVICES · YOUR DEDICATED PROPERTY PARTNER. Nothing chose it per deployment, so
until 25 Sep 2026 every clone's standard document opened on another business's
name. The file also said `NPC Services` wrote it and `NPC Command Centre` made
it. The closing page already resolved its issuer through
`issuerIdentity.pure.ts`; the cover, the first page a reader sees, never asked.

The rule (`standardCover.pure.ts`): **the artwork opens NPC's document on NPC's
deployment, and nothing else.** Both conditions matter, because each alone has
a case it gets wrong:

- a clone seeded from the prime's settings holds NPC's name in its rows. It must
  still not print NPC's artwork, so the prime is recognised by the backend it
  talks to (`isPrimeDeployment`), never by a name a row can hold;
- the prime renamed on its Branding or Report Settings page is issuing as
  somebody else, and a cover that ignored that would not be white-labelled.

Every other document opens on a cover drawn for its issuer
(`investmentPdfCover.ts`):

- **Name and mark.** The issuer's name in serif capitals, and its knockout mark
  from the Branding page, because the cover is a dark ground.
- **Title.** The document's title under the name.
- **Photograph and address.** The divider, address and photograph band sit
  exactly where the artwork cover has them, so the photograph lands in the same
  place on either cover. Without a photograph, the document's one-line
  standfirst takes the band's place.
- **Colour.** The issuer's brand family (`brandFamily.pure.ts`): its brand
  colour on the dark field, in the shade that clears the print floor, and the
  same family on the closing page, so the first and last pages are a pair. An
  issuer with no brand colour prints in Aurixa's platform gold on obsidian.

The issuer is resolved once, from the resolver every surface uses: the report
contact's company name, then the Branding page's name, then the platform. An
unbranded clone therefore issues as Aurixa Systems, with the platform's emblem
and the platform's own disclaimer. It never prints a stored disclaimer written
by nobody, which the closing page did until this change.

**Nothing of the artwork is carried into another issuer's file.** Such a
document starts from an empty PDF and copies only the content page. Drawing
over the artwork would still leave NPC's name and monogram in the file, where
a text search or a screen reader finds them. The file's author, creator and
producer name the issuer.

The prime's own document was checked before and after the change: same size to
the byte, same text and metadata, and all four pages pixel-identical. The only
differing bytes are the timestamps.

### The plan

One sheet a plan, after the contents and before the report's first page,
matching the templates. The sheet uses the body's own section heading (gold
bar, navy title, gold rule), the address beneath it, the plan whole in the room
left, and the same title block at the foot. It is embedded before the page is
added, so a plan that will not embed costs no page. It is not listed in the
contents, which numbers the report's sections.

### Verified locally

- `standardPresentationPictures.spec.ts` draws the real document through
  `generateInvestmentPdfBlob` and reads it back with pdf.js: with no pictures it
  is the same document; a photograph adds one image to the cover, and the
  address, and nothing else changes; each plan adds one sheet in the right
  place; a picture that will not embed costs nothing. Disabling either feature
  fails three of its tests.
- The owner's facade render and plan drawn through it, and every edge of the
  band looked at at 600 dpi.

- The white-label cover, drawn for a tenant with a mark and a photograph, a
  tenant with neither, an unbranded clone (with and without a photograph) and
  a long name on a Snapshot, and each looked at. `standardCover.spec.ts` holds
  the decision, the name setting and the layout; the pictures spec reads the
  file back and finds none of the artwork's faces or its 640 × 512 monogram in a
  clone's document. Forcing the artwork everywhere fails ten tests.

### Not verified

- **Not yet drawn from a real report in the browser.** It needs a report whose
  folder holds a photograph and a plan, which needs §8's filing live. PENDING.
- **Not yet seen on a real clone.** The white-label cover reads the clone's own
  `whitelabel_settings` and `global_report_settings`; no clone has drawn one
  yet. PENDING.
- **A tenant's colour has been drawn from fixtures only.** Since 26 Sep 2026
  the cover, the body and the closing page take the issuer's brand family
  rather than the house pair (`WHITE_LABEL_DOCUMENTS.md` §4). A teal and no
  colour at all were drawn and looked at; every other colour is held to the
  print floors by `brandFamily.spec.ts`, not by a render. No clone's own colour
  has been drawn. PENDING, with the clone renders above.
