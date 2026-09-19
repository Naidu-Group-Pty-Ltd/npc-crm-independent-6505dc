-- Public transport stops, from each operator's own published GTFS feed.
--
-- Replaces the last fabricator named in audit §24: `public-transport-service`
-- returned a hard-coded landmark per STATE, ignoring the coordinate entirely
-- (every NSW property 450m from Central Station). It has answered
-- `sourceUnavailable` since that removal; this is the real source arriving.
--
-- Two rules are enforced by the shape.
--
-- **A stop is identified by (feed, stop_id), never by stop_id alone.** GTFS
-- ids are unique only within a feed, and this table holds several feeds:
-- NT's Darwin stop_id `12` and a NSW stop_id `12` are different objects.
--
-- **Mode is nullable and means "not established".** A stop's mode lives in
-- routes.txt, reachable only through stop_times.txt — 399 MB uncompressed for
-- NSW alone. Where a feed's structure does carry it, it is recorded; where it
-- does not, the column stays NULL and the reading omits mode rather than
-- guessing one. An invented mode is exactly the class this replaces.

create table if not exists public.transport_stops (
  feed text not null,
  stop_id text not null,
  stop_name text not null,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  -- GTFS location_type: 0/null stop, 1 station, 2 entrance, 3 generic node,
  -- 4 boarding area. Kept verbatim; the reading filters on it.
  location_type smallint,
  parent_station text,
  -- GTFS route_type of the routes serving this stop, where the feed's own
  -- structure establishes it. NULL means not established, never "unknown mode".
  route_type smallint,
  source_label text not null,
  loaded_at timestamptz not null default now(),
  primary key (feed, stop_id)
);

comment on table public.transport_stops is
  'Public transport stops as published in each GTFS feed, keyed (feed, stop_id) because GTFS ids are unique only within a feed. route_type NULL means the mode was not established by the feed, never an unknown or guessed mode.';

create index if not exists transport_stops_lat_lon on public.transport_stops (lat, lon);

-- One row per feed load. The load is asserted by its EFFECT the way the crime
-- ingest's retention is: what was fetched, how many stops were written, and
-- the feed's own published stamp where it carries one.
create table if not exists public.transport_feed_syncs (
  id uuid primary key default gen_random_uuid(),
  feed text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  stops_written integer,
  detail jsonb not null default '{}'::jsonb,
  error text
);

comment on table public.transport_feed_syncs is
  'One row per GTFS feed load attempt. A failed load is recorded as failed and never leaves a partially-trusted feed: the reading treats a feed whose latest load failed as unavailable.';

create index if not exists transport_feed_syncs_feed_started
  on public.transport_feed_syncs (feed, started_at desc);

alter table public.transport_stops enable row level security;
alter table public.transport_feed_syncs enable row level security;
