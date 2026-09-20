#!/usr/bin/env bash
#
# What the v15 library refresh does to an adopted template, proven by applying
# the real migration to a throwaway PostgreSQL rather than by reading the SQL.
#
#   bash scripts/verify/template-refresh-preservation.sh
#
# ## The question, and why it is not the read-path question
#
# `read-path-preservation.mts` compares what a READER of a stored report gets at
# two revisions. It touches no template and cannot answer this. This asks what a
# MIGRATION does to `report_templates`, which is a different question with a
# different answer and is kept apart from it deliberately.
#
# ## What the refresh must do
#
# The v13 and v14 refreshes replaced every active adopted master with the
# library's and carried forward only `tokens.colors`. A tenant's typeface, page,
# block, section, binding or branding did not survive. v15 changes a master only
# where it can PROVE the master is an unedited copy of what the library last
# published — by hashing the row's schema with `tokens.colors` removed (the one
# path `applyColourwayToSchema` writes) against the baseline the seed captured
# immediately before it overwrote the entry.
#
# Six rows exercise every branch: a plain adoption, an adoption customised
# beyond colours, one whose baseline was never captured, one already at v15, a
# row with no library lineage, and an inactive draft.
set -uo pipefail

PGPORT="${TEMPLATE_REFRESH_PGPORT:-54401}"
PGDIR="${TEMPLATE_REFRESH_PGDIR:-/tmp/pgtplrefresh}"
SOCK=/tmp
SEED=supabase/migrations/20261204020000_seed_template_library_v15_running_head_and_columns.sql
REFRESH=supabase/migrations/20261204030000_refresh_active_masters_from_library_v15.sql
RELEASE=20261204020000_seed_template_library_v15_running_head_and_columns

PGBIN=""
for d in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /usr/local/pgsql/bin /usr/bin; do
  [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ] && PGBIN="$d"
done
if [ -z "$PGBIN" ]; then
  echo "No PostgreSQL server binaries (initdb/pg_ctl) found — skipping these checks."
  exit 0
fi
PSQL_BIN="$(command -v psql || echo "$PGBIN/psql")"
psql_() { "$PSQL_BIN" -h "$SOCK" -p "$PGPORT" -U postgres "$@"; }
q() { psql_ -tAc "$1"; }

fails=0
ok() {
  if [ "$2" == "$3" ]; then printf '  ✓ %s\n' "$1"
  else printf '  ✗ %s — expected %s, got %s\n' "$1" "$3" "$2"; fails=$((fails+1)); fi
}

if [ -d "$PGDIR" ]; then
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m immediate stop" >/dev/null 2>&1 || true
  sleep 1; rm -rf "$PGDIR"
fi
rm -f "$SOCK/.s.PGSQL.$PGPORT" 2>/dev/null || true
mkdir -p "$PGDIR" && chown postgres:postgres "$PGDIR"
su postgres -c "$PGBIN/initdb -U postgres -A trust -D $PGDIR" >/dev/null 2>&1
su postgres -c "$PGBIN/pg_ctl -D $PGDIR -o '-p $PGPORT -k $SOCK' -l /tmp/pg-tplrefresh.log start" >/dev/null 2>&1
for _ in $(seq 1 30); do q 'select 1' >/dev/null 2>&1 && break; sleep 1; done
q 'select 1' >/dev/null 2>&1 || { echo "postgres did not start on :$PGPORT"; cat /tmp/pg-tplrefresh.log; exit 1; }

# ── The world as it stands at v14, before this release ────────────────────
psql_ -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
create extension if not exists pgcrypto;
create table public.template_library_entries (
  id uuid primary key, slug text not null, version int not null default 1,
  status text not null, schema jsonb, unique (slug, version));
create table public.report_templates (
  id uuid primary key, is_active boolean not null default true,
  schema jsonb not null, config jsonb not null, updated_at timestamptz default now());

-- Two entries, each holding its v14 schema.
insert into public.template_library_entries (id, slug, status, schema) values
 ('11111111-1111-1111-1111-111111111111','investor-compass','published',
  '{"tokens":{"colors":{"primary":"#111"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[{"type":"text-block","props":{"body":"v14 contents"}}]}]}'::jsonb),
 ('22222222-2222-2222-2222-222222222222','snapshot-brief','published',
  '{"tokens":{"colors":{"primary":"#222"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[{"type":"text-block","props":{"body":"v14 contents"}}]}]}'::jsonb);

