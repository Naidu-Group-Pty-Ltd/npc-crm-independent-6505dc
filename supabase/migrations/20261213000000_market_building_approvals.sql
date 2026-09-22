-- The national supply register: ABS Building Approvals by area and month.
--
-- @effect: select 1 from pg_class where relkind = 'r' and relname = 'market_building_approvals'
--
-- Why this table exists. `REPORT_PRESENTATION_PROGRAMME.md` W3 states the
-- rule — every property in Australia gets a development reading, the grain is
-- the publisher's, the scorer prices the grain, and coverage travels with the
-- answer. Development evidence today is one state's development-application
-- register and nothing at all for the other seven jurisdictions, while the
-- statewide report carries `**Supply Pipeline Risk:** [New housing supply vs
-- demand balance]`: a bracketed slot with no register behind it, which is the
-- shape that put `450 m²`, `8.5 m` and `0.5:1` into a Queensland property's
-- document under New South Wales instrument names.
--
-- ABS Building Approvals is the one free, keyless, national, sub-state,
-- monthly measure of approved dwelling supply, under CC BY 4.0. It is the
-- floor beneath every jurisdiction, as RES_DWELL_ST is the floor beneath
-- every price series.
--
-- Loaded by `market-sales-ingest` stage `approvals`, which DISCOVERS the
-- dataflow from the ABS's own catalogue rather than naming one: the version
-- is part of an SDMX identifier, the ABS reissues it, and a stale constant
-- fetches a 404 that reads exactly like an outage. See
-- `_shared/reports/market/openData/absBuildingApprovals.pure.ts`.
--
-- Four rules the loader holds and this schema records:
--
--   * an approval is a council decision, not a building — approved dwellings
--     are not commenced and commenced dwellings are not completed, and the
--     ABS counts only the first;
--   * `dwelling_units` is NULL where the ABS published nothing and 0 only
--     where it published a zero, because a council that approved nothing in
--     August is a fact and a suppressed month is not;
--   * `state` is nullable because the ABS's own area codes do not all carry
--     one, and guessing it from a label would invent a fact;
--   * the primary key is the publisher's own (area, month, building type),
--     so a re-run of a month the ABS has since revised replaces it rather
--     than accumulating two answers.
--
-- Nothing here is seeded. The rows a migration INSERTs do not travel to a
-- clone (docs/operations/CLONE_PROVISIONING_GAPS.md), so the table is created
-- empty on every deployment and the ingest fills it; until it does, every
-- report reads `Not searched` and is forbidden from stating a figure.

create table if not exists public.market_building_approvals (
  area_kind      text        not null check (area_kind in ('sa2', 'lga', 'state', 'national')),
  -- The publisher's own code and label, kept as published.
  area_code      text        not null,
  area           text        not null,
  -- `salesAreaToken`, the same lookup rule the sales and crime registers use,
  -- so a cadastre LGA resolves in one indexed lookup.
  area_token     text        not null,
  state          text            null check (state is null or state in
                   ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'AU')),
  period         text        not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  building_type  text        not null check (building_type in
                   ('house', 'other_residential', 'total_residential')),
  -- NULL where the ABS published nothing. Never zero for an absence.
  dwelling_units integer         null check (dwelling_units is null or dwelling_units >= 0),
  value_aud      numeric         null check (value_aud is null or value_aud >= 0),
  source         text        not null,
  source_url     text        not null,
  licence        text        not null,
  loaded_at      timestamptz not null default now(),
  primary key (area_kind, area_code, period, building_type)
);

create index if not exists market_building_approvals_token_idx
  on public.market_building_approvals (area_kind, area_token, period);

comment on table public.market_building_approvals is
  'ABS Building Approvals by area and month, loaded by market-sales-ingest '
  '(stage "approvals") under CC BY 4.0. An approval is a council decision, not '
  'a building: approved dwellings are not commenced and commenced dwellings '
  'are not completed. A month the ABS suppressed is NULL, never zero.';

comment on column public.market_building_approvals.dwelling_units is
  'Dwelling units approved. NULL where the publisher released no figure; 0 only '
  'where it released a zero.';

comment on column public.market_building_approvals.area_kind is
  'The publisher''s own grain. The scorer prices it: a council figure is a '
  'lower-confidence measurement of a property''s market, never a substitute '
  'claiming to be the suburb.';

alter table public.market_building_approvals enable row level security;
