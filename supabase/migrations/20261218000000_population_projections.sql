-- The forward-demand register: each state and territory's OWN population
-- projection, by the area it publishes, series by series.
--
-- @effect: select 1 from pg_class where relkind = 'r' and relname = 'population_projections'
--
-- Why this table exists. `FORWARD_DEMAND_EVIDENCE.md` measured the national
-- floor on 22 Sep 2026: the ABS projects to capital city or rest of state and
-- no finer, so forward demand at a property's own area can only come from the
-- jurisdiction's own projection. Every state and territory publishes one, and
-- until this register every report read "No population projection has been
-- loaded by this deployment" — true, and a sentence about us.
--
-- Loaded by `market-sales-ingest` stage `projections`, one jurisdiction per
-- invocation (the loader's one-heavy-read rule), against the files
-- `scripts/market/state-projection-liveness.ts` measured from CI — never
-- against a layout typed from memory.
--
-- Five rules the loader holds and this schema records:
--
--   * **a projection is not a measurement.** It is an assumption set applied to
--     a base population. Nothing here is an `EvidencePoint`, nothing here is
--     scored, and a spec asserts no reader of this table constructs one;
--   * **the series is the publisher's own word and is never defaulted.** WA
--     publishes bands, Queensland publishes low, medium and high, others one.
--     `series` is part of the key, so no load can quietly keep one of them;
--   * **the base year is marked as the base.** A projection table usually
--     opens on the estimated resident population it starts from, which is a
--     measurement; `year_kind` separates it so no page prints an estimate
--     under a forward heading — the worst failure this register could commit;
--   * **the grain is the publisher's**, and a suburb is not an SA2 however
--     often the two coincide: `area_kind` carries the word the publisher used;
--   * **the key is the publisher's own** (edition, series, measure, area, year),
--     so a re-run of an edition replaces it and a new edition sits beside the
--     old rather than silently overwriting it.
--
-- Nothing here is seeded. The rows a migration INSERTs do not travel to a
-- clone (docs/operations/CLONE_PROVISIONING_GAPS.md), so the table is created
-- empty and the ingest fills it; until it does, every report keeps the
-- `not_loaded` sentence it has today.

create table if not exists public.population_projections (
  state        text        not null check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT')),
  -- The publisher's own name for the edition, e.g. its release title.
  release      text        not null check (length(trim(release)) > 0),
  -- The publisher's own series, scenario or band label. Never defaulted.
  series       text        not null check (length(trim(series)) > 0),
  measure      text        not null check (measure in ('persons', 'households', 'dwellings')),
  area_kind    text        not null check (area_kind in
                 ('sa2', 'sa3', 'sa4', 'lga', 'suburb', 'district', 'region', 'gccsa', 'state')),
  -- The publisher's own code where it publishes one; otherwise the area token.
  area_code    text        not null check (length(trim(area_code)) > 0),
  area         text        not null,
  -- `salesAreaToken`, the lookup rule every other register here uses.
  area_token   text        not null,
  year         integer     not null check (year between 1990 and 2100),
  -- `base` is the estimated population the projection starts from — a
  -- measurement, printed as one. `projected` is everything after it.
  year_kind    text        not null check (year_kind in ('base', 'projected')),
  value        numeric     not null check (value >= 0),
  publisher    text        not null,
  source_url   text        not null,
  licence      text            null,
  loaded_at    timestamptz not null default now(),
  primary key (state, release, series, measure, area_kind, area_code, year)
);

create index if not exists population_projections_token_idx
  on public.population_projections (state, area_kind, area_token);

create index if not exists population_projections_code_idx
  on public.population_projections (state, area_kind, area_code);

comment on table public.population_projections is
  'Each state and territory''s own population projection by the area it publishes, '
  'loaded by market-sales-ingest (stage "projections"). A projection is an assumption '
  'set applied to a base population, not a measurement: it is never scored, the '
  'publisher''s series is never defaulted, and the base year is marked as the base.';

comment on column public.population_projections.series is
  'The publisher''s own series, scenario or band label. Part of the key: a reading '
  'names every series it rests on and no load keeps one quietly.';

comment on column public.population_projections.year_kind is
  '"base" is the estimated resident population the projection starts from — a '
  'measurement, never printed under a forward heading. "projected" is every year after it.';

comment on column public.population_projections.area_kind is
  'The publisher''s own grain, in its own word. A suburb is not an SA2, and only SA2 '
  'and SA3 describe a property''s own area; anything coarser is a region it sits in.';

alter table public.population_projections enable row level security;
