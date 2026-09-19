-- Market Updates Phase 11: safe cross-stage correlation identifiers.
alter table public.market_ingestion_runs add column if not exists correlation_id text;
alter table public.market_source_fetch_runs add column if not exists correlation_id text;
alter table public.market_updates add column if not exists correlation_id text;
alter table public.market_digests add column if not exists correlation_id text;
alter table public.market_update_questions add column if not exists correlation_id text;
alter table public.market_updates_automation_runs add column if not exists correlation_id text;
create index if not exists market_ingestion_runs_correlation_idx on public.market_ingestion_runs(correlation_id) where correlation_id is not null;
create index if not exists market_source_fetch_runs_correlation_idx on public.market_source_fetch_runs(correlation_id) where correlation_id is not null;
create index if not exists market_digests_correlation_idx on public.market_digests(correlation_id) where correlation_id is not null;
