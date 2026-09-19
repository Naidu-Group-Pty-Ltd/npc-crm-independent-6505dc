# NPC Email 1 — intake scenario audit

**Scenario** `NPC Email 1` (Make id `6720116`, team `528268`, folder `438062`)
**Writes to** Airtable base `NPC Emails` (`apptyShYE0yzL4IGB`) — tables `Property Intake Master`
(`tblWIg5cs85O30pcY`), `Properties` (`tblH9cW4EhVs6D5H1`), `Emails` (`tbltAY2t8eiaMzOXs`)
**Read by** the dashboard's Listings page, via `airtable-proxy` / `listings-cache` →
`airtableListing.pure.ts`

This is the pipeline that turns an agent's email into a row on the Listings page. It has
62 modules across four branches of one router, and it is currently **switched off** and
flagged `isinvalid` by Make. This document is why.

> **The live scenario is `NPC Email 1 New` (`9618493`), not this one.** It carries these
> fixes and is on a 15-minute schedule. One of them, F7 — provenance from the trigger
> rather than the model — turned out to be right about *where* to read the sender and wrong
> about *which* sender, once listings began arriving forwarded by NPC staff instead of sent
> by agents. See [`FORWARDED_SENDER.md`](./FORWARDED_SENDER.md).

---

## The short version

The scenario reads a mailbox and fans out over four branches: **document attachments**,
**email body**, **image attachments**, and **URLs found in the body**. Three of the four
were writing somewhere other than where the dashboard reads, or not writing at all.

The one number that captures it: **all four attachment columns on Property Intake Master
were empty on all 1,441 records**, and so was every image column. The Listings page has
never had a photograph from this pipeline. Two independent defects caused that, and
neither of them failed loudly.

| | Before | After |
|---|---|---|
| PDF attachments land in | `Properties` (legacy, ~20 columns) | `Property Intake Master` (~120 columns) |
| Image attachments land in | `Properties` | `Property Intake Master`, with the photo attached |
| `image/jpeg` attachments | silently dropped | processed |
| Web-scrape branch | fed the model an empty string | markdown + links, AU egress, 1-hour cache |
| Images captured | none, ever | URL set + hero + count + source + capture time |
| Duplicate matching | unescaped free-text address formula | exact `Intake Content Hash` |
| "Already have this one" | wrote two empty fields | stamps last-seen, price and status snapshots |
| Error rows | `"Error 500"` into the wrong table | typed `Error Record` with a reason |
| Select writes | `typecast: false` (bundle fails on a new option) | `typecast: true` |

22 findings, all fixed in `blueprints/npc-email-1.upgraded.json`.

---

## Findings

Each is keyed to the identifier used in `blueprints/apply-upgrades.py`, which is the script
that applies them.

### The two reasons there were never any photographs

**F18 — `image/jpeg` attachments were silently discarded.** Module 23's filter tested

```json
{"a": "{{7.contentType}}", "b": "jpeg", "o": "text:equal"}
```

`text:equal`, case-sensitive, against the whole MIME type. `image/jpeg` is not equal to
`jpeg`, so the condition never matched. The two sibling conditions tested `contains "png"`
and `contains "jpg"` — and `image/jpeg` does not contain the substring `jpg` either. **PNG
was the only image format that ever entered the branch.** JPEG is what cameras, phones and
every agency CRM emit.
*Fixed:* any `image/*` MIME type, plus a filename-extension fallback covering
jpg/jpeg/png/webp/gif/heic, for the senders that mislabel attachments as
`application/octet-stream`.

**F13 — the web scraper asked for HTML and read markdown.** Module 94 (Firecrawl) was
configured `"formats": ["html"]`; module 98 consumed `{{94.data.markdown}}`. Firecrawl only
returns the formats you ask for, so the model was handed an empty string on every single
run and dutifully returned an empty listing set.
*Fixed:* `["markdown", "links"]`. Three related settings moved with it — `maxAge` from 2
days to the module's 1-hour floor (a 2-day cache is the wrong default when the point of the
pass is *fresh photographs*), `location.country` from `US` to `AU` (these are Australian
portals), and `onlyMainContent` off so galleries are not stripped as chrome.

