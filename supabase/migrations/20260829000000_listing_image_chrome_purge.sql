-- ---------------------------------------------------------------------------
-- Retire page furniture that was harvested as property photography.
--
-- The card image on 44 listings was `propertyViewer/bed.png` — a 680-byte line
-- drawing of a bed, one of the glyphs an agency template uses to label its
-- spec row. It sorted to position 0 because the spec row sits above the gallery
-- in the markup, so it took the hero slot on every listing from that agency
-- while the twelve real photographs waited behind it.
--
-- It was not alone. Across the library:
--
--   50 of 435 hero slots (11.5%) held something under 5 KB
--   183 stored images were under 5 KB in total — bed/bathtub/car/phone/email
--       glyphs, a `dummy-image.webp`, realestate.com.au's `/420x280`
--       placeholder, and a handful of broken sub-2 KB renditions
--   20 were agent portraits from Rex CRM's `account_users/<id>/profile_image/`
--       path, 11 of them at position 0 — an agent's face as the property
--
-- `listingScrape.pure.ts` had a furniture filter and it worked, but it only
-- ever saw what that scraper produced. Images arriving from the Airtable
-- column, or replayed by the browser, never passed through it. The test now
-- lives in `listingImageChrome.pure.ts`, which the scraper, the candidate
-- normaliser and the harvester all read, so this cannot refill.
--
-- The size threshold is measured rather than chosen: the junk population tops
-- out at 3,879 bytes and the smallest genuine photograph in the corpus is
-- 6,517, so 5,000 sits in the gap.
--
-- Five listings are left with no photograph at all. That is the correct
-- outcome — they never had one, and the drawn cover with "No photo on record"
-- is honest where a placeholder or an agent's headshot was not.
--
-- Rows are marked `gone`, not deleted: the bytes are shared by checksum and a
-- report rendered earlier may still reference one. Safely re-runnable.
-- ---------------------------------------------------------------------------

-- 1. Retire the furniture ----------------------------------------------------
UPDATE public.listing_images
SET status = 'gone',
    last_verified_at = now(),
    last_error = 'page_furniture'
WHERE status = 'stored'
  AND (
    -- Measured floor. Nothing this small has ever been a photograph.
    bytes < 5000

    -- Chrome by path. `profile_` catches Rex CRM's agent portraits, which the
    -- older `profile-` hint missed because that path uses an underscore.
    OR source_url ~* '(propertyviewer|property-viewer|sprite|profile_|/agents?/|/team/|/people/|dummy|/ui/|placeholder|no-image|favicon|watermark|logo|headshot|avatar)'

    -- A bare dimension path is a CDN's placeholder endpoint: `/420x280`.
    OR source_url ~* '/[0-9]{2,4}x[0-9]{2,4}/?$'

    -- Filenames that are UI glyphs when they stand alone. Matched on the whole
    -- stem, never as a substring: `bed.png` is an icon, `12-bedford-street.jpg`
    -- is a house, and a substring rule would throw away the house.
    OR lower(regexp_replace(regexp_replace(source_url, '\?.*$', ''), '^.*/', '')) ~
       '^(bed|beds|bath|baths|bathtub|car|cars|garage|parking|phone|mobile|email|mail|fax|share|heart|star|map|pin|location|search|menu|close|play|thumb|thumb1|thum1|blank|land|area|size|plan|floorplan)\.(png|jpe?g|webp|gif)$'
  );

-- 2. Close the gaps the retirement left in each gallery ----------------------
WITH ordered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY listing_id
           ORDER BY position ASC, first_seen_at ASC, id ASC
         ) - 1 AS new_position
  FROM public.listing_images
  WHERE status = 'stored'
)
UPDATE public.listing_images AS li
SET position = ordered.new_position
FROM ordered
WHERE li.id = ordered.id
  AND li.position IS DISTINCT FROM ordered.new_position;

-- 3. Re-point the per-listing counters ---------------------------------------
UPDATE public.listing_image_sets AS s
SET stored_count = COALESCE(c.stored_count, 0),
    image_count = GREATEST(s.image_count, COALESCE(c.stored_count, 0))
FROM (
  SELECT sets.listing_id, count(li.id) AS stored_count
  FROM public.listing_image_sets sets
  LEFT JOIN public.listing_images li
    ON li.listing_id = sets.listing_id AND li.status = 'stored'
  GROUP BY sets.listing_id
) AS c
WHERE s.listing_id = c.listing_id
  AND s.stored_count IS DISTINCT FROM COALESCE(c.stored_count, 0);
