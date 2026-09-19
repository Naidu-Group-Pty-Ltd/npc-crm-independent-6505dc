-- The OpenStreetMap amenity register: schools, healthcare, shopping,
-- recreation, restaurants and rail transit, loaded per (category, state)
-- from a public Overpass instance on a daily schedule and read locally at
-- enrichment time.
--
-- Why a register and not a request-time call: measured 16 Sep 2026 from
-- this project's own egress (pg_net ids in
-- docs/integrations/GEOCODING_WITHOUT_GOOGLE.md §14), the main Overpass
-- instance 406s this egress at its front door, and the kumi mirror served
-- a hospital query in under two seconds and then queued the SAME query
-- past 25 s an hour later. A report's location figures cannot wait on a
-- free mirror's load — the sanctions register, GTFS stops, crime and
-- sales-median registers all answer that shape the same way: load on a
-- schedule, read locally, and a queueing mirror delays a background retry
-- rather than a report.
--
-- The shape enforces three rules.
--
-- **A row is keyed (category, osm_type, osm_id)**, not osm_id alone: one
-- OSM element can satisfy two categories (a school whose grounds are also
-- a mapped park), and each category's slice owns its own copy — exactly
-- as the same place answered both a `school` and a `park` Google Places
-- query before this.
--
-- **`school_sector` is stated by the element's own tags or it is null.**
-- The Google mapper wrote 'Government' for every school it returned; the
-- register never asserts a sector the source does not carry.
--
-- **The load is asserted by its effect.** One `amenity_register_syncs`
-- row per slice attempt; the loader upserts under its sync id and prunes
-- other sync ids only after every batch lands, so a run that dies leaves
-- the previous load standing and a ledger row that never reads
-- succeeded. The reading treats a slice whose newest successful load is
-- older than its ceiling as unavailable rather than quietly current —
-- zero rows for a state never loaded must not read as "no schools here".

create table if not exists public.amenity_register (
  category text not null check (category in ('transit', 'schools', 'healthcare', 'shopping', 'recreation', 'restaurants')),
  osm_type text not null check (osm_type in ('node', 'way')),
  osm_id bigint not null check (osm_id > 0),
  name text,
  address text,
  postcode text check (postcode is null or postcode ~ '^[0-9]{4}$'),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  state text not null check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT')),
  school_sector text check (school_sector is null or school_sector in ('Government', 'Catholic', 'Independent', 'Other')),
  sync_id uuid not null,
  loaded_at timestamptz not null default now(),
  primary key (category, osm_type, osm_id)
);

comment on table public.amenity_register is
  'OpenStreetMap amenities per category and state, refreshed daily from a public Overpass instance and read locally at enrichment time. school_sector null means the element''s tags state no sector, never an unknown guessed one. © OpenStreetMap contributors, ODbL 1.0.';

create index if not exists amenity_register_cat_lat_lon
  on public.amenity_register (category, lat, lon);
create index if not exists amenity_register_slice
  on public.amenity_register (category, state, sync_id);

create table if not exists public.amenity_register_syncs (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('transit', 'schools', 'healthcare', 'shopping', 'recreation', 'restaurants')),
  state text not null check (state in ('NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  rows_written integer,
  detail jsonb not null default '{}'::jsonb,
  error text
);

comment on table public.amenity_register_syncs is
  'One row per amenity register slice load attempt. A slice whose latest successful load is older than the freshness ceiling is read as unavailable, and a failed run leaves the previous load standing.';

create index if not exists amenity_register_syncs_slice
  on public.amenity_register_syncs (category, state, status, finished_at desc);

alter table public.amenity_register enable row level security;
alter table public.amenity_register_syncs enable row level security;

-- The daily refresh: one pg_cron job per state, each posting one
-- amenity-register-ingest invocation that walks the six categories for
-- that state (rotating its starting category by day so a budget-clipped
-- tail never starves). Same construction as market_sales_refresh: the
-- URL and headers resolve inside the function so the job body carries no
-- secret and no project literal.

create or replace function public.amenity_register_refresh(stage_body jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
  v_req bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  if v_url is null or length(v_url) = 0 then
    raise exception 'amenity_register_refresh: supabase_url not configured in vault';
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/amenity-register-ingest',
    headers := public.cron_service_role_headers(),
    body := coalesce(stage_body, '{}'::jsonb),
    timeout_milliseconds := 150000
  ) into v_req;
  return v_req;
end;
$$;

comment on function public.amenity_register_refresh(jsonb) is
  'Posts one amenity-register-ingest state stage from pg_cron. Slices are upsert-then-prune, so a day on which OpenStreetMap changed nothing changes nothing.';

-- Callable by the cron runner alone. All three grantable roles are named
-- because PUBLIC alone leaves the anon/authenticated default-privilege
-- grants standing (the 20261129090000 lesson, enforced by
-- check-migration-security).
revoke all on function public.amenity_register_refresh(jsonb) from public, anon, authenticated;
grant execute on function public.amenity_register_refresh(jsonb) to service_role;

do $$
declare
  jobs constant jsonb := '[
    ["amenity-register-refresh-nsw", "0 16 * * *",  {"state": "NSW"}],
    ["amenity-register-refresh-vic", "6 16 * * *",  {"state": "VIC"}],
    ["amenity-register-refresh-qld", "12 16 * * *", {"state": "QLD"}],
    ["amenity-register-refresh-sa",  "18 16 * * *", {"state": "SA"}],
    ["amenity-register-refresh-wa",  "24 16 * * *", {"state": "WA"}],
    ["amenity-register-refresh-tas", "30 16 * * *", {"state": "TAS"}],
    ["amenity-register-refresh-nt",  "36 16 * * *", {"state": "NT"}],
    ["amenity-register-refresh-act", "42 16 * * *", {"state": "ACT"}]
  ]'::jsonb;
  j jsonb;
  jid bigint;
begin
  for j in select * from jsonb_array_elements(jobs) loop
    for jid in select jobid from cron.job where jobname = j->>0 loop
      perform cron.unschedule(jid);
    end loop;
    perform cron.schedule(
      j->>0,
      j->>1,
      format('select public.amenity_register_refresh(%L::jsonb);', (j->2)::text)
    );
    raise notice 'Scheduled %.', j->>0;
  end loop;
end $$;
