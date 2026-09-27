-- @effect: select 1 from public.template_master_refresh_repairs where repair = '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed'
-- The line above is this file's own statement of what is true once it has
-- run: one row per database, written whether or not there was anything to
-- repair, so the drift report can tell "ran and found nothing" from "never
-- ran". Read-only by construction.
--
-- Bring forward the active adopted masters that a library refresh judged
-- BEFORE its seed had run — and nothing else.
--
-- ## What went wrong
--
-- Every library release since v15 is two migrations. The SEED writes the
-- library's rows and, first, a `template_library_release_baselines` row per
-- entry: the digest of what the entry held before this release overwrote it.
-- The REFRESH a version later compares each tenant's active master against
-- that baseline, and replaces only a master that is PROVEN an unedited copy.
--
-- Run without its seed, a refresh finds no baseline and entries still holding
-- the previous release. Every unedited master then reads `already_current`
-- (it matches the entry as it stands) or `deferred_no_baseline`, nothing is
-- replaced — and the refresh is recorded, so nothing ever runs it again once
-- the seed lands. The masters stay on the old release for good: the next
-- release's refresh compares them against ITS baseline, which is the release
-- they missed, and files every one of them as `deferred_customised`.
--
-- That happened. Mission Control sends a clone the prime's migrations in
-- version order, but until 23 Sep 2026 a seed it had held back — too large to
-- read, so nothing could say what it created — did not hold back the refresh
-- behind it. Measured 23–26 Sep 2026: NPC Test and Preflight Property Group
-- recorded the v16–v22 refreshes before their seeds, and
-- `npc-client-dashboard` several of the later ones; on the CRM clone the v15
-- refresh failed for want of the baseline table and blocked it instead. The
-- seeds are landing now, statement by statement, behind refreshes that have
-- already decided. The lane no longer sends a refresh ahead of its seed (a held
-- version is a barrier, and a refresh that names its seed waits for it), so
-- this repairs what it already did; it does not stop it happening again.
--
-- ## What this decides, and why that is safe
--
-- A release's refresh ran EARLY on a database when that database holds one of
-- its decisions recorded before the release's own baseline was captured:
-- `decided_at < captured_at` for the same entry and release. Measured per
-- database, from the rows the two migrations themselves wrote — never from a
-- ledger, a clock or a list of clones. Wherever every seed ran before its
-- refresh, no release is early and this migration changes nothing.
--
-- A master is refreshed only when BOTH hold:
--
--   * its schema, `tokens.colors` aside, is byte-for-byte what the library
--     held immediately before one of those early releases — the refresh's own
--     proof that a copy is unedited, asked of the release that should have
--     asked it; and
--   * that release's refresh never judged it properly: it has no decision for
--     that release recorded after the baseline existed. A master a proper
--     refresh replaced and an operator then restored from its snapshot has one,
--     and is left exactly as the operator left it.
--
-- It is brought to what its entry holds NOW — the state it would be in had
-- every refresh run after its seed, because an unedited copy is replaced at
-- every release — carrying its own palette forward exactly as each refresh
-- does. Anything else it touched is recorded and left alone:
-- `already_current` where it already matches the entry, `deferred_customised`
-- where it matches none of the releases it missed, which is a tenant's edit.
--
-- The one case it cannot see: a master adopted in the window between an early
-- refresh and its seed, on a database where that refresh found no master at
-- all to judge — nothing then records that the refresh ran early. It is an
-- unedited copy of the old release, and the next release's refresh will list
-- it as deferred with the keys that differ.
--
-- ## What it touches
--
-- Only active `report_templates` rows adopted from a published library entry,
-- the set every refresh reads. Each one it examines gets a decision row under
-- this migration's name and a snapshot of what it held beforehand, so every
-- change here can be listed and undone exactly (queries at the end).
--
-- It names every seed and refresh whose work it judges, in executable SQL,
-- which is how the fleet lane knows not to send it to a clone until all of
-- them have landed there. Idempotent: a second run finds the masters it
-- refreshed already current and records nothing new.

-- ── The tables it reads and writes, exactly as the releases define them ─────
--
-- Repeated rather than assumed, so this can never fail for want of a table the
-- way the v15 refresh failed on the CRM clone. Each is a no-op wherever the
-- seed or refresh that owns it has run — which, by the ordering above, is
-- everywhere this runs.
create table if not exists public.template_library_release_baselines (
  entry_id uuid not null,
  release text not null,
  schema_digest text not null,
  captured_at timestamptz not null default now(),
  primary key (entry_id, release)
);

alter table public.template_library_release_baselines enable row level security;

