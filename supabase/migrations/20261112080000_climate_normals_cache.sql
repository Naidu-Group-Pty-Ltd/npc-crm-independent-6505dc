-- Cache for climate-data-service — SILO Data Drill readings per grid cell.
--
-- Keyed by the coordinate rounded to 0.05° (the Data Drill grid is ~5 km),
-- so neighbouring properties share one entry instead of re-fetching the
-- same cell. Only live readings are stored (the §24 rule: an outage is
-- answered `unavailable` and never cached), and rows carry the reading's
-- own windows — the 1991–2020 normal period and the recent 12-month span —
-- so currency is a property of the data, not of fetched_at.

create table if not exists public.climate_normals_cache (
  cache_key text primary key,
  latitude double precision not null,
  longitude double precision not null,
  data jsonb not null,
  data_quality text not null default 'live' check (data_quality = 'live'),
  fetched_at timestamptz not null default now()
);

comment on table public.climate_normals_cache is
  'SILO Data Drill climate readings (1991-2020 normals + recent 12 months) per ~5km grid cell, fetched by climate-data-service. Failures are never cached.';

create index if not exists climate_normals_cache_fetched_at_idx
  on public.climate_normals_cache (fetched_at);

alter table public.climate_normals_cache enable row level security;