**F15 compounded both.** Module 100 fed on `{{99.extras}}`. No prompt in the scenario has
ever emitted a top-level `extras` key — the schema puts `extras` *inside* each listing. The
feeder therefore produced zero bundles, and every module downstream of it in the scrape
branch was unreachable. *Fixed:* `{{99.listings}}`.

**F14 — the scrape extractor never asked for images.** Module 98 was running the
*PDF availability-sheet* prompt against a scraped web page: a ~20-key schema built for
tabular stock lists, with no notion of a gallery.
*Fixed:* a listing-page prompt whose first-class output is an ordered `listing_images`
array, with explicit rules — property photography only (no agent headshots, agency logos,
map tiles or tracking pixels), absolute https only, hero first, floorplans routed to
`floorplan_url`, capped at 20.

**F16 — and nothing wrote the result anyway.** Module 97, the enrichment write-back, set
exactly two fields: `Assignee` and `Reviewed By`, both to `{}`. It updated nothing.
*Fixed:* it now writes the image set (`Listing Image URLs`, `Primary Image URL`,
`Image Count`, `Image Source`, `Images Captured At`), the scraped copy, refreshed agent and
inspection details, and a price/status snapshot.

### Records written to the wrong table

**F3 / F19 — the PDF and image branches wrote to `Properties`, not `Property Intake
Master`.** Modules 28 and 25 targeted `tblH9cW4EhVs6D5H1`. The dashboard does not read that
table. `Properties` has ~28 columns against Property Intake Master's 205, so even the rows
that arrived were a fraction of what the extractor produced.
*Fixed:* both retargeted, both mapped across ~120 columns.

**F19 also fixes a subtler one.** Module 25 read `{{26.*}}` — the *parsed JSON root* —
while its feeder was module 52. Every row of a multi-row screenshot therefore received the
same values, read off the wrong level of the object, which resolve to empty. A screenshot
of a ten-row availability table produced ten identical blank records. *Fixed:* reads
`{{52.*}}`, the per-listing feeder.

**F2 — the PDF branch also ran a stale prompt.** Module 21 carried a legacy ~20-key schema
while module 36 (email body) ran `npc_property_master_v2_single_table` with the full
205-column shape. *Fixed:* one prompt, both branches.

### Data the model was asked to invent

**F7 — provenance came from the language model.** Module 38 mapped `Sender Email` from
`{{113.sender_email}}` — i.e. it asked the extractor, which sees only a 6,000-character
chunk of body text, to report the sender's address. Same for `Sender Name`,
`Email Received At`, `Email Web Link` and `Source Attachment Name`. A model cannot know
these; it can only guess plausibly, which is worse than leaving them empty.
*Fixed:* all sixteen provenance fields now map from the trigger — `{{1.from.emailAddress.address}}`,
`{{1.receivedDateTime}}`, `{{1.internetMessageId}}`, `{{1.conversationId}}`, `{{1.webLink}}`
and so on — plus `Scenario Run ID` and `Extraction Batch ID` from `{{executionId}}`.

**F7 also fixes the address.** `Address` was mapped from `{{113.normalized_address}}`, and
so was `Normalized Address`. The address the source actually printed was extracted, then
dropped on the floor. *Fixed:* `Address` ← `address`, `Normalized Address` ←
`normalized_address`.

**F22 — `property_features` was an open write into a closed column.** `Property Features`
is a curated 26-choice multi-select. With `typecast: true` (see F4) an unconstrained model
output would create a new option for every phrasing it invented, turning a filterable
column into a junk drawer within a week. *Fixed:* the vocabulary is now closed in the
prompt itself, with anything unmatched routed to `property_description`. `Tags` — an
internal triage taxonomy — was removed from model-driven writes entirely.

