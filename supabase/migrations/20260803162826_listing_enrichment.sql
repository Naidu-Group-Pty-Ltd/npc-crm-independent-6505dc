-- Listing enrichment overlay.
--
-- The intake pipeline runs one stage and stops. It reads an email body, asks a
-- model for structured fields, writes them to Airtable — and every later stage
-- it was designed with is switched off: `Web Scrape Status` reads "Not Required"
-- on every record, `Enrichment Status` reads "Not Started", `Processing Stage`
-- never advances past "AI Parsed". The result, measured across all 1,441
-- records: zero images, zero coordinates, no bedroom count on a third, no agent
-- on 60%.
--
-- That pipeline lives in a Make.com account this workspace cannot reach, so the
-- gap is closed here instead. What it is closed WITH matters: mining the text
-- the pipeline already stored recovers almost nothing — of 60 sampled records
-- with no price, none had a dollar figure anywhere in their stored text. The
-- data is on the listing page. One record the dashboard shows as
-- "Unknown / – / – / – / Price on request" has a source page carrying 62
-- photographs, six bedrooms, four bathrooms and an 809 m² land size, and 77% of
-- records carry a link to such a page.
--
-- Enriched values land here rather than in Airtable. Airtable is what humans
-- read and edit, and a write-back that clobbered a human's correction would be
-- unrecoverable, so this table fills holes and a separate, guarded pass offers a
-- narrow subset back upstream.

-- ---------------------------------------------------------------------------
-- The overlay
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.listing_enrichment (
  -- Raw Airtable record id. Deliberately NO foreign key to listings_cache:
  -- Airtable prunes that table at 30 days and the cache mirrors the deletion, so
  -- a cascade would destroy a month of accumulated enrichment every night. The
  -- overlay outlives the mirror on purpose.
  listing_id TEXT PRIMARY KEY,
  table_key TEXT NOT NULL,

  -- Canonical field name -> enriched value. One JSONB document rather than a
  -- row per field: this is read on every page load and joined into the cache
  -- read, so it should be one row and one merge, not N rows.
  values JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Canonical field name -> { src, conf, at, ev }. Kept beside the values rather
  -- than inside them so the hot path can select `values` alone.
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,

  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'ok', 'partial', 'failed', 'skipped')),
  -- Last stage attempted, so a resumed run knows where it stopped.
  stage TEXT,
  -- Worst-first ordering. Higher is worked sooner. See `enrichmentPriority`:
  -- the gap discounted by how close the record is to being pruned upstream,
  -- because enriching a 29-day-old listing buys one day of benefit.
  priority INTEGER NOT NULL DEFAULT 0,

  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  -- Exponential backoff. A permanently dead link is pushed far out rather than
  -- retried every ten minutes forever.
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Held by the sweep that claimed this row. Without it, two overlapping cron
  -- fires harvest the same listing twice and pay twice.
  lease_until TIMESTAMPTZ,

  first_enriched_at TIMESTAMPTZ,
  last_enriched_at TIMESTAMPTZ,

  -- Airtable write-back state, tracked separately from enrichment itself so a
  -- failed write-back never looks like a failed enrichment.
  writeback_state TEXT NOT NULL DEFAULT 'none'
    CHECK (writeback_state IN ('none', 'pending', 'dry_run', 'written', 'refused', 'failed')),
  writeback_at TIMESTAMPTZ,
  -- Digest of what was last written, so a repeat run is a no-op.
  writeback_fingerprint TEXT
);

-- The sweep's claim query: highest priority among rows that are due.
CREATE INDEX IF NOT EXISTS listing_enrichment_claim_idx
  ON public.listing_enrichment (status, next_attempt_at, priority DESC);
-- The page read joins on this.
CREATE INDEX IF NOT EXISTS listing_enrichment_table_idx
  ON public.listing_enrichment (table_key);
CREATE INDEX IF NOT EXISTS listing_enrichment_writeback_idx
  ON public.listing_enrichment (writeback_state, writeback_at);

GRANT ALL ON public.listing_enrichment TO service_role;
ALTER TABLE public.listing_enrichment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_enrichment_service_role_only" ON public.listing_enrichment;
CREATE POLICY "listing_enrichment_service_role_only"
  ON public.listing_enrichment FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- What each run did
-- ---------------------------------------------------------------------------
-- An append-only log, because the interesting failures here are the ones nobody
-- was watching: a scrape that started returning 403 for one agency, a redirect
-- chain that began looping. Without a per-attempt record those show up only as a
-- gap in the data months later.

