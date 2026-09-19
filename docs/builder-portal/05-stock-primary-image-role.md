# Builder Stock — the primary image, and why provenance was never enough

Read this before touching anything that decides which picture a Builder Stock
card shows: `sourceImageRole.pure.ts`, `pdfPrimaryImage.pure.ts`,
`pdfPageImages.pure.ts`, `primaryImage.ts`, or `primaryStockImage` in
`src/lib/builderStock.ts`.

## The rule

A Builder Stock card may show **the image the builder's source designated as
this property's primary image**, or no image at all. Two facts are needed and
they are independent:

| | proves | established by |
|---|---|---|
| **Source provenance** | these exact bytes came out of the builder's source | `source_sha256` / `stored_sha256`, `sourceImages.ts` |
| **Image role** | the source presented these bytes as THIS property's listing image | `role`, `role_evidence`, `sourceImageRole.pure.ts` |

Only `role = primary_property` may reach `primary_image_id`. `unknown` never
can, and neither can `interior`, `floorplan`, `site_plan`, `masterplan`,
`location_map`, `materials`, `logo_decorative` or `property_secondary`.
`google_maps` and `internet_search` rows are still written as provenance and are
never displayable.

## What went wrong

Lot 537 Kirramingly Avenue, Donnybrook showed a **bedroom** on its Marketplace
card, badged "Builder supplied". Every claim behind that badge was true — the
bytes were lifted out of the builder's own 20-page contract PDF, hashed at both
ends and stored. The badge was still false to a reader, because the source
presented that image as an inclusions illustration on its **third** page, and
presented the property with a facade render on its **package cover**.

Two independent defects put it there.

**1. The document's page order was never established.** The contract's page tree
(`/Pages`, object 1098) lives in a Flate-compressed **object stream**.
`indexPdfObjects` scanned raw bytes for `N 0 obj`, so that object did not exist
for it, the catalogue resolved to nothing, and `pageObjectsInOrder` fell through
to its last resort: every `/Type /Page` sorted by **object number**. The cover
page was added by a later incremental update and numbered **1105** against
1…229, so it sorted **last of twenty** — past the twelve pages a document is
searched, meaning the cover was never read at all — and shifted every other page
up by one. The image drawn on visible page 3 was recorded, and shown to a
person, as `page 2`.

**2. The primary was chosen by measurement.** Among the pages it did reach,
`selectPropertyPhotographFrom` took the largest photographic raster by drawn
area. On the inclusions page that is a 2202×1229 bedroom across a full bleed.
On the cover it would have taken the 1950×1050 grey faceted **wash** over the
960×497 facade beside it: bigger, ample encoded detail, ordinary aspect, and not
a house.

Both were invisible because nothing in the pipeline ever asked what an image
**was**. `source_stage = uploaded_document` was read as permission to display.

## The architecture

**A. Asset discovery** — `pdfPageImages.pure.ts` /
`pdfSourcePhoto.discoverPdfSourceAssets`, `documentAnchors.pure.ts`,
`notionRecordMap.pure.ts`, `htmlSource.pure.ts`. Finds every asset the source
supplied. Size, encoding, aspect and page-area floors live here and may only
**reject** — a 1×1 pixel is not a photograph. A raster the document draws more
than once, on its page or across pages, is furniture and is dropped.

**B. Property attribution** — `sourceAssets.attributeDocumentMedia`,
`pdfRowAnchors.pure.ts`. Which property an asset belongs to, from the source's
own statement of it and never from counts or ordering.

**C. Image role** — `sourceImageRole.pure.ts`. What the source presented the
asset as, from the vocabulary the source itself used.

**D. Primary selection** — `pdfPrimaryImage.assignPdfMediaRoles`,
`sourceAssets.settleRowAssetRoles` / `settleContainerMediaRoles`. At most one
`primary_property` per property, and only on evidence:

- **LEVEL 1 — explicit property-image field.** A `Facade` / `Property Image` /
  `image_url` column, a Notion file property named as one. `roleFromExplicitField`.
- **LEVEL 2 — property cover / package hero.** A page stating this property's
  **identity** together with at least two **package facts** (a price, a contract
  or package heading, a land/build size, a bed-bath-car configuration, a title
  date, a lot dimension) and presenting one prominent property image with them.
  `findPropertyCoverPages` + `selectCoverHero`.