The same edit gives all three extraction prompts explicit `listing_images` rules; the key
was declared in the schema and never explained, so it came back `[]` every time.

### Duplicate detection

**F5 / F10 — four searches compared unescaped free text.** Modules 71, 82, 92 and 128 built
Airtable formulas by interpolation:

```
(Address) = "{{107.address}}"
```

Two problems. An apostrophe or a quote in an address breaks the formula outright — and
`O'Connor Street`, `St Leonards` and `D'Arcy Road` are ordinary Australian addresses. And
matching raw address text means the same property fails to match itself when it arrives as
`12 Smith St` one week and `12 Smith Street` the next, which is exactly what the
normalisation step upstream exists to prevent.
*Fixed:* a new `Intake Content Hash` column carries a composite key —
`normalized_address|suburb|postcode|project|lot`, lower-cased and trimmed — built the same
way at write time and at search time. Readable in Airtable, exact to compare, stable across
street-type variation.

**F11 — the "we already have this one" branches did nothing.** Modules 65, 83, 104 each set
`Assignee` and `Reviewed By` to `{}` and nothing else. A listing seen five times looked
identical to one seen once: no last-seen date, no price history, no status change.
*Fixed:* they now stamp `Last Seen At`, `Last Updated From Source`, `Duplicate Status`,
`Change Type`, `Change Summary`, and price/status snapshots. Module 83 additionally writes
the full geocode result.

**F12 — two "create if different" modules could not have worked.** Modules 72 and 105 wrote
records into `Property Intake Master` using three field IDs — `fldKpx9kYu4aeYP9N`,
`fldQmBFiHemnozT1T`, `fldx96rScPizG9Brh` — that belong to the **Emails** table. Those
columns do not exist on the intake table; the modules would hard-error on every execution.
This is a large part of why Make flags the scenario `isinvalid`.
*Fixed:* both write real listings.

### Error handling

**F9 / F9b / F17 — five modules wrote the literal string `"Error 500"`.** Modules 75, 96,
119 and 122 wrote it (or `"No URL"`) into `Emails.Status`, some of them while targeting the
intake table with Emails field IDs — the same class of defect as F12. Module 96 did it on
the *success* path of the scrape.
*Fixed:* typed `Error Record` rows on Property Intake Master carrying `Error Type`,
`Error Message`, `Last Error Module`, `Review Reason` and the listing that failed, so a
failure is triageable instead of being a three-digit number on an unrelated row.

**F20 — the image-branch failure filter tested a key that does not exist.** Module 49
filtered on `{{26.listing[]}}`. The key is `listings`. The branch never fired, so image
extraction failures were invisible. *Fixed.*

**F4 — `typecast: false` on every select write.** Airtable rejects a write to a
single-select whose option does not exist, and the failure takes the whole bundle with it —
so one unfamiliar `Property Type` string discarded an entire email's worth of listings.
*Fixed:* `typecast: true` on all intake writes, paired with F22's closed vocabularies so
typecast cannot be abused.

**F8 — the invalid-JSON branch updated the wrong table by the wrong id.** Module 51 updated
`Property Intake Master` using `{{2.id}}` — an *Emails* record id — and set nothing.
*Fixed:* it records the failure and the raw model output on the Emails row it actually owns.

### Enrichment left on the floor

**F6 — geocoding wrote back one field.** Modules 124 and 81 call Google Maps and get back
`geometry.location.lat`, `geometry.location.lng`, `formatted_address`, `place_id` and
`urlMap`. Modules 129 and 83 wrote **`Postcode`**. Latitude and longitude — which the map
view needs and which the dashboard otherwise pays a separate geocoding pass to recover —
were fetched and discarded on every run.
*Fixed:* lat/long, Google Maps link, geocoded full address, locality and street parts,
`Geocoding Status` and `Enriched Fields`.

