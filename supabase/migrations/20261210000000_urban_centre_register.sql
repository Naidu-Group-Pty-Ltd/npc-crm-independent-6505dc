-- The urban centre a commute should be measured to.
--
-- `cbdDestination.pure.ts` resolves the STATE CAPITAL and has named this gap
-- in its own header since ME-5: "whether the state capital is the right
-- destination for a given property at all. For a Moranbah or a Gympie it
-- plainly is not, and choosing an appropriate centre is its own piece of
-- work."
--
-- Measured on the 9 Hollow Street Compass of 20 Sep 2026: Golden Square is a
-- suburb of Bendigo, its commute was measured to MELBOURNE at 114 minutes, and
-- `COMMUTE_ANCHORS` ends at [110, 0] — so a property five minutes from
-- Bendigo's CBD scored 0 of 100 on its access to anything, while the same
-- document's prose described that access to Bendigo twice.
--
-- The register is the ABS's own: Significant Urban Areas, the ASGS
-- classification of Australia's urban centres of 10,000 people and over.
-- `resolveOneReportGeography.ts` has queried the SUA layer at geo.abs.gov.au
-- since ME-5 and already stores which SUA a coordinate is in; what the
-- platform has never held is a POINT for that centre, which is what a commute
-- needs. `urban-centre-register-ingest` loads it from the same service and the
-- same release.
--
-- ## What this table is NOT
--
-- It is not authority to score. A property whose centre this register does not
-- name keeps today's measurement to the capital, marked as not its own centre,
-- and `scoreLocation` excludes that reading rather than rating it — so a
-- deployment whose ingest has never run is correct before it is complete.
-- `CLONE_PROVISIONING_GAPS.md`'s rule: a feature the migrations have not
-- reached degrades rather than failing. Nothing is seeded here for the same
-- reason that document records — the rows a migration INSERTs do not travel
-- to a clone, so a seeded register would be present on the prime and absent
-- everywhere else while looking, from the ledger, exactly like it was there.

create table if not exists public.urban_centre_register (
  -- `sua_code_2021`. The ABS's own identifier, so a re-load cannot create a
  -- second row for one centre and a renamed centre keeps its identity.
  sua_code text primary key,
  sua_name text not null check (length(btrim(sua_name)) > 0),
  state text not null check (state in ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT')),
  lat double precision not null check (lat between -44.0 and -9.0),
  lng double precision not null check (lng between 112.0 and 154.0),
  -- How the point was arrived at. A capital's CBD is a placed coordinate; an
  -- SUA's is the centre of a published polygon, whose error is bounded by the
  -- size of the urban area it describes. A reader comparing a five-minute
  -- Bendigo commute with a forty-minute Sydney one should be able to see that
  -- the two points were chosen differently.
  point_basis text not null check (point_basis in ('capital_cbd', 'sua_centroid')),
  -- The data's own vintage travels with it: freshness of a load is not
  -- currency of the data. `SANCTIONS_LIST_LOADING.md`'s rule.
  asgs_release text not null,
  source text not null,
  loaded_at timestamptz not null default now()
);

comment on table public.urban_centre_register is
  'ABS Significant Urban Areas with a point for each centre, so a commute is measured to the property''s own urban centre rather than to the state capital. Loaded by urban-centre-register-ingest. Service role writes; readable by the report pipeline.';

create index if not exists urban_centre_register_state_idx
  on public.urban_centre_register (state);

alter table public.urban_centre_register enable row level security;

-- One run of the loader, so a reader can tell "never loaded" from "loaded and
-- found nothing" — the distinction `pep_officeholder_syncs` exists for, and
-- the one an empty register is otherwise indistinguishable from.
create table if not exists public.urban_centre_syncs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  asgs_release text,
  centres_written integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  error text
);

comment on table public.urban_centre_syncs is
  'One row per urban-centre register load. An empty register with no succeeded row here has never been loaded, which is a different fact from a load that found nothing.';

alter table public.urban_centre_syncs enable row level security;