- **LEVEL 3 — structural container.** A Notion row's own `page_cover`, an HTML
  property card's single hero, a spreadsheet/DOCX/PPTX container holding exactly
  one candidate. `roleFromStructuralContainer`.
- **LEVEL 4 — ambiguous.** Several photographs and no statement of which is the
  property's. **No primary image.**

## Rules that bite

- **A filename may demote and never promote.** `Masterplan.png` is not a house
  whatever page it is on; `6.png` and `Facade.png` are both live names of
  verified facade renders and neither says which property it belongs to.
- **A repeated raster is never a hero.** It is how a bleed wash, a banner and a
  letterhead announce themselves, and it is the only judgement a raster's
  placement is entitled to make.
- **A page number shown to a person is 1-based and is the page they see.** It is
  only entitled to be shown when `pageOrderIsAuthoritative` is true; where the
  page tree could not be followed, nothing is anchored and nothing is primary.
- **`PROVENANCE_VERSION` is 3.** Versions 1 and 2 recorded origin and no role, so
  every row written before this is `unknown` and not displayable until
  `reprocess_source_images` re-derives it. That is the repair, not a regression.
- **The repair changes images only.** No stock item is created, no price,
  availability, configuration, builder link or client selection is touched.

## Getting the picture onto the card, automatically

The rules above say which picture a card may show. This says who runs them, and
it is the half that was missing: Lot 537's card read "No image found" while the
correct facade sat in the builder's PDF and the extractor could name it byte for
byte. The only thing that could put it on the card was the Builder Portal's
"Source images" button, so normal operation depended on a maintenance tool.

**The import settles the pointer.** `importStockRecords` now calls
`chooseAndStorePrimaryImage` for every property it touched. `primary_image_id`
used to be written only by `enrichStockItem` — the stage-2/3 *provider* loop —
so a property's own builder-supplied picture reached its card as a side effect
of going out to Google and Perplexity for pictures it did not need. Storing an
image nobody points at is the same as not storing it.

**An import re-queues what it touched.** `enrich_images` selects
`enrichment_status in ('pending','enriching')` and an import never wrote that
column, so re-importing a source updated the property, attached a better image
and left the pointer alone. Worse, `failed` was terminal: every property became
`failed` the moment the role rule shipped, and nothing automatic ever looked at
one again. An import now puts its properties back to `pending`. This is image
pipeline state, not property data.

**Stage 1 is a step of the automatic loop.** `enrich_images` settles the
builder's own imagery before it goes anywhere near a provider, using the same
`repairSourceImagesForUpload` the manual repair uses, under the same wall-clock
budget, and reports it in `remaining` so the browser's existing loop keeps
asking. The builder sees *Processing supplied images* between *Reading the
properties* and *Finding images*.

**`source_images_settled_version` is the terminal marker.** An upload below
`PROVENANCE_VERSION` has one pass of work outstanding; an upload at it has none,
however few images it ended up with. Without a marker the only available test is
"has properties with no picture", which is true for ever of a spreadsheet that
carries no imagery — so every pass would re-read every source and no loop would
converge. Only a *complete* pass writes it.

**Existing stock repairs itself once.** `builder-stock-image-settler` is an
internal-only function (signed envelope, `verifyInternal`) that pg_cron drives
every five minutes until no upload is outstanding, then **unschedules its own
job**. It is a deployment repair, not a service. It reuses the same repair and
the same `enforceStrictPrimaryImages`; no stock item is created, and no property
field is written.

**Marketplace reads stay reads.** `list_stock` and `get_stock_item` never
extract, fetch or repair. `STOCK_IMAGE_SELECT` already carries `source_detail`,
which is where the role lives, so the strict display rule resolves from the
payload the marketplace already sends.

One more thing bites. A reference is `page{n}:{name}#{objectNumber}`, and the
object number is not decoration: a resource name means whatever the resources
that drew it say it means, so `/Im0` in one form and `/Im0` in another are two
different pictures on the same page. The reference is both the storage key and
the upsert key, so naming both `page3:Im0` made them one row and silently lost a
discovered asset.
