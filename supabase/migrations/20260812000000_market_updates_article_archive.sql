-- Market Updates article archive: reversible operator archive with a strict
-- 30-day retention boundary. All application access remains mediated by secured
-- Edge Functions; this migration adds no browser-facing table grants.

alter table public.market_updates
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists pre_archive_status text;

comment on column public.market_updates.archived_at is
  'UTC timestamp at which an operator archived this update; null means active.';
comment on column public.market_updates.archived_by is
  'Authenticated operator UUID that archived the update; null for historical backfill or a removed user.';
comment on column public.market_updates.pre_archive_status is
  'Status captured immediately before archive so restore semantics remain explicit.';

alter table public.market_updates
  drop constraint if exists market_updates_archive_metadata_check;
alter table public.market_updates
  add constraint market_updates_archive_metadata_check check (
    (archived_at is null and archived_by is null and pre_archive_status is null)
    or
    (archived_at is not null and pre_archive_status is not null)
  ) not valid;

-- Existing operator removals were reversible ignored rows. Only that precise
-- reason is backfilled; below-relevance and pipeline-ignored rows remain intact.
update public.market_updates
set archived_at = coalesce(decisioned_at, updated_at, created_at),
    archived_by = null,
    pre_archive_status = 'published',
    status = 'published',
    failure_reason = null,
    updated_at = now()
where status = 'ignored'
  and failure_reason = 'hidden_by_operator'
  and archived_at is null;

alter table public.market_updates
  validate constraint market_updates_archive_metadata_check;

create index if not exists market_updates_archived_at_idx
  on public.market_updates (archived_at desc, id)
  where archived_at is not null;

create index if not exists market_updates_active_feed_idx
  on public.market_updates (visibility, status, source_published_at desc)
  where archived_at is null;

-- Service-only execution evidence is retained independently of article rows so
-- cleanup remains auditable after the payload is permanently removed.
create table if not exists public.market_update_archive_purge_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  cutoff_at timestamptz not null,
  deleted_count integer not null default 0 check (deleted_count >= 0),
  status text not null default 'completed' check (status in ('completed'))
);

alter table public.market_update_archive_purge_runs enable row level security;
revoke all on table public.market_update_archive_purge_runs from public, anon, authenticated;
grant all on table public.market_update_archive_purge_runs to service_role;

drop policy if exists "Service role manages market_update_archive_purge_runs"
  on public.market_update_archive_purge_runs;
create policy "Service role manages market_update_archive_purge_runs"
  on public.market_update_archive_purge_runs
  for all to service_role using (true) with check (true);

create or replace function public.purge_expired_market_updates_archive()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_started_at timestamptz := clock_timestamp();
  v_cutoff_at timestamptz := now() - interval '30 days';
  v_deleted_count integer := 0;
begin
  -- Embeddings and search vectors are columns on market_updates and are removed
  -- atomically with the row. Digest/question identifier arrays are historical
  -- evidence rather than FKs and deliberately remain intact.
  delete from public.market_updates
  where archived_at is not null
    and archived_at <= v_cutoff_at;

  get diagnostics v_deleted_count = row_count;

  insert into public.market_update_archive_purge_runs (
    started_at, completed_at, cutoff_at, deleted_count, status
  ) values (
    v_started_at, clock_timestamp(), v_cutoff_at, v_deleted_count, 'completed'
  );

  raise log 'market_updates archive purge completed: deleted_count=%, cutoff_at=%',
    v_deleted_count, v_cutoff_at;
  return v_deleted_count;
end;
$$;

revoke all on function public.purge_expired_market_updates_archive()
  from public, anon, authenticated;
grant execute on function public.purge_expired_market_updates_archive()
  to service_role;

-- Archived published rows must not satisfy active publication-health checks.
create or replace function public.evaluate_market_updates_automation_alerts()
returns void language plpgsql security definer set search_path=public as $$
begin
  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'cron_stale','error','Market Updates scheduled ingestion has not dispatched within the expected window.',jsonb_build_object('last_dispatch',max(scheduled_at))
  from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched'
  having max(scheduled_at) is null or max(scheduled_at) < now()-interval '2 hours'
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'source_failures','warning','One or more canonical Market Updates sources have repeated failures.',jsonb_build_object('count',count(*))
  from public.market_sources where registry_status='canonical' and enabled and consecutive_failures>=3 having count(*)>0
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'digest_failed','error','The latest Market Updates digest generation failed.',jsonb_build_object('period',period,'period_key',period_key)
  from public.market_digests where status='failed' order by completed_at desc nulls last limit 1
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'provider_failure','error','The configured Market Updates AI route failed during a recent automated run.',jsonb_build_object('run_id',id)
  from public.market_ingestion_runs where status='failed' and started_at>now()-interval '24 hours' and error_summary ilike '%classifier route%'
  order by started_at desc limit 1
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now(),metadata=excluded.metadata;

  insert into public.market_updates_operational_alerts(alert_key,severity,safe_message,metadata)
  select 'publication_stale','warning','No Market Updates item has been published during the expected publication window.','{}'::jsonb
  where not exists(select 1 from public.market_updates where status='published' and archived_at is null and ingested_at>now()-interval '72 hours')
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now();

  update public.market_updates_operational_alerts set resolved_at=now()
  where resolved_at is null and (
    (alert_key='cron_stale' and exists(select 1 from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched' and scheduled_at>=now()-interval '2 hours')) or
    (alert_key='source_failures' and not exists(select 1 from public.market_sources where registry_status='canonical' and enabled and consecutive_failures>=3)) or
    (alert_key='digest_failed' and exists(select 1 from public.market_digests where status in ('published','no_data') and completed_at>=now()-interval '24 hours')) or
    (alert_key='provider_failure' and not exists(select 1 from public.market_ingestion_runs where status='failed' and started_at>now()-interval '24 hours' and error_summary ilike '%classifier route%')) or
    (alert_key='publication_stale' and exists(select 1 from public.market_updates where status='published' and archived_at is null and ingested_at>now()-interval '72 hours'))
  );
end;
$$;
revoke all on function public.evaluate_market_updates_automation_alerts() from public,anon,authenticated;
grant execute on function public.evaluate_market_updates_automation_alerts() to service_role;

-- Recreate only this exact job. Never broadly unschedule market-updates-* jobs.
do $archive_cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'market-updates-archive-purge-daily';

    perform cron.schedule(
      'market-updates-archive-purge-daily',
      '37 2 * * *',
      $job$select public.purge_expired_market_updates_archive();$job$
    );
  end if;
end;
$archive_cron$;

-- The archive purge is the ninth required Market Updates job.
create or replace function public.market_updates_automation_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'configured_job_count',(select count(*) from cron.job where jobname like 'market-updates-%'),
    'expected_job_count',9,
    'last_dispatch_at',(select max(scheduled_at) from public.market_updates_automation_runs where dispatch_status='dispatched'),
    'last_ingestion_dispatch_at',(select max(scheduled_at) from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched'),
    'cron_stale',not exists(select 1 from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched' and scheduled_at>=now()-interval '2 hours'),
    'required_secrets_present',
      exists(select 1 from vault.decrypted_secrets where name in ('supabase_url','SUPABASE_URL')) and
      exists(select 1 from vault.decrypted_secrets where name in ('market_ingestion_cron_secret','MARKET_INGESTION_CRON_SECRET')),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object('key',alert_key,'severity',severity,'message',safe_message,'last_detected_at',last_detected_at) order by last_detected_at desc) from public.market_updates_operational_alerts where resolved_at is null),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.market_updates_automation_status() from public,anon,authenticated;
grant execute on function public.market_updates_automation_status() to service_role;