-- A  a plain adoption: the v14 master with this tenant's palette baked in
insert into public.report_templates values
 ('aaaaaaaa-0000-0000-0000-000000000001', true,
  '{"tokens":{"colors":{"primary":"#C8A24A"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[{"type":"text-block","props":{"body":"v14 contents"}}]}]}'::jsonb,
  '{"libraryLineage":{"entryId":"11111111-1111-1111-1111-111111111111","entryVersion":1}}'::jsonb, now());

-- B  adopted AND customised beyond colours: tenant typeface, an extra page,
--    an extra block, a changed binding and a branding string
insert into public.report_templates values
 ('bbbbbbbb-0000-0000-0000-000000000002', true,
  '{"tokens":{"colors":{"primary":"#0B5"},"fonts":{"body":"Tenant Grotesk"},"brand":{"wordmark":"Naidu Property"}},
    "pages":[{"name":"Contents","blocks":[{"type":"text-block","props":{"body":"{{org.name}} contents"}}]},
             {"name":"Tenant addendum","blocks":[{"type":"text-block","props":{"body":"our own page"}}]}]}'::jsonb,
  '{"libraryLineage":{"entryId":"11111111-1111-1111-1111-111111111111","entryVersion":1}}'::jsonb, now());

-- C  no library lineage: the author's own document
insert into public.report_templates values
 ('cccccccc-0000-0000-0000-000000000003', true,
  '{"tokens":{"colors":{"primary":"#999"}},"pages":[{"name":"Bespoke","blocks":[]}]}'::jsonb,
  '{}'::jsonb, now());

-- D  an inactive draft
insert into public.report_templates values
 ('dddddddd-0000-0000-0000-000000000004', false,
  '{"tokens":{"colors":{"primary":"#777"}},"pages":[]}'::jsonb,
  '{"libraryLineage":{"entryId":"11111111-1111-1111-1111-111111111111","entryVersion":1}}'::jsonb, now());

-- E  adopted from the SECOND entry, whose baseline will be removed below to
--    simulate a release that never captured one. Unedited, but unprovable.
insert into public.report_templates values
 ('eeeeeeee-0000-0000-0000-000000000005', true,
  '{"tokens":{"colors":{"primary":"#5EE"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[{"type":"text-block","props":{"body":"v14 contents"}}]}]}'::jsonb,
  '{"libraryLineage":{"entryId":"22222222-2222-2222-2222-222222222222","entryVersion":1}}'::jsonb, now());
SQL

# ── The seed's own baseline capture, run verbatim from the generated file ──
echo "── capturing the pre-seed baseline (the seed migration's own preamble) ──"
sed -n '/CREATE TABLE IF NOT EXISTS public.template_library_release_baselines/,/ON CONFLICT (entry_id, release) DO NOTHING;/p' "$SEED" \
  | psql_ -q -v ON_ERROR_STOP=1 || { echo "baseline capture failed"; exit 1; }

# E's baseline is removed: an entry this release never captured.
psql_ -q -c "delete from public.template_library_release_baselines where entry_id = '22222222-2222-2222-2222-222222222222';"

# ── The seed lands v15 over both entries ──────────────────────────────────
psql_ -q -v ON_ERROR_STOP=1 <<'SQL'
update public.template_library_entries set schema =
  '{"tokens":{"colors":{"primary":"#111"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[
       {"type":"text-block","props":{"body":"{{report.companionNote}}"}},
       {"type":"toc","props":{}}]}]}'::jsonb;

-- F  a row already carrying the v15 master (adopted after the seed)
insert into public.report_templates values
 ('ffffffff-0000-0000-0000-000000000006', true,
  '{"tokens":{"colors":{"primary":"#F0F"},"fonts":{"body":"Inter"}},
    "pages":[{"name":"Contents","blocks":[
       {"type":"text-block","props":{"body":"{{report.companionNote}}"}},
       {"type":"toc","props":{}}]}]}'::jsonb,
  '{"libraryLineage":{"entryId":"11111111-1111-1111-1111-111111111111","entryVersion":1}}'::jsonb, now());
SQL

echo
echo "── BEFORE ──"
psql_ -v ON_ERROR_STOP=1 <<'SQL'
\pset border 2
select left(id::text,8) as "row",
       schema->'tokens'->'colors'->>'primary'  as "palette",
       schema->'tokens'->'fonts'->>'body'      as "typeface",
       schema->'tokens'->'brand'->>'wordmark'  as "branding",
       jsonb_array_length(schema->'pages')     as "pages",
       (schema->'pages'->0->'blocks'->0->'props'->>'body') as "first binding",
       config->'libraryLineage'->>'releaseApplied' as "release"
  from public.report_templates order by 1;
