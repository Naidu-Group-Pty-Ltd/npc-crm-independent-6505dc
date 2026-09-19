-- ---------------------------------------------------------------------------
-- Stop the Property Marketplace emptying itself.
--
-- Airtable's `Property Intake Master` is a working table and the base prunes it
-- thirty days after a record's Created Time. That is correct and it stays. What
-- was not correct is that `listings_cache` **mirrored** the prune: its
-- reconciliation step deleted every row the walk no longer saw, so the
-- product's entire inventory sat on a thirty-day fuse with no copy anywhere.
--
-- Measured on 2026-08-25:
--
--   2026-08-19   148 listings, spanning 2026-07-23 → 2026-08-04
--   2026-08-25    51 listings, ALL from one evening's intake (2026-08-04)
--   2026-09-04     0 listings — the next purge takes the rest
--
-- The July records are gone from Airtable and from here, and nothing else in
-- the database can rebuild them: `listing_enrichment.values` holds only image
-- URLs, and `listing_geocodes` is keyed by an address hash and carries no street
-- address. 467 listings' photographs survive in `listing_images` with no record
-- to attach them to.
--
-- So the cache becomes an archive. A row that vanishes *because it aged out* is
-- kept and stamped `archived_at`; a row that vanishes while it is still inside
-- the window was deleted on purpose and is still removed. See
-- `planRetention` in `_shared/listingsCache.pure.ts`.
--
-- Additive and reversible. Existing rows are live (`archived_at is null`) and
-- behave exactly as before.
-- ---------------------------------------------------------------------------

alter table public.listings_cache
  add column if not exists archived_at timestamptz;

comment on column public.listings_cache.archived_at is
  'Set when Airtable''s 30-day purge removed the record upstream. The listing is still served; it is simply no longer in the working table. Null means live in Airtable.';

-- The read pages `created_time desc, listing_id`; archived rows are served
-- alongside live ones, so this index covers the whole set rather than a slice.
create index if not exists listings_cache_archived_idx
  on public.listings_cache (table_key, archived_at)
  where archived_at is not null;

-- ---------------------------------------------------------------------------
-- Evidence that the purge is still running.
--
-- The automation lives in Airtable and cannot be asserted from here, so the
-- sync records its *effect* instead: if it runs daily, nothing in the live table
-- is ever much older than thirty days. If it stops, the oldest live record ages
-- past the boundary and keeps going.
--
-- Worth recording because the automation has already been off once — it shipped
-- as a draft with an empty Run script node and had to be pasted in by hand — and
-- nothing in the product would have noticed.
-- ---------------------------------------------------------------------------

alter table public.listings_cache_sync
  add column if not exists archived_count integer,
  add column if not exists oldest_live_created_time timestamptz,
  add column if not exists retention_effective boolean,
  add column if not exists retention_note text;

comment on column public.listings_cache_sync.retention_effective is
  'False when the oldest record Airtable still holds is past the 30-day window — i.e. the purge automation has probably stopped. Null before the first sync that measured it.';
comment on column public.listings_cache_sync.oldest_live_created_time is
  'Created Time of the oldest record the last walk saw in Airtable. The purge should keep this within 30 days.';
