# Listing enrichment

Where the missing property data comes from, and why it is not where you would
first look.

## The starting position

Property Intake Master holds 1,441 records. Measured directly against the live
base:

| Field | Populated |
| --- | --- |
| `Address` | 1,233 (86%) |
| `Suburb` | 1,336 (93%) |
| `Extraction Confidence` (+5 more scores) | 1,440 (99.9%) |
| `Display Price Text` | 1,023 (71%) |
| `Price Numeric` | 773 (54%) |
| `Beds` / `Baths` / `Car Spaces` | 987 / 927 / 915 |
| `Property Description` | 839 (58%) |
| `Web Link` / `Source Web Link` | 880 (61%) / 676 (47%) |
| `Inspection Start` | 268 (19%) |
| **`Listing Images`, `Floorplan`, `Brochure`, `Additional Attachments`** | **0** |
| **`Latitude` / `Longitude`** | **0** |

The intake pipeline is a Make.com scenario in an account this workspace cannot
see. It runs one stage — read the email body, ask a model for structured fields,
write to Airtable — and stops. Its own status columns say so:
`Web Scrape Status` = "Not Required" on every record, `Enrichment Status` =
"Not Started", `Processing Stage` = "AI Parsed" and never advancing. The image,
document, geocode and duplicate branches it was designed with never run.

Since the pipeline cannot be fixed from here, the gap is closed downstream.

## What does not work: mining the stored text

The obvious cheap idea is to re-read `Raw Source Snippet`, which is populated on
1,440 of 1,441 records. **It recovers almost nothing.** Over a 120-record sample:

- Of the **60 records with no price, zero** had a dollar figure anywhere in their
  stored text.
- Of the **75 with no bedroom count, one** mentioned a bedroom.
- One record in 120 carried an image URL.

The snippets are short extracts, not email bodies — typically 100–500 characters
of marketing copy the extractor already mined. A representative one reads, in
full: *"Exclusive One-Part Contracts Almost Gone! - Act Now!! Please reach out to
your BDM for more information."*

The `mine` stage exists anyway, because it costs nothing and occasionally catches
a bare `4 2 2` spec line. It is a safety net, not the answer, and the numbers
above are why the pipeline does not stop there.

## What does work: the listing page

`Web Link` is populated on 880 records. Fetching one for **13 Larundel Road** — a
listing the dashboard displays as *"Unknown / – / – / – / Price on request"* —
returns:

- **62 property photographs**
- 6 bedrooms, 4 bathrooms, 2 car spaces
- 809 m² land
- $5,300,000

Two details decide whether that works at all:

- **Galleries hide the real photo.** The full-size images are in `data-thumb` and
  `data-fancybox` attributes; `<img src>` holds placeholders. Reading `src`
  returned two files — the agency logo and the agent's signature.
- **The images have no file extension.** They are served as
  `lh3.googleusercontent.com/d/<id>=w1200`. An extension test rejects all 62, so
  `isPropertyImageUrl` also accepts a list of known media hosts.

The same page also carries the specs, marked up semantically
(`<li class="no-of-bed">6`), which is far more reliable than looking for "6 bed"
in prose that also discusses the neighbourhood.

### The links are not all listing pages

Of 94 sampled: 63 go straight to a property page, **25 are email-tracking
redirects**, 4 are an agency homepage, 1 is a search page.

Tracking links are worth following — one resolved in a single hop to
`greatoceanproperties.com.au/8300588` — but **every hop is re-validated**. A
tracking service is an open redirector by definition, so the only URL ever
checked is the one we started with.

> Writing the tests for that caught a real hole. The first version of the host
> check ended its alternation with `$`, so `127\.` could only match a hostname
> that was *exactly* `127.` — and `127.0.0.1`, `192.168.x`, and the
> `169.254.169.254` cloud metadata endpoint all went through. Each range now has
> its own assertion in `src/lib/listingUrlPolicy.test.ts`.

A homepage or a search page is never scraped: it would attach the agency's hero
banner to a property as though it were the house.

## Shape

| Piece | Path |
| --- | --- |
| Mining, prioritisation, merge rules | `supabase/functions/_shared/listingEnrichment.pure.ts` |
| Page extraction | `supabase/functions/_shared/listingScrape.pure.ts` |
| URL classification and SSRF gate | `supabase/functions/_shared/listingUrlPolicy.pure.ts` |
| Contact resolution | `supabase/functions/_shared/listingContact.pure.ts` (browser: `src/lib/listingContact.ts`) |
| The sweep | `supabase/functions/listing-enrichment/index.ts` |
| On-demand trigger | `src/hooks/useEnrichListing.ts` |
| Schema, cron, atomic claim | `supabase/migrations/20260803162826_listing_enrichment.sql` |
| Image storage | `listing-images` `op:'harvest'` |

