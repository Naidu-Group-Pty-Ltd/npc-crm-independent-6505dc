-- The open-data sales register refreshes itself every day.
--
-- Every figure the Estimate CGR button and the Investment Grade's growth
-- dimension read comes from `market_sales_medians`, and until now that
-- register was loaded by hand: eight loader stages, each run by a person
-- posting to `market-sales-ingest`. The owner's requirement (16 Sep 2026) is
-- that a reading is the newest publication its source has released as of the
-- day it is asked for. A quarterly publisher releases four times a year and
-- the archive takes its captures on no schedule of ours, so the only way to
-- hold that property at all times is to ask every source every day and let
-- the upsert change nothing on the days nothing changed.
--
-- One job per stage, at staggered minutes: the Wayback CDX index shed load
-- with 503/504 when five prefix queries reached it in the same second (the
-- first production run, 16 Sep 2026), and one workbook per invocation is the
-- loader's own rule (546 WORKER_RESOURCE_LIMIT on five at once). 17:00 UTC is
-- 03:00 AEST / 04:00 AEDT, when nobody is generating a report.
--
-- Why `cron_service_role_headers()` rather than `cron_invoke_signed_function`:
-- the loader authorises through `verifyAuth`, which accepts the internal edge
-- secret and a service-role bearer and does not read the signed-internal
-- headers (`verifySignedInternal` in `requestSecurity.ts`); moving the loader
-- onto the signed scheme is a change to its auth, not to its schedule. The
-- URL and the headers are read inside a SECURITY DEFINER function so the job
-- body carries no secret and no project literal — the literal-URL trap the
-- marketing-asset job fell into is recorded in 20261120090000.
--
-- Verified by effect, never by configuration: `cron.job` must hold the eight
-- rows after this applies, and the day's `market_sales_sync` rows are the
-- proof that a run delivered — pg_cron reports on the SQL that queued the
-- request, not on the request.

create or replace function public.market_sales_refresh(stage_body jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
  v_req bigint;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  if v_url is null or length(v_url) = 0 then
    raise exception 'market_sales_refresh: supabase_url not configured in vault';
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/market-sales-ingest',
    headers := public.cron_service_role_headers(),
    body := coalesce(stage_body, '{}'::jsonb),
    timeout_milliseconds := 150000
  ) into v_req;
  return v_req;
end;
$$;

comment on function public.market_sales_refresh(jsonb) is
  'Posts one market-sales-ingest stage from pg_cron. The register is an upsert, so a day on which the publisher released nothing changes nothing.';

revoke all on function public.market_sales_refresh(jsonb) from public;

do $$
declare
  jobs constant jsonb := '[
    ["market-sales-refresh-abs",          "0 17 * * *",  {"stage": "abs"}],
    ["market-sales-refresh-qld",          "5 17 * * *",  {"stage": "qld"}],
    ["market-sales-refresh-nsw",          "10 17 * * *", {"stage": "nsw"}],
    ["market-sales-refresh-vic-houses",   "15 17 * * *", {"stage": "vic", "which": "houses_ts"}],
    ["market-sales-refresh-vic-units",    "20 17 * * *", {"stage": "vic", "which": "units_ts"}],
    ["market-sales-refresh-vic-q-house",  "25 17 * * *", {"stage": "vic", "which": "quarter_house"}],
    ["market-sales-refresh-vic-q-unit",   "30 17 * * *", {"stage": "vic", "which": "quarter_unit"}],
    ["market-sales-refresh-sa",           "35 17 * * *", {"stage": "sa"}]
  ]'::jsonb;
  j jsonb;
  jid bigint;
begin
  for j in select * from jsonb_array_elements(jobs) loop
    for jid in select jobid from cron.job where jobname = j->>0 loop
      perform cron.unschedule(jid);
    end loop;
    perform cron.schedule(
      j->>0,
      j->>1,
      format('select public.market_sales_refresh(%L::jsonb);', (j->2)::text)
    );
    raise notice 'Scheduled %.', j->>0;
  end loop;
end $$;
