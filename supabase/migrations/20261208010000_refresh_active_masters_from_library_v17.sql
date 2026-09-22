-- Bring the v17 catalogue to the ACTIVE `report_templates` rows that adopted
-- from the library — and to no others.
--
-- Identical in mechanism to the v15 refresh (`20261204030000`), which is the
-- point: the classification, the snapshot and the four verdicts are the safety
-- property, not something to re-invent per release. Only the release
-- identifiers change. Read that file's header for why a customised master is
-- left alone rather than overwritten, and for the queries that report what
-- this release did.
--
-- ## What v17 changes in a master, and why it is safe to carry forward
--
-- ONE correction, on the 39 masters that draw a running head rather than a
-- navigation rail. It neither adds, removes nor re-binds a block; it changes a
-- binding inside one text block.
--
--   * The report pages' running-head marker. v16 made it the part number plus
--     the chapter, which fixed the 29 pages of the 42 Patya Circuit report
--     that all read `Part 05 · Report` and produced twenty-six consecutive
--     pages of the 97 Poole Road report that all read `Part 07 · <chapter>`.
--     The body is one part, correctly — so across it the part number says
--     where the reader is twenty-six times and says nothing, while the chapter
--     says it once per chapter. The marker is now the chapter alone; the part
--     structure is on the contents page, which is where it varies.
--
-- No page can gain or lose one, no block moves, and no other format is
-- touched: the railed eleven draw the part as an eyebrow above the chapter
-- rather than a prefix beside it, and the other nine formats' 450 masters pass
-- no headMarker at all.
--
-- A row is refreshed only where it is PROVEN an unedited copy of what the
-- library last published, so a tenant who has adjusted that marker
-- keeps their version and is recorded as deferred. Idempotent.

-- ── The snapshot, kept as additional protection ───────────────────────────
--
-- Not a substitute for preservation: nothing below is replaced unless it was
-- proven unedited. This exists so that even a proven-safe replacement, and any
-- future release that gets the proof wrong, can be undone exactly.
create table if not exists public.report_template_refresh_snapshots (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  migration text not null,
  taken_at timestamptz not null default now(),
  schema jsonb not null,
  config jsonb not null,
  differing_keys text[] not null default '{}',
  -- One snapshot per template per release, so the ORIGINAL survives a second
  -- application and the restoring statement below is unambiguous.
  unique (template_id, migration)
);

comment on table public.report_template_refresh_snapshots is
  'Pre-refresh copies of report_templates.schema/config, written by each library refresh migration before it changes anything. One row per template per release. Service role only.';

create index if not exists report_template_refresh_snapshots_template_idx
  on public.report_template_refresh_snapshots (template_id, taken_at desc);

alter table public.report_template_refresh_snapshots enable row level security;

-- ── What was decided for every active adopted master, and why ─────────────
create table if not exists public.template_master_refresh_decisions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  release text not null,
  entry_id uuid not null,
  verdict text not null check (verdict in (
    'already_current', 'refreshed', 'deferred_customised', 'deferred_no_baseline'
  )),
  decided_at timestamptz not null default now(),
  -- The top-level schema keys that differ from the incoming entry, ignoring
  -- `tokens.colors`. On a deferred row this is what a reviewer would be
  -- deciding about; it is never treated as authority to overwrite.
  differing_keys text[] not null default '{}',
  unique (template_id, release)
);

comment on table public.template_master_refresh_decisions is
  'One row per active adopted report_templates master per library release, recording whether it was refreshed or deferred and why. Service role only.';

alter table public.template_master_refresh_decisions enable row level security;