SQL

echo
echo "── applying $REFRESH ──"
psql_ -q -v ON_ERROR_STOP=1 -f "$REFRESH" || { echo "migration failed"; exit 1; }

echo
echo "── AFTER ──"
psql_ -v ON_ERROR_STOP=1 <<'SQL'
\pset border 2
select left(id::text,8) as "row",
       schema->'tokens'->'colors'->>'primary'  as "palette",
       schema->'tokens'->'fonts'->>'body'      as "typeface",
       schema->'tokens'->'brand'->>'wordmark'  as "branding",
       jsonb_array_length(schema->'pages')     as "pages",
       (schema->'pages'->0->'blocks'->0->'props'->>'body') as "first binding",
       config->'libraryLineage'->>'releaseApplied' as "release"
  from public.report_templates order by 1;
select left(template_id::text,8) as "row", verdict, differing_keys
  from public.template_master_refresh_decisions order by 1;
SQL

echo
echo "── 1. eligible, uncustomised masters receive the release ──"
ok "A takes the v15 block"              "$(q "select schema->'pages'->0->'blocks'->0->'props'->>'body' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "{{report.companionNote}}"
ok "A keeps its own palette"            "$(q "select schema->'tokens'->'colors'->>'primary' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "#C8A24A"
ok "A is recorded as refreshed"         "$(q "select verdict from public.template_master_refresh_decisions where template_id='aaaaaaaa-0000-0000-0000-000000000001'")" "refreshed"

echo
echo "── 2. customised and uncertain masters keep every protected property ──"
ok "B keeps its typeface"               "$(q "select schema->'tokens'->'fonts'->>'body' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "Tenant Grotesk"
ok "B keeps its branding"               "$(q "select schema->'tokens'->'brand'->>'wordmark' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "Naidu Property"
ok "B keeps its extra page"             "$(q "select jsonb_array_length(schema->'pages') from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "2"
ok "B keeps its own binding"            "$(q "select schema->'pages'->0->'blocks'->0->'props'->>'body' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "{{org.name}} contents"
ok "B is byte-identical to its snapshot" "$(q "select (t.schema = s.schema and t.config = s.config)::text from public.report_templates t join public.report_template_refresh_snapshots s on s.template_id=t.id where t.id='bbbbbbbb-0000-0000-0000-000000000002'")" "true"
ok "B is recorded as deferred"          "$(q "select verdict from public.template_master_refresh_decisions where template_id='bbbbbbbb-0000-0000-0000-000000000002'")" "deferred_customised"
ok "E, unedited but unprovable, is deferred" "$(q "select verdict from public.template_master_refresh_decisions where template_id='eeeeeeee-0000-0000-0000-000000000005'")" "deferred_no_baseline"
ok "E is untouched"                     "$(q "select schema->'pages'->0->'blocks'->0->'props'->>'body' from public.report_templates where id='eeeeeeee-0000-0000-0000-000000000005'")" "v14 contents"
ok "F, already at v15, is not deferred" "$(q "select verdict from public.template_master_refresh_decisions where template_id='ffffffff-0000-0000-0000-000000000006'")" "already_current"
ok "C, with no lineage, is untouched"   "$(q "select schema->'pages'->0->>'name' from public.report_templates where id='cccccccc-0000-0000-0000-000000000003'")" "Bespoke"
ok "C is not even classified"           "$(q "select count(*) from public.template_master_refresh_decisions where template_id='cccccccc-0000-0000-0000-000000000003'")" "0"
ok "D, an inactive draft, is untouched" "$(q "select jsonb_array_length(schema->'pages') from public.report_templates where id='dddddddd-0000-0000-0000-000000000004'")" "0"
ok "D is not classified"                "$(q "select count(*) from public.template_master_refresh_decisions where template_id='dddddddd-0000-0000-0000-000000000004'")" "0"