```
listings_cache ──▶ seed queue ──▶ claim (atomic, leased)
                                     │
                     mine ──▶ resolve_url ──▶ scrape
                                     │
                         listing_enrichment (values + provenance)
                                     │
                   listing-images op:'harvest' ──▶ private bucket
```

## Rules that are load-bearing

**Airtable wins wherever it has a value.** The overlay fills holes. The single
exception is the locality pair, and only when the record's own state and postcode
contradict each other — the one case where they are known to be wrong.

**`Address` and `Suburb` are never replaced**, disputed or not. A wrong address
propagates into deduplication, geocoding, reports and generated PDFs, with no
undo.

**A stage that found nothing never blanks a field.** Enrichment only ever adds. A
failed scrape must not erase what mining found.

**No foreign key to `listings_cache`.** Airtable prunes that table at 30 days and
the cache mirrors the deletion, so a cascade would destroy a month of accumulated
enrichment every night. The overlay deliberately outlives the mirror.

**Claiming is atomic, with a lease.** Two overlapping cron fires would otherwise
harvest the same listing twice and pay twice. (`listing-images`' own sweep does
not do this; the pattern is deliberately not copied.)

**Priority is the gap discounted by remaining life.** A 29-day-old record is about
to be pruned upstream, so enriching it buys a day of benefit.

## On demand

The sweep is the right default for 1,441 records and the wrong answer for the one
record someone is looking at. At 25 listings per ten-minute run, working
worst-first, a given listing can be hours from its turn — and the person reading
its card has no way to know whether "No photo on record" means *none exist* or
*we have not looked yet*.

So the empty state carries the remedy. `useEnrichListing` calls `op:'enrich'` for
a single listing and reports three outcomes distinctly:

| Outcome | What it says |
| --- | --- |
| Photos or fields found | `Found 3 photos` / `Filled in price, landSizeSqm` |
| Reached the page, nothing there | `Nothing new found for this listing` |
| No source link on the record | `This listing has no source link to follow` |
| Could not reach the service | Names the deploy, because that is the likely cause |

The action is only offered where `listing.url` is set — an action whose only
possible outcome is to report its own futility is worse than no action.

On success the caller re-resolves **only that listing's** images
(`useListingImages().refresh(id)`), rather than the blanket `retry()` that clears
every resolution and starts a six-request pass. The source fingerprint is
unchanged — the new bytes were harvested server-side, not written into the record
— so neither the fingerprint check nor the signed-URL expiry would have
invalidated the stale "nothing here" answer on its own; `forgetCachedImages` does
it explicitly.

Surfaces carrying the trigger: gallery card (empty frame and menu), map popup,
`/listings/:id` header, and the details modal's Images section. On the property
page it also refetches the record, because enrichment fills price, specs and
contact details, not only photographs.

## What a listing looks like with no photograph

Image coverage is genuinely incomplete and will stay that way for some records —
some listings arrive by email with nothing attached and link to a page that
publishes no gallery. So the photo-less state is not a temporary condition to
paper over; it is a permanent part of the product and has to be designed.

Three tiers, cheapest first:

1. **Stored photographs**, when the library holds them.
2. **Street View**, where the listing is geocoded. On the property page and in
   the map popup it is simply the last slide. In the gallery grid it is **behind
   a button**, and that distinction is load-bearing: `street-view` caches
   nothing and each panel costs two Google calls against a global 5,000/day
   quota, so a 48-card grid auto-loading them would spend ~96 calls per page
   view and exhaust the day in an afternoon. `ListingHero`'s `streetViewMode`
   picks which.
3. **A drawn cover** (`ListingCover`) otherwise — the map's own property-type
   glyph over a wash keyed to the price band, with the locality set where a
   photograph's subject would be.

The cover is not a fake photograph and nothing about it claims to be the
building. It exists because the alternative — a flat grey rectangle at four
cards across — makes a working page look broken, and because a reader gets more
from "house, City Beach WA, upper band" than from an empty box. The caption
still says **No photo on record** in every case.

Price bands are fixed AUD thresholds rather than corpus quantiles: a listing has
to look the same wherever it is drawn, and quantiles would re-tint every cover
whenever a filter changed the distribution. The four hues are chosen to be
*distinguishable* — the brand ramp and `warning` are both amber here, so
`success` carries the middle band.

## Seeding images without a deploy (2026-08-04)