**F1 — the document filter missed spreadsheets.** Module 22 admitted `pdf` and `doc` only.
Developer stock lists routinely arrive as `.xlsx` or `.csv`.
*Fixed:* `sheet`, `excel` and `csv` added.

**F21 — the URL branch was fetching tracking pixels.** Module 13 regex-matched every URL in
the email body; module 17 then issued a plain HTTP GET against each one. That includes
one-click unsubscribe links, open-tracking beacons and CDN assets — so the scenario was
firing unsubscribes on the agency lists it was reading, and burning operations on 1×1 GIFs.
The result was then handed to a model prompted for a *"clear breakdown of the business"*
and the prose was dropped into a notes column.
*Fixed:* a filter excludes unsubscribe/opt-out/list-manage/tracking/beacon/pixel URLs and
static assets; the model returns structured JSON; the URLs actually followed are recorded.

---

## Airtable changes

Six columns added to `Property Intake Master` (live):

| Column | Type | Why |
|---|---|---|
| `Listing Image URLs` | Long text | Newline-separated source URLs, newest-first. Attachment URLs expire within hours and portal hotlinks rot, so the dashboard copies the bytes into its own bucket and renders from there — these are *candidates*, not storage. |
| `Images Captured At` | Date/time | The freshness signal. `Created Time` says when the record arrived, which is a different question: a January record can have August photographs. |
| `Primary Image URL` | URL | The hero shot, lifted out of the list so a card or report cover reads one value. |
| `Image Count` | Number | Zero is meaningful — it separates "we looked and found none" from "we never looked". |
| `Image Source` | Single select | Email Attachment / Web Scrape / Portal Listing / Agency Website / Google Street View / Manual / None Found. Ranked in the dashboard. |
| `Intake Content Hash` | Single line text | The duplicate key (F5/F10). |

Also live: automation **`Delete Property Intake Records After 30 Days`**
(`wfljwe75Zqv5u8uCx`) — see [`AIRTABLE_RETENTION.md`](./AIRTABLE_RETENTION.md).

---

## Applying the Make changes

The upgraded blueprint is **not** live. Make's API takes a blueprint as an inline request
parameter and this one is 839 KB, past what that path will carry, so it ships as a file to
import:

1. Open the scenario → **⋯** → **Import Blueprint**
2. Choose `docs/integrations/blueprints/npc-email-1.upgraded.json`
3. Re-select connections if Make prompts (connection ids are preserved, but imports
   sometimes ask)
4. Run once against a test email before switching the schedule on

`npc-email-1.original.json` is the pre-change blueprint — import it to roll back.
`apply-upgrades.py` regenerates the upgraded file from the original, so the same edits can
be re-applied if the scenario is changed in the UI first:

```
python3 docs/integrations/blueprints/apply-upgrades.py
```

### Verify after import

- Send a test email with a **JPEG** attached — F18's fix is the one most worth confirming.
- Send one with a `realestate.com.au` or `domain.com.au` link and check `Listing Image URLs`
  fills and `Images Captured At` stamps.
- Confirm new rows land in **Property Intake Master**, not `Properties`.
- Send the same listing twice; the second should update `Last Seen At` rather than create
  a duplicate.

---

## What the dashboard does with this

`airtableListing.pure.ts#resolveListingImages` reads `Listing Images` *and*
`Listing Image URLs`, orders them best-source-first with floor plans pushed to the back,
and exposes them as `imageCandidates`. `useListingImages` harvests that set and sends
`Images Captured At` alongside, which drives how soon a set is re-verified — a gallery
re-scraped yesterday belongs on the daily tier even when the record itself is a year old.

Dashboard-side defects fixed in the same pass, all of which would have wasted the upstream
work:

- **The resolve endpoint discarded candidate origins.** It called
  `normaliseImageCandidates(payload, 'airtable')` over candidates the client had already
  classified, relabelling a Street View fallback as an agent's own photograph. Origin
  ranking — the thing that decides which shot leads a card — was a no-op on the only path
  that renders. A listing geocoded before it was photographed kept a picture of the kerb as
  its hero forever.