-- ── Classify ──────────────────────────────────────────────────────────────
-- Session-scoped rather than `on commit drop`: a migration runner that gives
-- each statement its own transaction would otherwise destroy this between the
-- classification and the three statements that read it. Dropped explicitly at
-- the end, and dropped defensively first so a re-run in one session is safe.
drop table if exists _v16_classified;
create temporary table _v16_classified as
with adopted as (
  select
    t.id as template_id,
    e.id as entry_id,
    t.schema as row_schema,
    t.config as row_config,
    e.schema as entry_schema,
    md5((t.schema #- '{tokens,colors}')::text) as row_digest,
    md5((e.schema #- '{tokens,colors}')::text) as entry_digest,
    b.schema_digest as baseline_digest
  from public.report_templates t
  join public.template_library_entries e
    on (t.config -> 'libraryLineage' ->> 'entryId') = e.id::text
  left join public.template_library_release_baselines b
    on b.entry_id = e.id
   and b.release = '20261208000000_seed_template_library_v17_running_head_chapter_only'
  where t.is_active
    and e.status = 'published'
    and e.schema is not null
)
select
  a.*,
  case
    when a.row_digest = a.entry_digest then 'already_current'
    when a.baseline_digest is null then 'deferred_no_baseline'
    when a.row_digest = a.baseline_digest then 'refreshed'
    else 'deferred_customised'
  end as verdict,
  coalesce(
    (
      select array_agg(k order by k)
      from jsonb_object_keys(
        (a.row_schema #- '{tokens,colors}') || (a.entry_schema #- '{tokens,colors}')
      ) as k
      where (a.row_schema #- '{tokens,colors}') -> k
        is distinct from (a.entry_schema #- '{tokens,colors}') -> k
    ),
    '{}'::text[]
  ) as differing_keys
from adopted a;

-- ── Record the decision for every one of them ─────────────────────────────
insert into public.template_master_refresh_decisions
  (template_id, release, entry_id, verdict, differing_keys)
select
  c.template_id,
  '20261208000000_seed_template_library_v17_running_head_chapter_only',
  c.entry_id,
  c.verdict,
  c.differing_keys
from _v16_classified c
on conflict (template_id, release) do nothing;

-- ── Snapshot every classified row, before anything changes ────────────────
--
-- Deferred rows are snapshotted too. They are not going to be touched, and the
-- snapshot is what lets a reviewer prove afterwards that they were not.
insert into public.report_template_refresh_snapshots
  (template_id, migration, schema, config, differing_keys)
select
  c.template_id,
  '20261208010000_refresh_active_masters_from_library_v17',
  c.row_schema,
  c.row_config,
  c.differing_keys
from _v16_classified c
on conflict (template_id, migration) do nothing;

-- ── Refresh ONLY what was proven unedited ─────────────────────────────────
--
-- The row's own palette is carried forward, which is exactly what the
-- colourway bake put there. `entryVersion` is synced and `releaseApplied`
-- records which library release this copy actually carries — written here and
-- nowhere else, so a deferred master can never read as though it received v17.
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
    to_jsonb('20261208000000_seed_template_library_v17_running_head_chapter_only'::text)
  ),
  updated_at = now()
from _v16_classified c
join public.template_library_entries e on e.id = c.entry_id
where t.id = c.template_id
  and c.verdict = 'refreshed';

drop table if exists _v16_classified;

-- To see exactly what this release did, and to how many masters:
--
--   select verdict, count(*)
--   from public.template_master_refresh_decisions
--   where release = '20261208000000_seed_template_library_v17_running_head_chapter_only'
--   group by verdict order by 1;
--
-- To list the masters held back for review, with what differs on each:
--
--   select template_id, verdict, differing_keys
--   from public.template_master_refresh_decisions
--   where release = '20261208000000_seed_template_library_v17_running_head_chapter_only'
--     and verdict like 'deferred%'
--   order by template_id;
--
-- To restore one row exactly as it stood before this migration:
--
--   update public.report_templates t
--   set schema = s.schema, config = s.config, updated_at = now()
--   from public.report_template_refresh_snapshots s
--   where s.template_id = t.id
--     and s.migration = '20261208010000_refresh_active_masters_from_library_v17'
--     and t.id = '<the template id>';
