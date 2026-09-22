-- @effect: select 1 from pg_class where relkind = 'i' and relname = 'market_updates_lending_tags_gin'
--
-- The four indexes `20260725010000_market_updates_unified_intelligence.sql`
-- declares and the database does not hold.
--
-- ## Why this file exists rather than a replay of that one
--
-- Measured 21 Sep 2026 by `Migration drift`: of that migration's eleven
-- objects, seven exist and these four do not. Replaying it to recover them
-- would also re-run its top-level seed of `public.market_sources` — a
-- twenty-one row upsert whose conflict action is
--
--   ON CONFLICT (source_key) DO UPDATE SET name = excluded.name,
--     description = ..., adapter_type = ..., primary_url = ...,
--     feed_urls = ..., listing_urls = ..., source_authority = ...,
--     reliability_tier = ..., default_segments = ..., category = ...,
--     refresh_frequency_minutes = ..., copyright_mode = ...,
--     perspective = ..., updated_at = now()
--
-- so every operator edit to any of those twenty-one sources would be
-- overwritten with the migration's literal. That is the rule
-- `CLONE_PROVISIONING_GAPS.md` already states for this exact table —
-- `market-updates-ingest` fills an EMPTY registry from
-- `canonicalRegistry.generated.ts` and refuses a populated one, "because a
-- registry with rows is one somebody has decided about and re-inserting there
-- would overrule an operator". A migration replay is not exempt from a rule
-- written about the same rows.
--
-- The index definitions are copied verbatim from lines 68-71 of that file, so
-- what lands is what it declared.
--
-- ## What this costs, stated plainly
--
-- `Migration drift` judges a migration that declares no `@effect` probe by
-- whether the objects it creates exist. Once these four indexes exist, all
-- eleven of that file's objects exist, so it will read as APPLIED and the
-- report will stop naming it — while its `market_sources` seed has still
-- never run. This header is the record of that, because nothing else will be.
--
-- No probe is added to that file to correct the reading, and the reason is
-- that the correction would be worse than the gap: an `@effect` probe over
-- `market_sources` would fail the daily gate every day with a message telling
-- an operator to apply the file, which is precisely the replay this migration
-- exists to avoid. Whether those twenty-one sources should be seeded is a
-- decision about live rows, and it belongs to somebody who can look at them.
--
-- Additive only. No row is read, written or deleted.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.market_updates_lending_tags_gin;
--   DROP INDEX IF EXISTS public.market_updates_legal_status_idx;
--   DROP INDEX IF EXISTS public.market_ingestion_runs_status_idx;
--   DROP INDEX IF EXISTS public.market_source_fetch_runs_source_idx;

create index if not exists market_updates_lending_tags_gin
  on public.market_updates using gin(lending_criteria_tags);

create index if not exists market_updates_legal_status_idx
  on public.market_updates(legal_status);

create index if not exists market_ingestion_runs_status_idx
  on public.market_ingestion_runs(status, started_at desc);

create index if not exists market_source_fetch_runs_source_idx
  on public.market_source_fetch_runs(source_id, started_at desc);
