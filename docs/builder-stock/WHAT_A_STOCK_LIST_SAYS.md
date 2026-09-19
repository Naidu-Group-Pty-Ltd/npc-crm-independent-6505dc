# What a stock list says, and the three ways this read it wrong

Read this before touching `normaliseHeader` or the alias table in
`normalise.pure.ts`, the spreadsheet branch of `extract.ts`,
`attachRowHyperlinks`, or the image-queue reopen at the end of
`importStockRecords`.

## What production held

One live source: `Luxton Homes - HOUSE & LAND STOCKLIST.xlsx`, 26 active
properties, 23 uploads in the table and this the only published one. What the
marketplace served for every one of those 26:

| field | published | the spreadsheet says |
|---|---|---|
| land size | **428,000 m²** (105 acres) | 400 m² |
| price | **none** | $871,450 |
| house size | **none** | 208.11 m² |
| design | **none** | DK 22B |
| brochure | **none** | 13 of 26 carry one |
| photograph | 2 of 26 | — |

Every one of those is the same class of defect: a column heading read wrongly,
silently, at import.

## 1 — a unit marker is part of a heading, not punctuation

`normaliseHeader` removed everything that is not a letter or a digit, so
`LAND $` and `LAND M2` both became `land` — and `land` is an alias for
`land_size_sqm`. A land price of $428,000 was published as a 428,000 m² block.
The same collapse hid `HOUSE $` behind `HOUSE` and `PACKAGE $` behind
`PACKAGE`, which is why not one of the 26 carried a price.

`$` and `%` now survive as words. **No alias contained either character
before**, so a heading carrying one could only ever have been judged as though
it did not: every key this changes is a key that was wrong, and a `X $` column
the table does not name now lands visibly in `unmapped` instead of silently
becoming `X`.

Three headings become mappable as a result, and one deliberately does not:

- `PACKAGE $` → `price`. **The price is what the property costs**, which for a
  house-and-land package is the package. `LAND $` and `HOUSE $` are its
  breakdown, they have no field, and they stay in `unmapped` — a card showing
  the house component understates a $776,100 package by $405,100.
- `HOUSE m2` → `building_size_sqm`.
- `HOUSE` → `house_design`, and **`house` alone**. `Product`, `Type`,
  `Product Type` and `House Type` belong to `property_type`; a test in
  `builderStockDesignEvidence` already pins that and this must not take them.

## 2 — an uploaded workbook keeps the addresses its cells point at

`extract.ts` read an uploaded `.xlsx` with `sheet_to_json`, which returns what
a cell **displays**. A brochure column displays the word `Brochure` and carries
its address as a hyperlink, so 13 of the 26 reached the image pipeline with no
source at all — and the PDF readers, however good, had nothing to read.

The reader that does see targets has been in this repository the whole time.
`readWorkbookSheets` reads `cell.l.Target` *and* the `=HYPERLINK("…","…")`
formula, and it ran **only for a Google Sheets URL** — which fetches
`…/export?format=xlsx` to obtain a workbook an upload was already holding.

`attachRowHyperlinks` closes it. Three rules:

- A column is added only where **some kept row** carries a target, so a sheet
  with no links comes back untouched.
- The name is `"<heading> URL"`, from the one `LINK_COLUMN_SUFFIX` the Sheets
  path uses, so a builder's brochure reaches the same place whether they pasted
  a link to their sheet or dragged in the file.
- An existing key is **never overwritten**, and a row with no target gets the
  empty string rather than being skipped — every row has the same shape, and a
  missing document is a blank cell rather than an absent column.

Nothing downstream was taught anything: `DOWNLOAD URL` is not a heading this
product knows, so it lands in `unmapped`, which is exactly where
`rowSourceBranches` already reads every address.

## 3 — `enrichment_status` was never the only latch

`image_work_stage` is. A property that has been through the ladder once is left
`settled`, which the settler reads as "there is nothing further to try" — so a
re-import that handed a property a document the reader had only just learned to
see would update its price and its sizes and never look at the document.

`importStockRecords` now reopens at the `source` stage, under the link
recovery's own rule and in its own words: **reopened only where there is
something to gain**. A property that came through the import holding a
picture — its own, or one carried forward from the row it matched — is left
alone, because re-running the source stage for it would spend a claim to reach
the answer it already has.