The enrichment functions could not be deployed (no `SUPABASE_ACCESS_TOKEN`
available anywhere the code runs), so the first photographs were put through the
*deployed* pipeline instead of the waiting one:

1. `scripts/listings/seed-listing-images.mjs` scraped the newest 320 listings'
   own source pages with the repo's `listingScrape.pure.ts` — 232 pages
   reachable, **80 records seeded** after filtering pixels, headshots, homepage
   furniture, award badges and multi-property index pages.
2. The URLs were written into Airtable's **`Listing Images`** attachment field —
   which makes Airtable download and re-host the bytes itself, so link rot dies
   at the system of record.
3. The cache sync mirrors the attachments on its next 10-minute walk; the client
   hands them to the deployed `listing-images` `op:'resolve'` as harvest
   candidates; the deployed harvester stores them in the bucket and signs URLs.

No function deploy anywhere in that chain. Two client bugs had to die for it to
flow: the cache read sent the table *name* where the deployed server allowlists
only the table *id* (so every page load silently fell back to the legacy proxy —
sentinels, 889 records, no attachments), and `standardizeListing` flattened
attachment objects to bare URLs, discarding the stable id that stops the
two-hourly Airtable URL rotation from re-harvesting bytes already stored.

**Round two (same day):** the seeder ran over the remaining 976 linked records —
609 pages reachable, **65 further records seeded** after filtering. Rejected this
round, all found by inspecting the actual yield: WordPress homepage furniture
(slider/title/testimonial backgrounds), agency logos, an agent headshot,
business-sale collateral, and one agency's "recent listings" carousel that put
photographs of four *different* addresses on four records — wrong-property
imagery is worse than none, so all four were dropped.

**External portals, probed and blocked.** realestate.com.au answers 429 to
direct fetches, 403 via the `r.jina.ai` reader (WAF), and its open suggest API
returns addresses but no imagery; domain.com.au answers 403. The sanctioned
route to portal data is the already-deployed `scrape-property-listing` job
service (Firecrawl with AU geolocation, allowlisting both portals) — it extracts
listing *data*, not photographs, and each job spends paid quota. Portal
photography needs either a Firecrawl key with image capture or a licensed feed;
both are business decisions, not code. Note portals' terms restrict re-use of
listing imagery — the agency's own site, which this pipeline prefers, is also
the cleaner source legally.

The seeder stays useful until the sweep deploys — and afterwards as a bulk
backfill tool. The remaining ~970 linked records are one `worklist.json` away.

## Sourcing externally, for records that arrived with no link

384 records carry no source link at all — parsed out of an email body, so the
marketplace knows the address and the price and has no idea what the house looks
like. 265 of those have a full address, which makes them findable. This is the
**second** pass, and it runs only after the link-following pass has taken
everything it can: a record's own link is always better evidence than anything
found by searching.

### The portals are not the answer, and that is a finding, not a shrug

| Source | From this environment |
| --- | --- |
| realestate.com.au listing page | **429** (Kasada) |
| realestate.com.au via a rendering reader | **403** (WAF) |
| realestate.com.au suggest API | 200 — resolves an address to a property id, carries **no imagery** |
| domain.com.au | **403** |
| view.com.au / homely.com.au | **403** |
| Bing (HTML and the RSS endpoint) | 200, but bot-degraded: it answers `"14 Hillcrest Road" Anglesea` with articles about *the number 14* |

Both portals also restrict re-use of listing imagery in their terms. The agency
that emailed us the listing publishes the same photographs on its own site, is
happy to be linked, and — measured — is reachable. So the route is: identify the
agency, read its for-sale index, match by address.

### Matching is the whole risk

Searching for a property you have no link to means you can find the *wrong* one,
and a wrong photograph on a marketplace card is worse than a grey box: it is a
claim about a specific house at a specific price, and a buyer acts on it.

`addressMatch.pure.ts` therefore refuses anything short of street number +
street name + suburb, and the script never loosens the rule when strict matching
comes up empty — records simply stay unmatched. Two rules earned their place by
catching real errors in the first live crawl:

- **A street is not a property.** "Great Ocean Road, Anglesea" must never match
  "143D Great Ocean Road" — it could be any of a hundred houses.
- **Units must agree whenever either side names one.** The tolerant version
  matched a record for "143D Great Ocean Road" to a page for **"5/143D"** — one
  townhouse out of a complex, whose interior is not this card's property unless
  this card is unit 5. Nothing said it was, so it is now refused.