create table if not exists public.template_master_refresh_decisions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  release text not null,
  entry_id uuid not null,
  verdict text not null check (verdict in (
    'already_current', 'refreshed', 'deferred_customised', 'deferred_no_baseline'
  )),
  decided_at timestamptz not null default now(),
  differing_keys text[] not null default '{}',
  unique (template_id, release)
);

alter table public.template_master_refresh_decisions enable row level security;

create table if not exists public.report_template_refresh_snapshots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  migration text not null,
  taken_at timestamptz not null default now(),
  schema jsonb not null,
  config jsonb not null,
  differing_keys text[] not null default '{}',
  unique (template_id, migration)
);

alter table public.report_template_refresh_snapshots enable row level security;

-- ── One row per database: what this found and what it did ─────────────────
create table if not exists public.template_master_refresh_repairs (
  repair text primary key,
  ran_at timestamptz not null default now(),
  -- The refreshes that ran before their seeds on this database. Empty is the
  -- answer everywhere the order held.
  early_refreshes text[] not null default '{}',
  examined integer not null default 0,
  refreshed integer not null default 0,
  already_current integer not null default 0,
  deferred_customised integer not null default 0
);

comment on table public.template_master_refresh_repairs is
  'One row per database per repair of library refreshes that ran before their seeds: which refreshes were early here, and what happened to the masters they misjudged. Service role only.';

alter table public.template_master_refresh_repairs enable row level security;

-- ── Classify ──────────────────────────────────────────────────────────────
-- Session-scoped rather than `on commit drop`, for the reason the refreshes
-- give: a runner that gives each statement its own transaction would destroy
-- it between the classification and the statements that read it. Dropped
-- defensively first and explicitly at the end.
drop table if exists _early_refresh_releases;
create temporary table _early_refresh_releases as
with releases(seed_release, refresh_migration) as (
  values
    ('20261204020000_seed_template_library_v15_running_head_and_columns',
     '20261204030000_refresh_active_masters_from_library_v15'),
    ('20261207000000_seed_template_library_v16_verdict_and_running_head',
     '20261207010000_refresh_active_masters_from_library_v16'),
    ('20261208000000_seed_template_library_v17_running_head_chapter_only',
     '20261208010000_refresh_active_masters_from_library_v17'),
    ('20261209000000_seed_template_library_v18_assessment_share_of_grade',
     '20261209010000_refresh_active_masters_from_library_v18'),
    ('20261212000000_seed_template_library_v19_placeholder_words',
     '20261212010000_refresh_active_masters_from_library_v19'),
    ('20261219060000_seed_template_library_v20_continuous_front_matter',
     '20261219070000_refresh_active_masters_from_library_v20'),
    ('20261222090000_seed_template_library_v21_cover_photograph',
     '20261222100000_refresh_active_masters_from_library_v21'),
    ('20261223090000_seed_template_library_v22_floor_plan',
     '20261223100000_refresh_active_masters_from_library_v22')
)
select r.seed_release, r.refresh_migration
from releases r
where exists (
  select 1
  from public.template_master_refresh_decisions d
  join public.template_library_release_baselines b
    on b.entry_id = d.entry_id
   and b.release = d.release
  where d.release = r.seed_release
    and d.decided_at < b.captured_at
);

