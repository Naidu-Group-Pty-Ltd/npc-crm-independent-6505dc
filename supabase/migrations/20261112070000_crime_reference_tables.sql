-- Recorded-crime reference rows — what crime-statistics-service reads
-- instead of inventing.
--
-- Loaded by the crime-data-ingest edge function from the two published
-- datasets (both verified by execution 2026-09-06, acquisition log in
-- docs/reports/CRIME_SOURCES.md):
--   * NSW — BOCSAR "recorded criminal incidents by month by postcode"
--     (area_kind 'postcode', plus one 'state_total' row per offence
--     category summed over every postcode in the same file);
--   * QLD — QPS "reported offence numbers by LGA" (area_kind 'lga', plus
--     'state_total' rows).
--
-- Rows are compact windows over the file's own months (last 12, prior 12,
-- last six complete calendar years) — arithmetic, never estimates — and
-- latest_month/series_from are the DATA'S own vintage, not the load time.

create table if not exists public.crime_reference (
  state text not null check (state in ('NSW', 'QLD')),
  area_kind text not null check (area_kind in ('postcode', 'lga', 'state_total')),
  area text not null,
  offence text not null,
  months12 integer not null,
  prior12 integer not null,
  year_totals jsonb not null,
  latest_month text not null check (latest_month ~ '^[0-9]{4}-[0-9]{2}$'),
  series_from text not null check (series_from ~ '^[0-9]{4}-[0-9]{2}$'),
  source text not null,
  -- The area under the same normalised-token rule the DA lookup uses
  -- (developmentActivity.pure.ts), written at ingest so a caller's LGA name
  -- resolves in ONE indexed lookup — fetching every row to match in code
  -- is how the PostgREST max-rows cap silently truncates (the §25 lesson).
  area_token text not null,
  loaded_at timestamptz not null default now(),
  primary key (state, area_kind, area, offence)
);

create index if not exists crime_reference_token_idx
  on public.crime_reference (state, area_kind, area_token);

comment on table public.crime_reference is
  'Recorded-crime windows per area and offence, loaded from BOCSAR (NSW postcode) and QPS (QLD LGA) open data by crime-data-ingest. latest_month is the dataset''s own vintage.';

create index if not exists crime_reference_area_idx
  on public.crime_reference (state, area_kind, area);

create table if not exists public.crime_sync (
  id bigint generated always as identity primary key,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.crime_reference enable row level security;
alter table public.crime_sync enable row level security;

-- The state per-100k benchmark, computed at ingest with a NAMED denominator:
-- for NSW, the 2021 Census usual-resident population of exactly the
-- postcodes present in the BOCSAR file (a join on the file's own keys —
-- never a hand-typed state population, never a prefix guess). A state whose
-- register carries no joinable population keeps population null and offers
-- count-change context only.
create table if not exists public.crime_state_benchmarks (
  state text primary key check (state in ('NSW', 'QLD')),
  total12 integer not null,
  population bigint,
  rate_per_100k numeric,
  denominator text,
  latest_month text not null check (latest_month ~ '^[0-9]{4}-[0-9]{2}$'),
  computed_at timestamptz not null default now()
);

alter table public.crime_state_benchmarks enable row level security;
