-- Re-run one investment report from the server.
--
-- The product regenerates a report from a browser: `useChunkedRegeneration`
-- drives the section loop and the cron watchdog (`resume-investment-reports`)
-- picks up anything that stalls. There has never been a way to start one
-- without a browser, which is what an operator needs when a report has to be
-- re-run because the EVIDENCE behind it changed rather than because a run
-- failed — a newly loaded register, a provider that came back, a corrected
-- input.
--
-- The pattern is `market_sales_refresh`'s and `urban_centre_refresh`'s, for
-- the same reasons: the URL and the headers are read inside a SECURITY
-- DEFINER function, so no caller handles a secret and no job body carries a
-- project literal.
--
-- It starts a run and does not finish one. A Compass is fourteen sections at
-- roughly 25 s against a ~125 s invocation budget, so the generator hands off
-- and the existing watchdog resumes it under its own `resume_attempts < 8`
-- bound. Nothing here loops, retries or schedules.

create or replace function public.regenerate_investment_report(
  report_id uuid,
  continue_from boolean default false
)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_url text;
  v_req bigint;
begin
  if report_id is null then
    raise exception 'regenerate_investment_report: a report id is required';
  end if;
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  if v_url is null or length(v_url) = 0 then
    raise exception 'regenerate_investment_report: supabase_url not configured in vault';
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/generate-investment-report',
    headers := public.cron_service_role_headers(),
    body := jsonb_build_object('reportId', report_id, 'continueFrom', continue_from),
    timeout_milliseconds := 150000
  ) into v_req;
  return v_req;
end;
$$;

comment on function public.regenerate_investment_report(uuid, boolean) is
  'Starts (or continues) one investment report generation from the server. The cron watchdog resumes it; this schedules nothing and retries nothing.';

revoke all on function public.regenerate_investment_report(uuid, boolean) from public, anon, authenticated;
grant execute on function public.regenerate_investment_report(uuid, boolean) to postgres, service_role;
