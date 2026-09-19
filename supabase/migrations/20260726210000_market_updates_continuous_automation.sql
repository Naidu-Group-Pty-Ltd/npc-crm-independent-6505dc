-- Market Updates Phase 10: durable cron dispatch, heartbeat and admin alerts.
-- Credentials are read by name from Vault at execution time; no values are stored here.

create table if not exists public.market_updates_automation_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  target_function text not null,
  scheduled_at timestamptz not null default now(),
  request_id bigint,
  dispatch_status text not null check (dispatch_status in ('dispatched','failed')),
  safe_error_code text,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists market_updates_automation_runs_job_idx
  on public.market_updates_automation_runs(job_name, scheduled_at desc);

create table if not exists public.market_updates_operational_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_key text not null,
  severity text not null check (severity in ('warning','error')),
  safe_message text not null,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists market_updates_open_alert_key_uidx
  on public.market_updates_operational_alerts(alert_key) where resolved_at is null;

alter table public.market_updates_automation_runs enable row level security;
alter table public.market_updates_operational_alerts enable row level security;
revoke all on public.market_updates_automation_runs, public.market_updates_operational_alerts from public, anon, authenticated;
grant all on public.market_updates_automation_runs, public.market_updates_operational_alerts to service_role;

create or replace function public.dispatch_market_updates_automation(
  p_job_name text,
  p_target_function text,
  p_payload jsonb default '{}'::jsonb,
  p_completed_window boolean default false
) returns bigint
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
  v_request_id bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name in ('supabase_url','SUPABASE_URL') order by (name='supabase_url') desc limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name in ('market_ingestion_cron_secret','MARKET_INGESTION_CRON_SECRET') order by (name='market_ingestion_cron_secret') desc limit 1;
  if nullif(v_url,'') is null or nullif(v_secret,'') is null then
    insert into public.market_updates_automation_runs(job_name,target_function,dispatch_status,safe_error_code,payload)
    values(p_job_name,p_target_function,'failed','required_vault_secret_missing',v_payload);
    return null;
  end if;
  if p_completed_window then
    v_payload := v_payload || jsonb_build_object('reference_at',(now() - interval '1 second')::text);
  end if;
  select net.http_post(
    url := rtrim(v_url,'/') || '/functions/v1/' || p_target_function,
    headers := jsonb_build_object('content-type','application/json','x-cron-secret',v_secret),
    body := v_payload
  ) into v_request_id;
  insert into public.market_updates_automation_runs(job_name,target_function,request_id,dispatch_status,payload)
  values(p_job_name,p_target_function,v_request_id,'dispatched',v_payload);
  return v_request_id;
exception when others then
  insert into public.market_updates_automation_runs(job_name,target_function,dispatch_status,safe_error_code,payload)
  values(p_job_name,p_target_function,'failed','dispatch_failed',v_payload);
  return null;
end;
$$;
revoke all on function public.dispatch_market_updates_automation(text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.dispatch_market_updates_automation(text,text,jsonb,boolean) to service_role;

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
  where not exists(select 1 from public.market_updates where status='published' and ingested_at>now()-interval '72 hours')
  on conflict (alert_key) where resolved_at is null do update set last_detected_at=now();

  update public.market_updates_operational_alerts set resolved_at=now()
  where resolved_at is null and (
    (alert_key='cron_stale' and exists(select 1 from public.market_updates_automation_runs where job_name='market-updates-ingest-hourly' and dispatch_status='dispatched' and scheduled_at>=now()-interval '2 hours')) or
    (alert_key='source_failures' and not exists(select 1 from public.market_sources where registry_status='canonical' and enabled and consecutive_failures>=3)) or
    (alert_key='digest_failed' and exists(select 1 from public.market_digests where status in ('published','no_data') and completed_at>=now()-interval '24 hours')) or
    (alert_key='provider_failure' and not exists(select 1 from public.market_ingestion_runs where status='failed' and started_at>now()-interval '24 hours' and error_summary ilike '%classifier route%')) or
    (alert_key='publication_stale' and exists(select 1 from public.market_updates where status='published' and ingested_at>now()-interval '72 hours'))
  );
end;
$$;
revoke all on function public.evaluate_market_updates_automation_alerts() from public,anon,authenticated;
grant execute on function public.evaluate_market_updates_automation_alerts() to service_role;

create or replace function public.market_updates_automation_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  select jsonb_build_object(
    'configured_job_count',(select count(*) from cron.job where jobname like 'market-updates-%'),
    'expected_job_count',8,
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

-- Recreate jobs idempotently only when pg_cron is installed.
do $automation$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname like 'market-updates-%';
    perform cron.schedule('market-updates-ingest-hourly','5 * * * *', $$select public.dispatch_market_updates_automation('market-updates-ingest-hourly','market-updates-ingest','{"trigger_type":"cron"}'::jsonb,false);$$);
    perform cron.schedule('market-updates-digest-24h','15 0 * * *', $$select public.dispatch_market_updates_automation('market-updates-digest-24h','market-updates-digest','{"period":"24h"}'::jsonb,true);$$);
    perform cron.schedule('market-updates-digest-weekly','25 0 * * 1', $$select public.dispatch_market_updates_automation('market-updates-digest-weekly','market-updates-digest','{"period":"weekly"}'::jsonb,true);$$);
    perform cron.schedule('market-updates-digest-biweekly','30 0 * * 1', $$select case when mod(extract(week from current_date)::int,2)=0 then public.dispatch_market_updates_automation('market-updates-digest-biweekly','market-updates-digest','{"period":"biweekly"}'::jsonb,true) end;$$);
    perform cron.schedule('market-updates-digest-monthly','35 0 1 * *', $$select public.dispatch_market_updates_automation('market-updates-digest-monthly','market-updates-digest','{"period":"monthly"}'::jsonb,true);$$);
    perform cron.schedule('market-updates-digest-quarterly','40 0 1 1,4,7,10 *', $$select public.dispatch_market_updates_automation('market-updates-digest-quarterly','market-updates-digest','{"period":"quarterly"}'::jsonb,true);$$);
    perform cron.schedule('market-updates-digest-annual','45 0 1 1 *', $$select public.dispatch_market_updates_automation('market-updates-digest-annual','market-updates-digest','{"period":"annual"}'::jsonb,true);$$);
    perform cron.schedule('market-updates-alert-evaluator','*/30 * * * *', $$select public.evaluate_market_updates_automation_alerts();$$);
  end if;
end $automation$;
