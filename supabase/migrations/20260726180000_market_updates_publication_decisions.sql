-- Market Updates Phase 5: explicit publication decisions and validation outcomes.

alter table public.market_updates
  add column if not exists publication_reason text,
  add column if not exists candidate_reason text,
  add column if not exists ai_status text,
  add column if not exists ai_failure_code text,
  add column if not exists validation_failures jsonb not null default '[]'::jsonb,
  add column if not exists decisioned_at timestamptz;

alter table public.market_ingestion_runs
  add column if not exists items_rejected integer not null default 0,
  add column if not exists items_failed integer not null default 0;

alter table public.market_source_fetch_runs
  add column if not exists items_candidate integer not null default 0,
  add column if not exists items_ignored integer not null default 0,
  add column if not exists items_failed integer not null default 0;

create index if not exists market_updates_candidate_review_idx
  on public.market_updates(status, ingested_at desc)
  where status in ('candidate', 'rejected', 'failed');
