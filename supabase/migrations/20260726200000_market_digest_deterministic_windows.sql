-- Market Updates Phase 7: deterministic digest windows and lifecycle state.
alter table public.market_digests
  add column if not exists period_key text,
  add column if not exists queued_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists error_code text,
  add column if not exists safe_error_message text,
  add column if not exists update_count integer not null default 0,
  add column if not exists candidate_count integer not null default 0,
  add column if not exists last_published_update_at timestamptz;

update public.market_digests
set period_key = period || ':' || to_char(period_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
where period_key is null;

alter table public.market_digests alter column period_key set not null;
create unique index if not exists market_digests_period_key_unique
  on public.market_digests(period, period_key);
create index if not exists market_digests_status_generated_idx
  on public.market_digests(status, generated_at desc);