echo
echo "── 3. version metadata says only what was applied ──"
ok "A carries this release"             "$(q "select config->'libraryLineage'->>'releaseApplied' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "$RELEASE"
ok "B claims no release"                "$(q "select coalesce(config->'libraryLineage'->>'releaseApplied','(none)') from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "(none)"
ok "E claims no release"                "$(q "select coalesce(config->'libraryLineage'->>'releaseApplied','(none)') from public.report_templates where id='eeeeeeee-0000-0000-0000-000000000005'")" "(none)"
ok "F claims no release it did not get" "$(q "select coalesce(config->'libraryLineage'->>'releaseApplied','(none)') from public.report_templates where id='ffffffff-0000-0000-0000-000000000006'")" "(none)"
ok "exactly one master was refreshed"   "$(q "select count(*) from public.template_master_refresh_decisions where verdict='refreshed'")" "1"
ok "two were deferred for review"       "$(q "select count(*) from public.template_master_refresh_decisions where verdict like 'deferred%'")" "2"

echo
echo "── 4. reapplication is safe and the snapshot keeps the ORIGINAL ──"
BEFORE_SNAPS="$(q "select count(*) from public.report_template_refresh_snapshots")"
psql_ -q -v ON_ERROR_STOP=1 -f "$REFRESH" >/dev/null || { echo "second application failed"; fails=$((fails+1)); }
ok "snapshot count unchanged by a second run" "$(q "select count(*) from public.report_template_refresh_snapshots")" "$BEFORE_SNAPS"
ok "A's snapshot still holds the PRE-refresh block" "$(q "select schema->'pages'->0->'blocks'->0->'props'->>'body' from public.report_template_refresh_snapshots where template_id='aaaaaaaa-0000-0000-0000-000000000001'")" "v14 contents"
ok "B's snapshot still holds its typeface" "$(q "select schema->'tokens'->'fonts'->>'body' from public.report_template_refresh_snapshots where template_id='bbbbbbbb-0000-0000-0000-000000000002'")" "Tenant Grotesk"
ok "A is unchanged by the second run"   "$(q "select schema->'pages'->0->'blocks'->0->'props'->>'body' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "{{report.companionNote}}"
ok "A is not re-deferred on the second run" "$(q "select verdict from public.template_master_refresh_decisions where template_id='aaaaaaaa-0000-0000-0000-000000000001'")" "refreshed"
ok "B is still deferred, not newly refreshed" "$(q "select schema->'tokens'->'fonts'->>'body' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "Tenant Grotesk"

echo
echo "── 5. restoration is correctly scoped ──"
psql_ -q -v ON_ERROR_STOP=1 <<'SQL'
update public.report_templates t
set schema = s.schema, config = s.config, updated_at = now()
from public.report_template_refresh_snapshots s
where s.template_id = t.id
  and s.migration = '20261204030000_refresh_active_masters_from_library_v15'
  and t.id = 'aaaaaaaa-0000-0000-0000-000000000001';
SQL
ok "A is back to its pre-refresh block" "$(q "select schema->'pages'->0->'blocks'->0->'props'->>'body' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "v14 contents"
ok "A's palette is back"                "$(q "select schema->'tokens'->'colors'->>'primary' from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "#C8A24A"
ok "A no longer claims the release"     "$(q "select coalesce(config->'libraryLineage'->>'releaseApplied','(none)') from public.report_templates where id='aaaaaaaa-0000-0000-0000-000000000001'")" "(none)"
ok "restoring A did not touch B"        "$(q "select schema->'tokens'->'fonts'->>'body' from public.report_templates where id='bbbbbbbb-0000-0000-0000-000000000002'")" "Tenant Grotesk"
ok "restoring A did not touch C"        "$(q "select schema->'pages'->0->>'name' from public.report_templates where id='cccccccc-0000-0000-0000-000000000003'")" "Bespoke"
ok "restoring A did not touch F"        "$(q "select schema->'tokens'->'colors'->>'primary' from public.report_templates where id='ffffffff-0000-0000-0000-000000000006'")" "#F0F"

echo
echo "── the guard rails ──"
ok "the snapshot table is RLS-enabled"  "$(q "select relrowsecurity from pg_class where relname='report_template_refresh_snapshots'")" "t"
ok "the decisions table is RLS-enabled" "$(q "select relrowsecurity from pg_class where relname='template_master_refresh_decisions'")" "t"
ok "the baselines table is RLS-enabled" "$(q "select relrowsecurity from pg_class where relname='template_library_release_baselines'")" "t"
ok "no policy on any of the three"      "$(q "select count(*) from pg_policies where tablename in ('report_template_refresh_snapshots','template_master_refresh_decisions','template_library_release_baselines')")" "0"

su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m immediate stop" >/dev/null 2>&1 || true
echo
if [ "$fails" -eq 0 ]; then echo "template refresh preservation: all assertions passed"; exit 0; fi
echo "template refresh preservation: $fails assertion(s) failed"; exit 1
