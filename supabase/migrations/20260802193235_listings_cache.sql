-- Listings cache.
--
-- Overview and Listings both read the whole property table by walking
-- `airtable-proxy` 100 records at a time. The proxy hard-caps `pageSize` at 100
-- and the offset for page N+1 only exists once page N has returned, so a cold
-- read is ceil(N/100) *sequential* round trips — about fifteen at present — and
-- every one of them also runs an O(n^2) dedup pass and writes an api_usage_log
-- row. Every user paid that, on every device, every time.
--
-- A browser-side IndexedDB cache helped a returning visitor and nobody else: it
-- cannot warm a first visit, a new device, or a cleared profile. This moves the
-- cache server-side, where one sync serves everyone and cron keeps it warm
-- before anyone opens the app. Airtable rate-limit pressure drops from
-- "per user, per page" to "once per sync interval".
--
-- The cache mirrors Airtable rather than archiving it. Airtable prunes the
-- Property Intake Master table 30 days after a record's Created Time, and the
-- sync's reconciliation step propagates that here, so the dashboard settles
-- into a rolling window of current stock. Records removed upstream are removed
-- here; this table is not a second copy.

-- ---------------------------------------------------------------------------
-- The cached records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.listings_cache (
  -- Raw Airtable record id, plain text and no FK — the same convention
  -- `listing_image_sets` and `auto_report_processed_listings` already use.
  listing_id TEXT PRIMARY KEY,
  -- Which Airtable table this row came from, so one cache can serve more than
  -- one table without them colliding.
  table_key TEXT NOT NULL,
  -- Airtable's `fields` object, verbatim. Kept whole deliberately: the intake
  -- table carries 205 fields and grows, and a typed column per field would mean
  -- a migration every time someone adds one in Airtable.
  fields JSONB NOT NULL,
  -- Promoted out of `fields` because they are the only two the server needs to
  -- index and order by. `created_time` must come from Airtable's own Created
  -- Time — `airtable-proxy` coalesces several date fields and falls back to
  -- now() when none is present, which would make undated records look brand new
  -- on every sync and disagree with the 30-day window upstream.
  created_time TIMESTAMPTZ,
  last_modified_time TIMESTAMPTZ,
  -- Digest of the record's contents, so an unchanged record costs no write.
  fingerprint TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Stamped on every sync that saw this record. Reconciliation deletes rows
  -- whose stamp predates the run, which is how an upstream deletion lands here.
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The app's only read: everything for one table, newest first.
CREATE INDEX IF NOT EXISTS listings_cache_table_created_idx
  ON public.listings_cache (table_key, created_time DESC);
-- The reconciliation sweep's access path.
CREATE INDEX IF NOT EXISTS listings_cache_verified_idx
  ON public.listings_cache (table_key, last_verified_at);

GRANT ALL ON public.listings_cache TO service_role;
ALTER TABLE public.listings_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listings_cache_service_role_only" ON public.listings_cache;
CREATE POLICY "listings_cache_service_role_only"
  ON public.listings_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Sync state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.listings_cache_sync (
  table_key TEXT PRIMARY KEY,
  last_sync_at TIMESTAMPTZ,
  -- Only set by a sync that completed its walk cleanly. A partial run must not
  -- move this, or the next run would trust a count it never actually verified.
  last_full_sync_at TIMESTAMPTZ,
  -- Records held after the last clean sync. The next run compares against this
  -- before it is allowed to delete anything.
  record_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'syncing', 'ok', 'partial', 'failed')),
  -- Set when a run upserted what it could but was refused permission to
  -- reconcile — a truncated walk must never be able to empty the cache.
  reconciled BOOLEAN NOT NULL DEFAULT false,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

GRANT ALL ON public.listings_cache_sync TO service_role;
ALTER TABLE public.listings_cache_sync ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listings_cache_sync_service_role_only" ON public.listings_cache_sync;
CREATE POLICY "listings_cache_sync_service_role_only"
  ON public.listings_cache_sync FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Keeping it warm
-- ---------------------------------------------------------------------------
-- Every 15 minutes. The sync is the only thing that talks to Airtable now, so
-- this interval is the entire Airtable read load for the whole organisation —
-- previously it was one full walk per user per page view.

SELECT cron.unschedule('listings-cache-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'listings-cache-sync');

SELECT cron.schedule(
  'listings-cache-sync',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/listings-cache',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{"op":"sync"}'::jsonb
  ) AS request_id;
  $$
);

COMMENT ON TABLE public.listings_cache IS
  'Server-side mirror of the Airtable property table. Replaces ~15 sequential airtable-proxy round trips per page load with one Postgres read. Mirrors upstream deletions (Airtable prunes at 30 days) rather than archiving them.';
COMMENT ON TABLE public.listings_cache_sync IS
  'Per-table sync state. `record_count` and `reconciled` are what stop a truncated Airtable walk from deleting the cache out from under every user at once.';