- **The cron sweep used `??` between the attachment columns**, taking the first non-nullish
  rather than the union, so a record carrying both would have lost half its photos.

### Who may say a photograph is gone

The one that matters most, because it empties galleries rather than degrading them.

`harvestListing` **reconciles**: anything absent from the candidate list it is handed is
marked `gone`, and `signStoredImages` renders only `stored` rows. The library has several
contributors and none of them sees the same set — `listing-enrichment` scrapes the agency's
listing page, intake writes what it captured into `Listing Image URLs`, the browser reads
Airtable. A caller holding a partial view that is allowed to reconcile silently empties the
gallery.

That happened twice:

- **The hourly sweep, and this predates the intake work.** It reads Airtable's image
  columns, which were empty on every record, so it computed the fingerprint of `[]`, found
  it differed from the one enrichment had written, and reconciled against nothing —
  retiring every scraped photograph on whatever schedule `refresh_after` came round. It
  reported success the whole time.
- **The browser, as a direct result of this change.** `resolve` used to bail before
  harvesting because the attachment columns were empty, so it only *signed* what was
  stored — which is the sole reason the page had photographs at all. The moment intake
  began filling `Listing Image URLs`, that same code path began reconciling against the
  Airtable subset and retiring the scraped gallery **on page load**.

Retirement is now opt-in, in `_shared/listingImageReconcile.pure.ts`:

- `full` — for a caller that saw the whole gallery. `op:'harvest'` from `listing-enrichment`,
  and nobody else.
- `additive` — the default. Contribute photographs, take a place in the merged ordering,
  never remove.
- An **empty candidate set never retires anything, in either mode**. "I found nothing" is
  not "there is nothing", and conflating the two is what turned a quiet upstream into a
  blank card.

### Why one photograph became nine rows

Retirement was only half of it. `imageIdentity` drops the query string and its
docstring called that stable — "Airtable re-signs an attachment on every read, so
the same photo arrives with a different `?ts=…&sig=…` each time … The path alone is
stable." It is not. An Airtable attachment URL is

```
https://v5.airtableusercontent.com/v3/u/56/56/<epoch-ms>/<sig>/<sig>
```

and the expiry and signature are in the **path**. Every read of an unchanged
attachment produced a brand-new identity, so the harvest filed another row for a
photograph it already held — and then retired the copy from the previous pass.
One listing carried the same photo under nine URLs recorded two hours apart, all
with one checksum.

Over a single day that produced 7,524 rows representing 4,152 distinct
photographs, 4,076 of them `gone`, and 708 photographs across 67 listings left
with no stored row at all.

The bytes are the only thing that does not change between passes, so they settle
identity: `harvestListing` now adopts the row already holding a checksum rather
than inserting a second one. The accumulated damage is repaired by
`supabase/migrations/20260828000000_listing_image_duplicate_repair.sql`, which
restored 699 photographs and took the average gallery from 7.9 to 9.5.

Two consequences worth knowing:

- **Ordering merges rather than displaces.** Three URLs arriving from Airtable do not push
  a twelve-shot scraped gallery down to positions 3–14; they take their place within it,
  ranked by origin (`airtable` → `listing_url` → `scraped` → `street_view`) and then by
  each source's own order. `Listing Image URLs` is classified `listing_url` rather than
  `scraped` precisely so it can be told apart from what enrichment harvests.
- **The due check is identity-based, not fingerprint-based.**
  `listing_image_sets.fingerprint` holds whatever the last pass wrote, so a browser
  comparing an Airtable-derived fingerprint against enrichment's never matched and every
  listing looked due on every page load. The question actually being asked is "am I
  offering a photograph that is not already stored", and that is now what gets asked. Only
  a `full` pass writes the fingerprint.
