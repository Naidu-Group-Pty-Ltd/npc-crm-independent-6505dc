# 50 · A builder property has a page, and brings its photographs and documents

## 1. What was missing

- A Builder Stock card had no click. A stock pin on the map sent the reader to the tab, not to the property.
- `get_stock_item` existed, and nothing called it.
- The network sent each property with one `primary_image` and no documents. So even a page would have had nothing more to show than the card.

## 2. The page

`/listings/builder-stock/:stockItemId` (`src/pages/BuilderStockProperty.tsx`), behind the Listings module.

- **Ways in:** the card's picture and title, a stock pin on the map, and a pasted link. There is one spelling of the address: `builderStockPropertyPath`.
- **What it reads:** `get_stock_item`. That returns the same decorated record the card is drawn from, plus the property's photographs, its documents and its activation record.
- **What it shows:**
  - price, lot, address, locality, estate and design;
  - bedrooms, bathrooms and car spaces;
  - home and land size;
  - completion or titles, and the builder's reference;
  - the description, the builder and availability;
  - the activation history: status, who activated it, and when;
  - where the data comes from.
- **Clients:** a client is named only where the Clients module admits the reader, which is the gate `list_selections` already applies. The internal note never leaves the server on this path.
- **Activate:** the page uses the card's own dialog and the same `select_for_client` operation. Nothing about activation changed.
- **No model:** nothing on the page is written by a model. A spec asserts that the page names no provider.

## 3. The gallery

`BuilderStockGallery`, over `galleryPictures` (`src/lib/builderStockGallery.ts`).

- **Which pictures:** the photographs the network sent, in the order it sent them, at most twelve. The Command Centre elects nothing. Which pictures are a property's photographs is the Builder Portal's decision.
- **Before media has arrived:** the card's own picture stands in, so the page never shows less than the card.
- **How each picture is drawn:** by `StockPicture`, the card's treatment.
- **One picture:** exactly one picture, with no arrows, no thumbnail strip and no second copy.
- **Two or more:** a counter, previous and next (these wrap), a thumbnail strip, and arrow keys.

Today almost every property has one photograph (see aurixa-builders `docs/builder-portal/58-…` §4), so the one-picture case is the one a client sees.

## 4. How media converges

The network adds a versioned `media` block to the same signed `stock.item.upserted` event: `{ schema_version: 1, photos: [{id, position, content_type}], documents: [{id, kind, label, url}] }`.

`builder_network_apply_inbound_events`, the main sweep, is unchanged. It ignores the new key.

`builder_network_apply_stock_media` converges the block in a sweep of its own. It follows the shape the ranking converger set: its own stamp on the event (`media_applied_at`), its own cron job (`builder-network-media-apply-1min`), and its own tables (`builder_network_stock_item_photos`, `…_documents`, `…_media`). All of them are service-role only.

Four rules:

- **The property comes first.** The sweep reads an event only after the main sweep has consumed it. It re-checks ownership at apply time: the connection's mapped builder, the payload's builder and the mirror row's builder must be one and the same. A signed event is not proof of ownership.
- **Each block states the current media, and is not added to a log.** A block is the whole set. What it names is upserted in the order given, and what it does not name is deleted. So reorder, replace, remove and replay all converge to the same rows. `media_version` (the event's `source_version`) stops an older block from winding the gallery back.
- **No block is not the same as an empty block.** Events composed before this carry none. Those are stamped `no_media` and change nothing. The migration settles the historical ones the same way.
- **A media failure never reaches the property.**
  - A malformed block is refused whole and reported (`builder_network_media_refused`).
  - An apply that throws is retried on the next tick. After five attempts it is dead-lettered with a critical `builder_network_media_apply_dead` event, which is the main sweep's own bound.
  - Nothing in the sweep writes the property row or the card's image table.

Photographs are served the way the card's primary already is: through the network's own image door, which re-checks on every request that the image is one the builder currently publishes. No storage path crosses the network, and nothing new is made public.

## 5. Proof

| Spec | What it proves |
| --- | --- |
| `builderStockMediaConverger.spec.ts` | Runs the real network migrations, main sweep included, against a throwaway Postgres. Covers 0, 1, several and 12 photographs; a 13th refused whole; replay with no duplicates; reorder, removal and replacement; a stale event; media waiting for the property; another builder's property; a revoked connection; an old payload with no media; an unknown version; the card's primary unchanged; documents independent of photographs; a `javascript:` link refused; bounded retry then dead-letter with the property untouched; and grants. It refuses to skip in CI. |
| `builderStockPropertyDetailRead.spec.ts` | The read's projection, the Clients gate, and the organisation pin on every media read. |
| `builderStockGallery.spec.tsx`, `builderStockPropertyPage.spec.tsx` | The gallery at every count, the route, the ways in, and what the page states. |

## 6. A diagnostic never breaks the sweep

The first production proof (25 Sep 2026) found that the Command Centre's `record_portal_operational_event` throws on ordinary metadata. Its privacy screen `$.**.keyvalue()` walks into every scalar, and `.keyvalue()` refuses anything that is not an object.

With that recorder, the media sweep's refusal was rolled back and retried instead of being stamped once. On the fifth attempt, its dead-letter path would have aborted the whole sweep.

`20261221100000` routes both diagnostics through `builder_network_media_note`, which turns a recorder failure into a database WARNING. The stamp on the event, which is the durable record, always stands.

The recorder's screen is a shared privacy control, so it was fixed on its own afterwards: `20261221110000` applies `.keyvalue()` to objects only and puts the same screen on the table. The wrapper stays, because a diagnostic must never be able to break the sweep, whatever the recorder does next.