drop table if exists _early_refresh_classified;
create temporary table _early_refresh_classified as
with adopted as (
  select
    t.id as template_id,
    e.id as entry_id,
    t.schema as row_schema,
    t.config as row_config,
    e.schema as entry_schema,
    md5((t.schema #- '{tokens,colors}')::text) as row_digest,
    md5((e.schema #- '{tokens,colors}')::text) as entry_digest
  from public.report_templates t
  join public.template_library_entries e
    on (t.config -> 'libraryLineage' ->> 'entryId') = e.id::text
  where t.is_active
    and e.status = 'published'
    and e.schema is not null
),
judged as (
  select
    a.*,
    -- An exact copy of what the library held before an early release, which
    -- that release's refresh never judged properly.
    exists (
      select 1
      from public.template_library_release_baselines b
      join _early_refresh_releases x on x.seed_release = b.release
      where b.entry_id = a.entry_id
        and b.schema_digest = a.row_digest
        and not exists (
          select 1
          from public.template_master_refresh_decisions p
          where p.template_id = a.template_id
            and p.release = b.release
            and p.decided_at >= b.captured_at
        )
    ) as missed_unedited,
    -- Judged by an early refresh at all, whatever that refresh concluded.
    exists (
      select 1
      from public.template_master_refresh_decisions d
      join _early_refresh_releases x on x.seed_release = d.release
      join public.template_library_release_baselines b
        on b.entry_id = d.entry_id
       and b.release = d.release
      where d.template_id = a.template_id
        and d.decided_at < b.captured_at
    ) as judged_early
  from adopted a
)
select
  j.template_id,
  j.entry_id,
  j.row_schema,
  j.row_config,
  j.entry_schema,
  case
    when j.row_digest = j.entry_digest then 'already_current'
    when j.missed_unedited then 'refreshed'
    else 'deferred_customised'
  end as verdict,
  coalesce(
    (
      select array_agg(k order by k)
      from jsonb_object_keys(
        (j.row_schema #- '{tokens,colors}') || (j.entry_schema #- '{tokens,colors}')
      ) as k
      where (j.row_schema #- '{tokens,colors}') -> k
        is distinct from (j.entry_schema #- '{tokens,colors}') -> k
    ),
    '{}'::text[]
  ) as differing_keys,
  -- The release that produced what the entry holds now: the newest seed that
  -- CHANGED it, which is the newest whose "before" is not the entry as it
  -- stands. A seed that left an entry alone is not the release its copy
  -- carries — the refresh after such a seed finds the copy current and leaves
  -- the name as it was, and this writes what that sequence would have. Read
  -- rather than named, because a release merged after this file may already
  -- have landed wherever it runs.
  (
    select max(b.release)
    from public.template_library_release_baselines b
    where b.entry_id = j.entry_id
      and b.schema_digest <> j.entry_digest
  ) as carries_release
from judged j
where j.missed_unedited or j.judged_early;

-- ── Record the decision for every master it examined ─────────────────────
insert into public.template_master_refresh_decisions
  (template_id, release, entry_id, verdict, differing_keys)
select
  c.template_id,
  '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed',
  c.entry_id,
  c.verdict,
  c.differing_keys
from _early_refresh_classified c
on conflict (template_id, release) do nothing;

-- ── Snapshot every examined row, before anything changes ──────────────────
insert into public.report_template_refresh_snapshots
  (template_id, migration, schema, config, differing_keys)
select
  c.template_id,
  '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed',
  c.row_schema,
  c.row_config,
  c.differing_keys
from _early_refresh_classified c
on conflict (template_id, migration) do nothing;

-- ── Refresh ONLY what was proven an unedited copy of a missed release ─────
--
-- The same statement every refresh ends with: the row's own palette carried
-- forward, `entryVersion` synced, and `releaseApplied` naming the release this
-- copy now actually carries.
update public.report_templates t
set
  schema = jsonb_set(
    c.entry_schema,
    '{tokens,colors}',
    coalesce(t.schema -> 'tokens' -> 'colors', c.entry_schema -> 'tokens' -> 'colors', '{}'::jsonb)
  ),
  config = jsonb_set(
    jsonb_set(
      t.config,
      '{libraryLineage,entryVersion}',
      to_jsonb(e.version)
    ),
    '{libraryLineage,releaseApplied}',
    to_jsonb(coalesce(c.carries_release, '20261223090000_seed_template_library_v22_floor_plan'))
  ),
  updated_at = now()
from _early_refresh_classified c
join public.template_library_entries e on e.id = c.entry_id
where t.id = c.template_id
  and c.verdict = 'refreshed';

-- ── Say what it found, here, once ─────────────────────────────────────────
insert into public.template_master_refresh_repairs
  (repair, early_refreshes, examined, refreshed, already_current, deferred_customised)
select
  '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed',
  coalesce(
    (select array_agg(x.refresh_migration order by x.refresh_migration) from _early_refresh_releases x),
    '{}'::text[]
  ),
  (select count(*) from _early_refresh_classified),
  (select count(*) from _early_refresh_classified where verdict = 'refreshed'),
  (select count(*) from _early_refresh_classified where verdict = 'already_current'),
  (select count(*) from _early_refresh_classified where verdict = 'deferred_customised')
on conflict (repair) do nothing;

drop table if exists _early_refresh_classified;
drop table if exists _early_refresh_releases;

-- What this found on a database, in one row:
--
--   select * from public.template_master_refresh_repairs
--   where repair = '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed';
--
-- Every master it examined, and what it decided:
--
--   select template_id, verdict, differing_keys
--   from public.template_master_refresh_decisions
--   where release = '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed'
--   order by verdict, template_id;
--
-- To restore one row exactly as it stood before this migration:
--
--   update public.report_templates t
--   set schema = s.schema, config = s.config, updated_at = now()
--   from public.report_template_refresh_snapshots s
--   where s.template_id = t.id
--     and s.migration = '20261226100000_refresh_masters_whose_refresh_ran_before_its_seed'
--     and t.id = '<the template id>';
