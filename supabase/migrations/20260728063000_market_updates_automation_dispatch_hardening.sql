-- Market Updates Phase 10 follow-up: make the automation dispatcher safe to apply
-- to an environment that has never held a `market_ingestion_cron_secret` vault entry,
-- and restore the embedding backfill job that the Phase 10 blanket unschedule removed.
--
-- 20260726210000 replaced every `market-updates-%` pg_cron job with dispatches through
-- public.dispatch_market_updates_automation(). That function hard-required two vault
-- secrets, and its `cron.unschedule(...) where jobname like 'market-updates-%'` also
-- caught `market-updates-embed-backfill-hourly`, which it never recreated. Applied as
-- written to a project whose cron jobs authenticate with the signed internal-header
-- contract, it turns "cron fires, function errors" into "cron never fires".

-- 1. Dispatch falls back to the signed internal-header envelope that every other
--    pg_cron job in this project already uses, instead of aborting the dispatch.
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
  v_headers jsonb;
  v_request_id bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name in ('supabase_url','SUPABASE_URL')
    order by (name='supabase_url') desc limit 1;
  if nullif(v_url,'') is null then
    insert into public.market_updates_automation_runs(job_name,target_function,dispatch_status,safe_error_code,payload)
    values(p_job_name,p_target_function,'failed','required_vault_secret_missing',v_payload);
    return null;
  end if;

  if p_completed_window then
    v_payload := v_payload || jsonb_build_object('reference_at',(now() - interval '1 second')::text);
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets
    where name in ('market_ingestion_cron_secret','MARKET_INGESTION_CRON_SECRET')
    order by (name='market_ingestion_cron_secret') desc limit 1;

  if nullif(v_secret,'') is not null then
    v_headers := jsonb_build_object('content-type','application/json','x-cron-secret',v_secret);
  else
    -- No dedicated cron secret configured: sign the request with internal_edge_secret
    -- so automation keeps working rather than silently recording a failed dispatch.
    v_headers := public.cron_signed_internal_headers('POST', p_target_function, v_payload, 'pg_cron');
  end if;

  select net.http_post(
    url := rtrim(v_url,'/') || '/functions/v1/' || p_target_function,
    headers := v_headers,
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

-- 2. Restore the embedding backfill job dropped by the Phase 10 unschedule sweep.
do $embed_backfill$ begin
  if exists(select 1 from pg_extension where extname='pg_cron')
     and not exists(select 1 from cron.job where jobname='market-updates-embed-backfill-hourly') then
    perform cron.schedule(
      'market-updates-embed-backfill-hourly',
      '7 * * * *',
      $$select public.cron_invoke_signed_function('market-updates-embed-backfill', jsonb_build_object('cron', now()), 'pg_cron');$$
    );
  end if;
end $embed_backfill$;
