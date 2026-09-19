CREATE TABLE IF NOT EXISTS public.listing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id TEXT NOT NULL,
  image_identity TEXT NOT NULL,
  storage_path TEXT,
  origin TEXT NOT NULL DEFAULT 'airtable'
    CHECK (origin IN ('airtable', 'listing_url', 'scraped', 'street_view')),
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'stored', 'failed', 'gone')),
  content_type TEXT,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  checksum TEXT,
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

CREATE TABLE IF NOT EXISTS public.listing_image_sets (
  listing_id TEXT PRIMARY KEY,
  fingerprint TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  stored_count INTEGER NOT NULL DEFAULT 0,
  listed_at TIMESTAMPTZ,
  last_harvested_at TIMESTAMPTZ,
  refresh_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  airtable_synced_at TIMESTAMPTZ,
  airtable_sync_fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS listing_image_sets_due_idx
  ON public.listing_image_sets (refresh_after);
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

DROP POLICY IF EXISTS "listing_images_objects_service_role_only" ON storage.objects;
CREATE POLICY "listing_images_objects_service_role_only"
  ON storage.objects FOR ALL
  USING (bucket_id = 'listing-images' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'listing-images' AND auth.role() = 'service_role');

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
  'Durable copies of listing photos. Source URLs expire; these rows and their bucket objects do not.';
COMMENT ON TABLE public.listing_image_sets IS
  'Per-listing harvest state. refresh_after drives the hourly sweep.';