First live run — Great Ocean Properties, 22 records: 8 index pages, 91 property
pages read, **17 matched and written, 5 deliberately left unmatched.** Every
match was checked by eye against the page title before anything was written.

### A CDN that hid fourteen photographs

The agency runs on Reapit/AgentPoint, which serves photographs as
`phimg.reapit.website/<sha1>` — **no file extension at all**, the same failure
class as the Google CDN documented above. `isPropertyImageUrl` rejected every
one, so a page with fourteen photographs yielded zero and looked photo-less.
Adding `reapit.website` (plus `arosoftware.com`, `idashboard.com.au` and
`pushcreative.com.au`, all observed extension-less in this corpus) took that
page from **0 to 19**. This fix is in the shared scraper, so the deployed sweep
inherits it.

## Contacting the agent

Enrichment exists so that someone can act on a listing, and the action is almost
always "ask the agent about it". That is only possible where the record carries a
reachable address, and it frequently does not.

Measured over the 1,441 records: `Agent Email` on 416, `Agency Email` on 314,
`Sender Email` on 361 — **451 (31%) carry at least one**, and any phone number at
all on 480 (33%).

`listingContact.pure.ts` resolves the best of them in a fixed order — agent,
agency, then the sending mailbox — and reports which one it used, so the composer
can say "this went to the agency, not the agent directly" rather than implying a
precision it does not have. Two filters do the real work:

- **Unreachable local parts** — `noreply`, `donotreply`, `bounce`, `postmaster`,
  `mailer-daemon`, `notifications`, `alerts`, `automated` and friends. An enquiry
  sent to one of these is silently lost, which is worse than showing no button.
- **Bulk-sender hosts** — `sendgrid.net`, `mailchimp`, `amazonses.com`,
  `mailgun`, `postmarkapp` and the rest. `Sender Email` on a campaign blast is
  the ESP's envelope address, not a person.

The scraper contributes to this too: `extractContact` reads `mailto:` and `tel:`
hrefs from the listing page, falling back to body-text addresses **only when the
domain matches the page's own host**, and skipping generic mailboxes
(`info@`, `sales@`, `enquiries@`…). Found addresses are offered at confidence
0.75 and are in `WRITEBACK_FIELDS`, so a contact recovered from a page can reach
Airtable through the normal empty-columns-only path.

Sending goes through `send-email-reply` — the same outbound path as every other
email the app sends, from the user's connected mailbox or the organisation's —
rather than a `mailto:` link, which would depend on a configured desktop client
and leave no record on the platform.

## Boilerplate

Mined and scraped URLs are frequently the agency logo, the agent's headshot,
social icons, tracking pixels, or the "SOLD"/"UNDER OFFER" overlay stickers that
sit in the markup of every listing whether they apply or not. Because the same
file appears on every listing, harvesting them would fill the library with a
dozen images repeated a thousand times and put a letterhead where the house
should be. `listingScrape.pure.ts` carries the denylist; every entry in it was
observed on a real page.

## Budget

This makes scheduled outbound requests to third-party websites, so the cost of a
runaway loop is being blocked by the sites the data comes from.

| Limit | Value |
| --- | --- |
| Sweep interval | 10 minutes |
| Listings per run | 25 |
| Page fetches per run | 60 |
| Page fetches per day | 4,000 |
| Listings per day | 3,000 |
| Images per listing | 16 (harvester caps at 12) |
| Write-backs per day | 200 |

At 25 per run the 1,441-record backlog clears inside a day, then idles.

**No LLM calls and no Perplexity.** `scrape-property-listing` is job-based and
paid; cron × Perplexity × 1,441 is a bill nobody approved. Regex over
machine-generated agency-CRM markup is sufficient, as the numbers above show. If
coverage plateaus, that is the point to reconsider — not before.

**Street View bytes are never harvested.** Caching Google's imagery is a
terms-of-service grey area and `street-view` already renders it live. The
`street_view` origin stays in the enum and is never populated by the sweep.

## Write-back to Airtable

`op:'writeback'`, six-hourly, **shipped in dry-run**.

Airtable is what people read and edit, and clobbering a human's correction is
unrecoverable. So: allowlisted fields only; only into columns still empty when the
run reads them; confidence ≥ 0.85; never an LLM-derived value; and refused
outright when `listings_cache_sync.status` is not `ok` — never write into a base
you cannot currently read reliably, because a column that looks empty may just be
one you failed to read.

Where the enriched value differs from a non-empty Airtable value, the record is
counted as a conflict and left alone.

Run `{"op":"writeback","dryRun":true}` and read `wouldPatch` and `sample` before
setting `dryRun:false`.

## Verifying

