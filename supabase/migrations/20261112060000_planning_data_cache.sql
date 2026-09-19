-- Cache for planning-data-service — zoning, parcel and development readings
-- fetched from each jurisdiction's own planning services at a coordinate.
--
-- Rules carried from the §24 fabrication removal:
--  * only `data_quality = 'live'` rows are ever read back — the column
--    exists so a purge can target anything else by predicate, as
--    20261112020000 did for the four fabricated caches;
--  * the service caches a response only when every attempted cell settled
--    (a reading, or a definite absence with its reason) — a transport
--    failure is answered `unavailable` and never written here, because an
--    outage cached for a week is an outage served as though it were a fact.
--
-- The key is the coordinate to six decimal places (≈0.1 m), because zoning
-- is a property of the parcel under the point, not of a suburb.

create table if not exists public.planning_data_cache (
  cache_key text primary key,
  latitude double precision not null,
  longitude double precision not null,
  jurisdiction text,
  data jsonb not null,
  data_quality text not null default 'live' check (data_quality = 'live'),
  fetched_at timestamptz not null default now()
);

comment on table public.planning_data_cache is
  'Planning readings (zoning/parcel/development) per coordinate, fetched from state planning services by planning-data-service. Only live readings are stored; failures are never cached.';

create index if not exists planning_data_cache_fetched_at_idx
  on public.planning_data_cache (fetched_at);

-- Service-role access only: RLS on with no policies, the same posture as
-- the abs_* reference tables. Edge functions use the service key.
alter table public.planning_data_cache enable row level security;
