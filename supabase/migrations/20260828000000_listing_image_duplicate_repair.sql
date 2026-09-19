-- ---------------------------------------------------------------------------
-- Listing image library: undo the re-signed-URL duplication, restore what it
-- retired.
--
-- `image_identity` was documented as stable because it drops the query string.
-- It is not. An Airtable attachment URL is
--   https://v5.airtableusercontent.com/v3/u/56/56/<epoch-ms>/<sig>/<sig>
-- and the expiry and signature live in the *path*. Every read of an unchanged
-- attachment therefore produced a brand-new identity: the harvest filed another
-- row for a photograph it already held, and — because the harvest also
-- reconciles — retired the copy it had stored on the previous pass.
--
-- Run over a day that came to:
--   7,524 rows carrying only 4,152 distinct photographs
--   4,076 rows marked `gone`, 3,366 of them re-signed copies of something still
--         held, up to nine deep on a single listing
--   708 photographs across 67 listings left with no `stored` row at all —
--         genuinely missing from the page
--
-- The bytes are the only thing that did not change between passes, so the
-- checksum is what settles identity here. This migration:
--
--   1. restores one row per photograph that currently has no stored copy
--   2. collapses any remaining duplicate stored copies to one apiece
--   3. renumbers positions so each gallery is contiguous and deterministic
--   4. re-points the per-listing counters
--
-- The redundant `gone` rows are deliberately left alone. They are the same
-- bytes under a dead identity — nothing renders them, storage is shared by
-- checksum, and a report rendered earlier may still reference one.
--
-- The defect itself is fixed in `listing-images/index.ts`, which now adopts the
-- row already holding a checksum instead of inserting a second one, so this
-- runs once and does not recur. It is written to be safely re-runnable
-- regardless: every step is conditional on the state it finds.
-- ---------------------------------------------------------------------------

-- 1. Bring back photographs that exist only as retired rows -----------------
--
-- One row per (listing, checksum): the most recently verified copy, which is
-- the one whose bucket object is most likely to still be there. Restoring more
-- than one would just re-create the duplication this repairs.
WITH recoverable AS (
  SELECT DISTINCT ON (g.listing_id, g.checksum) g.id
  FROM public.listing_images g
  WHERE g.status = 'gone'
    AND g.checksum IS NOT NULL
    AND g.storage_path IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.listing_images s
      WHERE s.listing_id = g.listing_id
        AND s.checksum = g.checksum
        AND s.status = 'stored'
    )
  ORDER BY g.listing_id, g.checksum, g.last_verified_at DESC NULLS LAST, g.first_seen_at DESC
)
UPDATE public.listing_images AS li
SET status = 'stored',
    last_verified_at = now()
FROM recoverable r
WHERE li.id = r.id;

-- 2. One stored copy per photograph -----------------------------------------
--
-- Keeps the lowest-positioned copy, so the agent's own ordering survives.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY listing_id, checksum
           ORDER BY position ASC, first_seen_at ASC, id ASC
         ) AS copy_number
  FROM public.listing_images
  WHERE status = 'stored' AND checksum IS NOT NULL
)
UPDATE public.listing_images AS li
SET status = 'gone',
    last_verified_at = now()
FROM ranked
WHERE li.id = ranked.id
  AND ranked.copy_number > 1;

-- 3. Contiguous, deterministic ordering --------------------------------------
--
-- Restored rows carry positions from whichever pass filed them, so a gallery
-- can hold three photographs all claiming position 0. Ordered by the position
-- each already had, then by age, so the hero shot stays the hero.
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

-- 4. Re-point the per-listing counters ---------------------------------------
--
-- `refresh_after` is deliberately not touched. The restored rows are already
-- renderable — `signStoredImages` reads them directly — so there is nothing to
-- re-harvest, and re-arming every set at once would send the whole library
-- through the sweep for no gain.
WITH counts AS (
  SELECT listing_id, count(*) AS stored_count
  FROM public.listing_images
  WHERE status = 'stored'
  GROUP BY listing_id
)
UPDATE public.listing_image_sets AS s
SET stored_count = counts.stored_count,
    image_count = GREATEST(s.image_count, counts.stored_count)
FROM counts
WHERE s.listing_id = counts.listing_id
  AND s.stored_count IS DISTINCT FROM counts.stored_count;