```sql
-- Coverage, before and after.
select
  count(*) filter (where fields->>'Price Numeric' is not null) as price,
  count(*) filter (where fields->>'Beds' is not null) as beds,
  count(*) filter (where coalesce(fields->>'Web Link','') <> '') as web_link,
  count(*) as total
from public.listings_cache where table_key = 'tblWIg5cs85O30pcY';

-- What the sweep has done.
select status, count(*) from public.listing_enrichment group by status;
select stage, outcome, count(*) from public.listing_enrichment_events
  group by stage, outcome order by 3 desc;
select * from public.listing_enrichment_budget order by day desc limit 7;

-- Photographs actually stored.
select count(*) from public.listing_images where status = 'stored';
```

Unit tests: `src/lib/listingScrape.test.ts` (extraction, boilerplate rejection),
`src/lib/listingUrlPolicy.test.ts` (classification, every SSRF range, merge
rules).

## Deployment (2026-08-04)

The whole listing chain now runs the merged source. It happened in two steps
the same day:

1. **The shim.** With no deploy credential available, `listing-enrichment` was
   first deployed as a three-line shim importing the reviewed source from the
   public repository at a pinned commit — enough to wake the `*/10` sweep cron,
   which had been firing into a 404 since the migration installed it. Within
   its first two fires it seeded 400 queue rows, enriched ~30 listings and
   grew the stored-image count from 876 to 1,000+.

2. **The full deploy.** Once a `SUPABASE_ACCESS_TOKEN` was provided, every
   function the marketplace touches was deployed from the repository source
   through the Management API (the same call `supabase functions deploy`
   makes), replacing both the shim and the pre-#1866 versions that had been
   serving the old field map:

   | Function | Now | Was |
   | --- | --- | --- |
   | `listing-enrichment` | v2 (full source) | v1 shim / **never deployed** |
   | `listings-cache` | v6 | v5, pre-#1866 |
   | `listing-images` | v9 | v8, pre-#1866 |
   | `airtable-proxy` | v16 | v15, pre-#1866 |
   | `street-view` | v74 | v73 |
   | `resolve-listing-coordinates` | v62 | v61 |
   | `scrape-property-listing` | v62 | v61 |

   All verified booting with structured `auth_required` on anonymous calls,
   `verify_jwt=false` per `config.toml` (each carries its own session auth).

This unlocks the server-side halves the client had been working around:
`op:'record'` single-row reads for deep links, server-side table-name
aliasing, the overlay join in `readCache`, the overlay-aware image sweep, and
the non-destructive dedup.

**Keep it deployed:** add the token as the `SUPABASE_ACCESS_TOKEN` Actions
secret (Settings → Secrets and variables → Actions) so
`.github/workflows/deploy-supabase-functions.yml` ships every future merge
automatically. Until that secret exists, deploys remain a manual step.

## The client-side cascade (same date)

The browser now runs the acquisition chain automatically wherever a listing
renders with no photographs: stored images first (`useListingImages`), then a
silent `op:'enrich'` against the listing's own source page
(`useAutoFindPhotos` — one at a time, eight seconds apart, twelve per page
view, remembered in localStorage for three days so fruitless searches are not
repeated), then Street View loaded automatically in-viewport
(`ListingHero` `streetViewMode:'auto'`, session-cached per location including
negative answers, badged "Street view" on the frame). There are no imagery
buttons left on the cards; the failsafe order is the interface.

## Photographs before floor plans (2026-08-04, second round)

Agency galleries usually lead with the floor plan — the first asset the agent
uploads — and harvested order became display order, so hero slots opened on
line drawings. Two classifiers now put photographs first everywhere:

- **URL tokens** (`_shared/listingImageOrder.pure.ts`, shared Deno/browser):
  floorplan/siteplan/titleplan/lotplan naming, `/plans?/` segments, agentbox
  `fp<digits>` assets. Applied at the source in `extractPageImages` (deployed
  in `listing-enrichment` v4) and instantly in the browser.
- **Pixels** (`src/lib/imageKind.ts`, browser only): hashed CDN paths say
  nothing, so the browser draws each image 48×48 and measures near-white
  ground vs real chroma. Thresholds are deliberately biased — misreading a
  plan as a photo restores yesterday's behaviour, misreading a photo as a
  plan buries the best asset, so the rule demands strong evidence. Verdicts
  are session-cached by URL-without-query.

Ordering is stable within each group (no shuffling under the reader's thumb),
plan slides are labelled "Floor plan" in the counter, and the detail page
orders once for both hero and lightbox so the expanded slide matches.
