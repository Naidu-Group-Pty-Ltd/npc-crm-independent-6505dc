-- Real ABS reference data by Postal Area — the tables the demographic,
-- employment and SEIFA services read instead of inventing.
--
-- Loaded by scripts/abs/load-abs-poa-data.mjs from the ABS's published 2021
-- Census GCP DataPack (POA) and the SEIFA 2021 POA indexes (both CC BY 4.0).
-- Column values are the ABS's own; every derived rate names its numerator
-- and denominator in the loader. `reference_period` is the data's own
-- vintage — the assessListRecency rule: freshness of a load is not currency
-- of the data, so the served label comes from here, never from loaded_at.
--
-- Guarded with IF NOT EXISTS / ON CONFLICT so the migration is idempotent
-- with an out-of-band first load.

create table if not exists public.abs_census_poa (
  poa text primary key check (poa ~ '^[0-9]{4}$'),
  population integer,
  median_age numeric,
  median_rent_weekly integer,
  median_hh_income_weekly integer,
  median_personal_income_weekly integer,
  median_family_income_weekly integer,
  median_mortgage_monthly integer,
  avg_household_size numeric,
  owned_outright integer,
  owned_mortgage integer,
  rented integer,
  tenure_total integer,
  owner_occupier_rate numeric,
  renter_rate numeric,
  employed integer,
  unemployed integer,
  labour_force integer,
  not_in_labour_force integer,
  pop_15_plus integer,
  unemployment_rate numeric,
  participation_rate numeric,
  employment_to_pop_rate numeric,
  industries jsonb not null default '[]'::jsonb,
  occupations jsonb not null default '[]'::jsonb,
  reference_period text not null,
  source text not null,
  loaded_at timestamptz not null default now()
);

create table if not exists public.abs_seifa_poa (
  poa text primary key check (poa ~ '^[0-9]{4}$'),
  irsd_score numeric,
  irsd_decile integer check (irsd_decile between 1 and 10),
  irsad_score numeric,
  irsad_decile integer check (irsad_decile between 1 and 10),
  ier_score numeric,
  ier_decile integer check (ier_decile between 1 and 10),
  ieo_score numeric,
  ieo_decile integer check (ieo_decile between 1 and 10),
  usual_resident_population integer,
  caution boolean not null default false,
  crosses_state boolean not null default false,
  reference_period text not null,
  loaded_at timestamptz not null default now()
);

-- One row per load, with what the loader measured and verified.
create table if not exists public.abs_poa_sync (
  id uuid primary key default gen_random_uuid(),
  detail jsonb not null,
  created_at timestamptz not null default now()
);

-- Server-read reference data: the edge functions read with the service role;
-- no browser client has any business here.
alter table public.abs_census_poa enable row level security;
alter table public.abs_seifa_poa enable row level security;
alter table public.abs_poa_sync enable row level security;