## 4 — a shared link points at a viewer, not at a file

Capturing the link is not the same as reaching the document. Fetched as it is
written, every one of the 13 Dropbox brochures answered **207 KB of
`text/html`** — the viewer application — where the PDF behind it is **6.2 MB**.
The reader downstream does not fail on that; it succeeds at reading the wrong
thing.

`sharedLinkFileUrl` asks the host for the file, using the parameter the host
publishes for exactly that purpose (`dl=1`). **This is not a user-agent trick,
and that was measured**: Dropbox serves the file to `curl/8.5.0` and the
preview to `python-requests`, to `Mozilla/5.0`, to a Chrome string and to no
user agent at all — so dressing this client up as a browser is both dishonest
and unreliable.

It runs inside `fetchStockSource`, in front of the SSRF guard, for the reason
that function already gives about Google Sheets: *done here rather than at the
caller so that EVERY retrieval gets it*. Three rules make that safe:

- **Only a query parameter moves.** Scheme, host, port and path come back
  exactly as they arrived, so this cannot send a retrieval anywhere — the guard
  judges the address it would have judged. A test asserts it, and asserts the
  function's own source names no way to reach a different address.
- **Only a host that publishes one.** There is one entry because one was
  measured. Google Drive is absent because it never reaches here: a Drive link
  classifies as `drive_file`/`drive_folder` and `driveDownloadUrl` already
  addresses it.
- **Idempotent.** A builder who pastes the download form of their own link gets
  it back unchanged.

## Reaching rows that already exist

A stock list is read once at upload and never again, so every correction to the
readers applied only to the *next* builder's file. And re-uploading is not a
way round it: a unique index on `(organisation_id, file_sha256)` refuses the
same bytes twice — rightly — so the only route was to **delete the source and
add it again**, which discards its history and every client selection made
against its properties.

`reprocess_upload` re-reads the file already in the bucket with today's
parsers. It is the *same* `runStockImport` the first pass ran, on the *same*
bytes, so the two cannot diverge; rows are matched by the identity rule the
import already uses and updated in place. Its one precondition is that a run is
not in flight — which is the difference from `process_upload`, whose guard
exists to stop a double-click importing a file twice, where this operation's
whole purpose is to import it again.

In the portal it is **Read again**, on the source row, beside Source images.

## What this does not fix, and how the page says so

Of the 26, **13 carry no brochure link in the spreadsheet at all** — every one
of them a `DK 22A/22B/23B` design, and no document anywhere in the database
carries that design. No reader conjures a document that was never attached.
Those properties can be given a photograph only by their builder adding one.

Which is exactly why the page has to say it. "No image yet" reads as something
the product is still doing, and for those thirteen it never will be. The
property row now reads **"No brochure on this row"**, with the remedy on hover:
*add a link to its row and the photograph is read from it.*

`source_documents` carries it — how many documents this property's own row
attaches, counted server-side by `rowSourceBranches`, the same function the
image pipeline uses to decide what it will try, so the page cannot claim a
document the pipeline would not read. It is deliberately **a count and not a
list**, and it is read in `decorateItems` rather than added to
`STOCK_ITEM_SELECT`: that list is a disclosure boundary and `source_row` is the
builder's whole raw row. Saying a row attaches nothing needs no address.

## What it does, measured

Same file, same 26 rows, run through the readers end to end:

| | before | after |
|---|---|---|
| land size correct | 0 | **26** |
| price present | 0 | **26** |
| house size present | 0 | **26** |
| design present | 0 | **26** |
| reaches a builder document | 0 | **13** |
| resolves a primary image | 0 | **11** |

The last line is the whole chain, run end to end against the real file: the
uploaded workbook → the link in its `DOWNLOAD` cell → the real fetcher → the
real PDF readers → a selected image. All eleven were extracted and looked at,
and every one is that property's own facade render.

The two that do not resolve are lots 313 and 318, whose cover page presents the
facade at 480x339, the Luxton wordmark at 3423x1588 and the floor plan — and
every deterministic discriminator points at the wordmark. That is the case the
picture classifier in `IMAGE_WORKER.md` exists for.
