-- @effect: select 1 from public.template_master_refresh_decisions where release = '20261212000000_seed_template_library_v19_placeholder_words'
-- The line above is this file's own statement of what is true once it has
-- run. It exists because this migration creates no object, so
-- `scripts/ops/migration-drift.mjs` has nothing to count and would report
-- it as unverifiable — which is exactly how seed v18 merged to main, never
-- landed, and left every report printing the heading it was written to fix.
-- Read-only by construction: the runner refuses anything that is not a
-- lone SELECT.
-- Bring the v19 catalogue to the ACTIVE `report_templates` rows that adopted
-- from the library — and to no others.
--
-- Identical in mechanism to the v15 refresh (`20261204030000`) and to v18's,
-- which is the point: the classification, the snapshot and the four verdicts
-- are the safety property, not something to re-invent per release. Only the
-- release identifiers change. Read v15's header for why a customised master is
-- left alone rather than overwritten, and for the queries that report what
-- this release did.
--
-- ## What v19 changes in a master, and why it is safe to carry forward
--
-- TWO literal words on the 50 Investment Compass masters. Nothing else in the
-- catalogue moves: the other ten formats' 493 masters are byte-identical,
-- verified by parsing both seed files and comparing all 2,172 schemas.
--
--   * The risk register's rating read `Noted`. The record holds a bare risk
--     STRING from `investment_score.risks` and no severity at all, and the
--     platform's exposure vocabulary is `Low | Moderate | High | Not assessed`.
--     `Noted` was a fifth word in a four-word vocabulary, in the column that
--     states the EXPOSURE, and it is absent from `RATING_PALETTE` too — which
--     is why the chip display already drew it neutral. `severityFromRating`
--     answers null for both, so neither draws a bar; a reader is simply given
--     the platform's own word for "nobody assessed this".
--
--   * The Opportunities list's term read `Noted`. Every sibling definition
--     list on that page carries a real term naming what the row is about —
--     `Location`, `Yield`, `Risk` — and the record gives an opportunity as one
--     unlabelled string, so any term there is invented. The heading already
--     said "Opportunities", so the 160pt term column carried a word that
--     repeated nothing. It is a `callout` now, the container that page already
--     uses for one unqualified statement ("No risk recorded").
--
-- ## Two masters GAIN a block, and that is deliberate
--
-- Measured: `"type":"definition-list"` −32 and `"type":"callout"` +34.
-- **Analyst Folio** and **Monograph** gain one block each (333→334, 320→321)
-- while keeping all seven of their definition lists. They never carried the
-- Opportunities list: it is an OPTIONAL item and `ifItFits` keeps one only
-- while `y + height + SLACK <= contentBottom`. The definition list declared
-- ~75pt and the callout declares 72, and on those two variants those three
-- points are the difference — so a block they had been dropping silently now
-- fits. `SLACK` is untouched at 36.
--
-- That is a block ADDED to a page, so it is named here rather than left for a
-- reviewer to find: it is `ifItFits` doing its job, and it shows an
-- opportunity the record holds instead of discarding it.
--
-- ## v19 also carries two geometry corrections, added 22 Sep 2026
--
-- The seed is GENERATED and nothing compared it to the definitions that
-- generate it, so two commits that landed after v19 was written had never
-- reached the migration. v19 has not been applied anywhere — 1,012
-- migrations are recorded and the latest is `20261211000000` — so it was
-- regenerated in place rather than followed by a v20.
--
--   * A bound KPI note was budgeted one line and sets two. The DASHBOARD
--     grid on page 2 of 142 masters grows 8 to 21pt, and the blocks below it
--     move down by the same amount (76 callouts, 59 text blocks, 40 data
--     tables, 31 decision boxes, 18 strengths-watch panels). Before this the
--     note set over the row beneath it.
--
--   * The cover facts took their point size from a density literal that
--     disagreed with the family's own scale on 22 of 50 masters. `valueSize`
--     on page 0 is now derived: 140 masters 11pt to 9pt on compact, 80
--     masters 14pt to 13pt on spacious.
--
-- Measured template by template across all 543: **301 differ**, every one a
-- design-family master and none of the 43 voice templates. **No template's
-- page count changes and no template's block count changes** — every
-- difference is a size, a height or a `y`, and the two changes never touch
-- the same grid. That is checked rather than asserted, for the reason the
-- section above exists.
--
-- Both are corrections to what a reader is shown on a page, so carrying them
-- to an active master is the same act as carrying the two words: the proof
-- below decides, not the size of the diff.

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
drop table if exists _v19_classified;
create temporary table _v19_classified as
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
   and b.release = '20261212000000_seed_template_library_v19_placeholder_words'
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
  '20261212000000_seed_template_library_v19_placeholder_words',
  c.entry_id,
  c.verdict,
  c.differing_keys
from _v19_classified c
on conflict (template_id, release) do nothing;

-- ── Snapshot every classified row, before anything changes ────────────────
--
-- Deferred rows are snapshotted too. They are not going to be touched, and the
-- snapshot is what lets a reviewer prove afterwards that they were not.
insert into public.report_template_refresh_snapshots
  (template_id, migration, schema, config, differing_keys)
select
  c.template_id,
  '20261212010000_refresh_active_masters_from_library_v19',
  c.row_schema,
  c.row_config,
  c.differing_keys
from _v19_classified c
on conflict (template_id, migration) do nothing;

-- ── Refresh ONLY what was proven unedited ─────────────────────────────────
--
-- The row's own palette is carried forward, which is exactly what the
-- colourway bake put there. `entryVersion` is synced and `releaseApplied`
-- records which library release this copy actually carries — written here and
-- nowhere else, so a deferred master can never read as though it received v19.
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
    to_jsonb('20261212000000_seed_template_library_v19_placeholder_words'::text)
  ),
  updated_at = now()
from _v19_classified c
join public.template_library_entries e on e.id = c.entry_id
where t.id = c.template_id
  and c.verdict = 'refreshed';

drop table if exists _v19_classified;

-- To see exactly what this release did, and to how many masters:
--
--   select verdict, count(*)
--   from public.template_master_refresh_decisions
--   where release = '20261212000000_seed_template_library_v19_placeholder_words'
--   group by verdict order by 1;
--
-- To list the masters held back for review, with what differs on each:
--
--   select template_id, verdict, differing_keys
--   from public.template_master_refresh_decisions
--   where release = '20261212000000_seed_template_library_v19_placeholder_words'
--     and verdict like 'deferred%'
--   order by template_id;
--
-- To restore one row exactly as it stood before this migration:
--
--   update public.report_templates t
--   set schema = s.schema, config = s.config, updated_at = now()
--   from public.report_template_refresh_snapshots s
--   where s.template_id = t.id
--     and s.migration = '20261212010000_refresh_active_masters_from_library_v19'
--     and t.id = '<the template id>';
