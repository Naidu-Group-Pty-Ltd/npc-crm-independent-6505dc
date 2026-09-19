-- Regional population reference — what the timeliness layer reads for real
-- population levels and growth, per Statistical Area Level 2.
--
-- Loaded by the abs-regional-ingest edge function from the ABS "Regional
-- population" release datacube (32180DS0003: ERP at 30 June by SA2,
-- 2001–2025; layout transcribed from the real workbook 2026-09-06,
-- acquisition log in docs/reports/REGIONAL_TRENDS.md). abs.gov.au answers
-- this project's egress directly (measured from a deployed probe), so the
-- function fetches the cube itself — the abs-poa-ingest pattern.
--
-- Two measured rules:
--  * The file's ".. not applicable" marker (present on exactly one SA2 —
--    Norfolk Island's pre-inclusion years) is an ABSENT observation, never
--    zero: no row is written for it.
--  * A zero IS a real value — some SA2s (industrial, parkland) genuinely
--    hold nobody, and the 2025 column's minimum is a measured 0.

create table if not exists public.abs_sa2_population (
  sa2_code text not null check (sa2_code ~ '^[0-9]{9}$'),
  -- ERP at 30 June of this year, from the release named in abs_sa2_meta.
  year integer not null check (year between 1990 and 2100),
  erp integer not null check (erp >= 0),
  primary key (sa2_code, year)
);

comment on table public.abs_sa2_population is
  'Estimated resident population at 30 June per SA2 per year, from the ABS Regional population release datacube (loaded by abs-regional-ingest). A year the file marks ".." has no row — absent, never zero.';

create table if not exists public.abs_sa2_meta (
  sa2_code text primary key check (sa2_code ~ '^[0-9]{9}$'),
  sa2_name text not null,
  state_name text not null,
  sa3_name text,
  sa4_name text,
  gccsa_name text,
  -- The ABS release the rows came from, e.g. '2024-25' — the data's own
  -- vintage travels with it; freshness of a load is not currency of data.
  release text not null,
  first_year integer not null,
  last_year integer not null,
  loaded_at timestamptz not null default now()
);

-- Resolved coordinate → SA2 lookups (the ABS ASGS2021 geoserver answers a
-- point query; measured from this project's egress 2026-09-06). Keyed on a
-- 3-decimal-place rounded coordinate (~110 m) — SA2s are small enough that
-- a coarser cell would span boundaries. Only successful resolutions are
-- written; a transport failure is never cached.
create table if not exists public.sa2_point_cache (
  cache_key text primary key,
  sa2_code text not null check (sa2_code ~ '^[0-9]{9}$'),
  sa2_name text not null,
  resolved_at timestamptz not null default now()
);

create table if not exists public.abs_regional_sync (
  id bigint generated always as identity primary key,
  detail jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.abs_sa2_population enable row level security;
alter table public.abs_sa2_meta enable row level security;
alter table public.sa2_point_cache enable row level security;
alter table public.abs_regional_sync enable row level security;
