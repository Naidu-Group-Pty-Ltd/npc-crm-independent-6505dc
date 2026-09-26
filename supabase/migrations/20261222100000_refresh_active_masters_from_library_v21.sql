-- @effect: select 1 from public.template_master_refresh_decisions where release = '20261222090000_seed_template_library_v21_cover_photograph'
-- The line above is this file's own statement of what is true once it has
-- run. It exists because this migration creates no object, so
-- `scripts/ops/migration-drift.mjs` has nothing to count and would report
-- it as unverifiable — which is exactly how seed v18 merged to main, never
-- landed, and left every report printing the heading it was written to fix.
-- Read-only by construction: the runner refuses anything that is not a
-- lone SELECT.
-- Bring the v21 catalogue to the ACTIVE `report_templates` rows that adopted
-- from the library — and to no others.
--
-- Identical in mechanism to the v15 refresh (`20261204030000`) and to v18's,
-- v19's and v20's, which is the point: the classification, the snapshot and
-- the four verdicts are the safety property, not something to re-invent per
-- release. Only the release identifiers change. Read v15's header for why a
-- customised master is left alone rather than overwritten, and for the
-- queries that report what this release did.
--
-- ## What v21 changes in a master, and why it is safe to carry forward
--
-- 34 of the 50 Investment Compass masters, and nothing else: the other 16
-- Investment masters, the other nine formats' 450 masters and the 43 voice
-- templates are byte-identical, verified by parsing both seed files and
-- comparing all 543 rows.
--
-- The owner asked on 25 Sep 2026 for the property's photograph on the covers
-- that had nowhere to put one. Five masters were designed around photographs;
-- the other forty-five printed none, however many the report held.
--
--   * The 16 masters whose cover is a FIELD (the whole sheet in the field
--     colour) gain the report's lead photograph behind the whole cover, under
--     two passes of the field colour's 0.55 scrim.
--   * The 18 masters whose cover is a BAND gain it inside the band, above the
--     band's colour and beneath the mark, wordmark and tagline, under the same
--     two passes.
--   * The 11 PAPER covers are unchanged: dark type on paper needs a different
--     cover to carry a photograph, and one of them (Monograph) is photo-free
--     by the catalogue's own design.
--
-- Two passes, because one leaves the cover's small type at 3.48:1 over a white
-- facade, and two (about 0.80) come to 7.89:1, clearing the 7:1 print floor.
--
-- Each of the 34 gains exactly three blocks on its cover: the photograph and
-- the two passes, all conditional on the photograph. Every existing block
-- keeps its id and its position. A report without a photograph draws exactly
-- the cover it drew before; that is pinned by
-- `investmentCompassCoverPhotograph.spec.ts`, which renders every one of the
-- 34 with and without a photograph through the production renderer.
--
-- Every photograph is the report's own property's. The binding reads only
-- what the report broker returns, and the broker returns only photographs of
-- the report's own address (PROPERTY_PHOTOGRAPHS.md §3). A report with none
-- draws the cover it always drew; nothing is used to fill the space.

-- A row is refreshed only where it is PROVEN an unedited copy of what the
-- library last published, so a tenant who has adjusted that page
-- keeps their wording and is recorded as deferred. Idempotent.

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
drop table if exists _v21_classified;
create temporary table _v21_classified as
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
   and b.release = '20261222090000_seed_template_library_v21_cover_photograph'
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
  '20261222090000_seed_template_library_v21_cover_photograph',
  c.entry_id,
  c.verdict,
  c.differing_keys
from _v21_classified c
on conflict (template_id, release) do nothing;

-- ── Snapshot every classified row, before anything changes ────────────────
--
-- Deferred rows are snapshotted too. They are not going to be touched, and the
-- snapshot is what lets a reviewer prove afterwards that they were not.
insert into public.report_template_refresh_snapshots
  (template_id, migration, schema, config, differing_keys)
select
  c.template_id,
  '20261222100000_refresh_active_masters_from_library_v21',
  c.row_schema,
  c.row_config,
  c.differing_keys
from _v21_classified c
on conflict (template_id, migration) do nothing;

-- ── Refresh ONLY what was proven unedited ─────────────────────────────────
--
-- The row's own palette is carried forward, which is exactly what the
-- colourway bake put there. `entryVersion` is synced and `releaseApplied`
-- records which library release this copy actually carries — written here and
-- nowhere else, so a deferred master can never read as though it received v21.
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
    to_jsonb('20261222090000_seed_template_library_v21_cover_photograph'::text)
  ),
  updated_at = now()
from _v21_classified c
join public.template_library_entries e on e.id = c.entry_id
where t.id = c.template_id
  and c.verdict = 'refreshed';

drop table if exists _v21_classified;

-- To see exactly what this release did, and to how many masters:
--
--   select verdict, count(*)
--   from public.template_master_refresh_decisions
--   where release = '20261222090000_seed_template_library_v21_cover_photograph'
--   group by verdict order by 1;
--
-- To list the masters held back for review, with what differs on each:
--
--   select template_id, verdict, differing_keys
--   from public.template_master_refresh_decisions
--   where release = '20261222090000_seed_template_library_v21_cover_photograph'
--     and verdict like 'deferred%'
--   order by template_id;
--
-- To restore one row exactly as it stood before this migration:
--
--   update public.report_templates t
--   set schema = s.schema, config = s.config, updated_at = now()
--   from public.report_template_refresh_snapshots s
--   where s.template_id = t.id
--     and s.migration = '20261222100000_refresh_active_masters_from_library_v21'
--     and t.id = '<the template id>';