CREATE TABLE IF NOT EXISTS public.listing_enrichment_events (
  id BIGSERIAL PRIMARY KEY,
  listing_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_enrichment_events_listing_idx
  ON public.listing_enrichment_events (listing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS listing_enrichment_events_recent_idx
  ON public.listing_enrichment_events (created_at DESC);

GRANT ALL ON public.listing_enrichment_events TO service_role;
ALTER TABLE public.listing_enrichment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_enrichment_events_service_role_only" ON public.listing_enrichment_events;
CREATE POLICY "listing_enrichment_events_service_role_only"
  ON public.listing_enrichment_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Spend
-- ---------------------------------------------------------------------------
-- One row per UTC day. Checked before a run starts and incremented as it goes,
-- so a bug that loops cannot burn a month of quota in an hour — this pass makes
-- outbound HTTP requests to arbitrary agency websites on a schedule, and the
-- failure mode of getting that wrong is being rate-limited or blocked by the
-- very sites the data comes from.

CREATE TABLE IF NOT EXISTS public.listing_enrichment_budget (
  day DATE PRIMARY KEY,
  runs INTEGER NOT NULL DEFAULT 0,
  listings INTEGER NOT NULL DEFAULT 0,
  http_fetches INTEGER NOT NULL DEFAULT 0,
  geocodes INTEGER NOT NULL DEFAULT 0,
  images_harvested INTEGER NOT NULL DEFAULT 0,
  writebacks INTEGER NOT NULL DEFAULT 0
);

GRANT ALL ON public.listing_enrichment_budget TO service_role;
ALTER TABLE public.listing_enrichment_budget ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_enrichment_budget_service_role_only" ON public.listing_enrichment_budget;
CREATE POLICY "listing_enrichment_budget_service_role_only"
  ON public.listing_enrichment_budget FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- Claiming work
-- ---------------------------------------------------------------------------

-- Atomically claims the next batch, so overlapping cron fires cannot both take
-- the same listing. `listing-images`' own sweep does not do this and can
-- double-harvest; that pattern is deliberately not copied.
CREATE OR REPLACE FUNCTION public.claim_listing_enrichment(
  p_table_key TEXT,
  p_limit INTEGER,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.listing_enrichment
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.listing_enrichment AS e
  SET status = 'running',
      lease_until = now() + make_interval(secs => p_lease_seconds),
      attempt_count = e.attempt_count + 1,
      stage = 'claimed'
  WHERE e.listing_id IN (
    SELECT c.listing_id
    FROM public.listing_enrichment AS c
    WHERE c.table_key = p_table_key
      AND c.next_attempt_at <= now()
      AND (
        c.status IN ('queued', 'failed', 'partial')
        -- A run that died mid-flight leaves `running` behind; the lease expiring
        -- is what makes that recoverable rather than permanently stuck.
        OR (c.status = 'running' AND (c.lease_until IS NULL OR c.lease_until < now()))
      )
    ORDER BY c.priority DESC, c.next_attempt_at ASC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING e.*;
$$;

REVOKE ALL ON FUNCTION public.claim_listing_enrichment(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_listing_enrichment(TEXT, INTEGER, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Schedule
-- ---------------------------------------------------------------------------
-- Every 10 minutes, 25 listings a run. That clears the 1,441-record backlog
-- inside a day and then idles, because a record already enriched is not
-- reclaimed until something about it changes.

SELECT cron.unschedule('listing-enrichment-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'listing-enrichment-sweep');

SELECT cron.schedule(
  'listing-enrichment-sweep',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/listing-enrichment',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_service_role_key')
    ),
    body := '{"op":"sweep"}'::jsonb
  ) AS request_id;
  $$
);

COMMENT ON TABLE public.listing_enrichment IS
  'Fills the holes the intake pipeline leaves: images, coordinates, specs and price, scraped from the listing page. Airtable wins wherever it has a value; this only ever adds. No FK to listings_cache — that table is pruned at 30 days and a cascade would delete the enrichment with it.';
COMMENT ON TABLE public.listing_enrichment_events IS
  'Per-attempt log. The failures worth catching here are silent ones — an agency site that starts refusing us, a redirect chain that begins looping.';
COMMENT ON TABLE public.listing_enrichment_budget IS
  'Daily spend ceiling. This pass makes scheduled outbound requests to third-party websites; the cost of a runaway loop is being blocked by the sites the data comes from.';
COMMENT ON FUNCTION public.claim_listing_enrichment IS
  'Atomic claim with a lease, so overlapping cron fires cannot harvest the same listing twice. An expired lease makes a crashed run recoverable.';
