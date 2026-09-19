-- Listing image library.
--
-- Property photos reach the dashboard as Airtable attachments, whose `url` is a
-- signed link Airtable expires a couple of hours after handing it out, or as
-- hotlinks to a portal that will withdraw the listing eventually. Neither is
-- storable, so neither can back a card, a popup, a PDF or a report months from
-- now. This migration adds the durable copy:
--
--   * `listing-images`            private bucket holding the bytes we fetched
--   * `public.listing_images`     one row per stored image, the render index
--   * `public.listing_image_sets` one row per listing, the refresh state machine
--
-- Both tables are service-role only. The browser never reads them directly; the
-- `listing-images` edge function hands out short-lived signed URLs, which is the
-- same posture the repo already takes for private report storage.

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ---------------------------------------------------------------------------
-- Per-image rows
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.listing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Airtable record id of the listing this photo belongs to.
  listing_id TEXT NOT NULL,
  -- Stable identity from `imageIdentity()` in src/lib/listingImages.ts:
  -- the Airtable attachment id, or origin+path with the query string dropped.
  -- Keying on the full URL would make every re-signed Airtable link look like a
  -- brand-new photo and re-download the whole set on every pass.
  image_identity TEXT NOT NULL,
  -- Path inside the `listing-images` bucket. Null until the bytes land.
  storage_path TEXT,
  origin TEXT NOT NULL DEFAULT 'airtable'
    CHECK (origin IN ('airtable', 'listing_url', 'scraped', 'street_view')),
  -- Editorial order from the source: position 0 is the agent's hero shot.
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'stored', 'failed', 'gone')),
  content_type TEXT,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  -- SHA-256 of the stored bytes. A re-fetch that matches is a no-op, so an
  -- unchanged photo never rewrites storage or bumps the row.
  checksum TEXT,
  -- Last URL the bytes came from. Kept for diagnostics and re-fetch; it is
  -- expected to be expired and must never be served to a browser.
  source_url TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  CONSTRAINT listing_images_identity_unique UNIQUE (listing_id, image_identity)
);

CREATE INDEX IF NOT EXISTS listing_images_listing_idx
  ON public.listing_images (listing_id, position);
CREATE INDEX IF NOT EXISTS listing_images_status_idx
  ON public.listing_images (status)
  WHERE status <> 'stored';

GRANT ALL ON public.listing_images TO service_role;
ALTER TABLE public.listing_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_images_service_role_only" ON public.listing_images;
CREATE POLICY "listing_images_service_role_only"
  ON public.listing_images FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Per-listing refresh state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.listing_image_sets (
  listing_id TEXT PRIMARY KEY,
  -- Order-independent fingerprint of the candidate set (imageSetFingerprint).
  -- A pass whose fingerprint is unchanged touches no bytes at all.
  fingerprint TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  stored_count INTEGER NOT NULL DEFAULT 0,
  -- When the listing itself was listed/received. Drives the refresh cadence:
  -- new listings churn photos, settled ones do not.
  listed_at TIMESTAMPTZ,
  last_harvested_at TIMESTAMPTZ,
  -- The perpetual bit. The refresh sweep claims rows whose time has come.
  refresh_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  -- Write-back state for the Airtable enrichment column.
  airtable_synced_at TIMESTAMPTZ,
  airtable_sync_fingerprint TEXT
);

-- The sweep's only access path: "what is due, oldest first".
CREATE INDEX IF NOT EXISTS listing_image_sets_due_idx
  ON public.listing_image_sets (refresh_after);
-- Finds listings whose stored images have drifted from what Airtable holds.
CREATE INDEX IF NOT EXISTS listing_image_sets_airtable_drift_idx
  ON public.listing_image_sets (airtable_synced_at)
  WHERE airtable_sync_fingerprint IS DISTINCT FROM fingerprint;

GRANT ALL ON public.listing_image_sets TO service_role;
ALTER TABLE public.listing_image_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_image_sets_service_role_only" ON public.listing_image_sets;
CREATE POLICY "listing_image_sets_service_role_only"
  ON public.listing_image_sets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------------
-- No policy grants the `authenticated` role anything on this bucket: reads are
-- served exclusively as signed URLs minted by the edge function, so a client
-- cannot enumerate the bucket or reach an object it was not handed.

DROP POLICY IF EXISTS "listing_images_objects_service_role_only" ON storage.objects;
CREATE POLICY "listing_images_objects_service_role_only"
  ON storage.objects FOR ALL
  USING (bucket_id = 'listing-images' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'listing-images' AND auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Perpetual refresh
-- ---------------------------------------------------------------------------
-- Hourly rather than daily: the sweep is bounded per run (the function caps how
-- many listings it claims), so a steady trickle keeps the backlog flat instead
-- of producing one large burst a day that collides with the source's rate limit.

SELECT cron.unschedule('listing-images-refresh-hourly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'listing-images-refresh-hourly');

SELECT cron.schedule(
  'listing-images-refresh-hourly',
  '23 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/listing-images',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{"op":"refresh"}'::jsonb
  ) AS request_id;
  $$
);

COMMENT ON TABLE public.listing_images IS
  'Durable copies of listing photos. Source URLs (Airtable signed links, portal hotlinks) expire; these rows and their bucket objects do not.';
COMMENT ON TABLE public.listing_image_sets IS
  'Per-listing harvest state. `refresh_after` drives the hourly sweep; cadence comes from listing recency (see src/lib/listingImages.ts).';
