-- Bring the v15 catalogue to the ACTIVE `report_templates` rows that adopted
-- from the library — and to no others.
--
-- ## What the v13 and v14 refreshes did, and why this one does not
--
-- They ran `schema = jsonb_set(e.schema, '{tokens,colors}', <this row's
-- colours>)` over every active adopted row. That REPLACES the master with the
-- library's and carries forward only the palette. A tenant's typeface, page,
-- block, section, binding or branding did not survive it. Calling that
-- deliberate describes the precedent; it does not authorise destroying a
-- customer's work, and a snapshot that makes the destruction recoverable is
-- not preservation.
--
-- So this refresh changes a master only where it can PROVE the master is an
-- unedited copy of what the library last published. Everything else is left
-- exactly as it stands and recorded as deferred for review.
--
-- ## How "unedited" is proven
--
-- The seed that runs immediately before this one (`20261204020000`) captures,
-- BEFORE it upserts, a digest of every entry's schema as it then stood — the
-- previous release's bytes. It has to be captured there because the upsert is
-- `ON CONFLICT (slug, version)` with `version` = 1 for every entry, so there is
-- one row per slug, the schema is overwritten in place, and nothing in the
-- database retains what it held before.
--
-- A row is eligible when its own schema, with `tokens.colors` removed, hashes
-- to that baseline. `tokens.colors` is the ONLY path excluded, because
-- `applyColourwayToSchema` spreads `...tokens` and replaces `colors` alone — so
-- a supported colourway difference is accounted for exactly and nothing else is
-- hidden. Library lineage alone is never taken as evidence of an unedited copy.
--
-- ## The four verdicts
--
--   already_current       the row already matches the new entry; nothing to do.
--                         This is what a second application sees, and it is why
--                         re-running cannot mislabel a row it already refreshed.
--   refreshed             proven unedited against the baseline; replaced.
--   deferred_customised   a baseline exists and the row does not match it. The
--                         row is UNTOUCHED and nothing claims it has v15.
--   deferred_no_baseline  no baseline for this entry — the previous release was
--                         never captured here. Uncertain, so protected.
--
-- A deferred row keeps its schema, its config and its lineage. Nothing marks it
-- as having received this release, because it has not.
--
-- ## What this migration does NOT attempt
--
-- It does not try to graft v15's changes into a customised master. The release
-- alters a running head binding, a section heading, a table's column widths and
-- a Contents-page block; applying those surgically to an arbitrary edited
-- schema cannot be shown to preserve that tenant's layout, and the smallest
-- correct action on an unproven row is to leave it alone and say so.
--
-- Idempotent. Re-applying is a no-op for rows already refreshed, and the
-- snapshot taken on the first application is never overwritten.

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
drop table if exists _v15_classified;
create temporary table _v15_classified as
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
   and b.release = '20261204020000_seed_template_library_v15_running_head_and_columns'
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
  '20261204020000_seed_template_library_v15_running_head_and_columns',
  c.entry_id,
  c.verdict,
  c.differing_keys
from _v15_classified c
on conflict (template_id, release) do nothing;

-- ── Snapshot every classified row, before anything changes ────────────────
--
-- Deferred rows are snapshotted too. They are not going to be touched, and the
-- snapshot is what lets a reviewer prove afterwards that they were not.
insert into public.report_template_refresh_snapshots
  (template_id, migration, schema, config, differing_keys)
select
  c.template_id,
  '20261204030000_refresh_active_masters_from_library_v15',
  c.row_schema,
  c.row_config,
  c.differing_keys
from _v15_classified c
on conflict (template_id, migration) do nothing;

-- ── Refresh ONLY what was proven unedited ─────────────────────────────────
--
-- The row's own palette is carried forward, which is exactly what the
-- colourway bake put there. `entryVersion` is synced and `releaseApplied`
-- records which library release this copy actually carries — written here and
-- nowhere else, so a deferred master can never read as though it received v15.
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
    to_jsonb('20261204020000_seed_template_library_v15_running_head_and_columns'::text)
  ),
  updated_at = now()
from _v15_classified c
join public.template_library_entries e on e.id = c.entry_id
where t.id = c.template_id
  and c.verdict = 'refreshed';

drop table if exists _v15_classified;

-- To see exactly what this release did, and to how many masters:
--
--   select verdict, count(*)
--   from public.template_master_refresh_decisions
--   where release = '20261204020000_seed_template_library_v15_running_head_and_columns'
--   group by verdict order by 1;
--
-- To list the masters held back for review, with what differs on each:
--
--   select template_id, verdict, differing_keys
--   from public.template_master_refresh_decisions
--   where release = '20261204020000_seed_template_library_v15_running_head_and_columns'
--     and verdict like 'deferred%'
--   order by template_id;
--
-- To restore one row exactly as it stood before this migration:
--
--   update public.report_templates t
--   set schema = s.schema, config = s.config, updated_at = now()
--   from public.report_template_refresh_snapshots s
--   where s.template_id = t.id
--     and s.migration = '20261204030000_refresh_active_masters_from_library_v15'
--     and t.id = '<the template id>';
