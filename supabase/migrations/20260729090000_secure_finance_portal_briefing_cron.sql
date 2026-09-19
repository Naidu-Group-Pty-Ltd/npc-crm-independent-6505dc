-- Replace the public-anon briefing schedules with signed pg_cron invocations.
-- cron_invoke_signed_function reads signing material from Vault and fails closed
-- when the required secrets have not been provisioned.
do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
      from cron.job
      where jobname in ('finance-portal-morning-briefing', 'finance-portal-eod-wrap');

    perform cron.schedule(
      'finance-portal-morning-briefing',
      '0 20 * * *',
      $job$select public.cron_invoke_signed_function('finance-portal-briefing-runner', '{"mode":"morning"}'::jsonb, 'pg_cron');$job$
    );

    perform cron.schedule(
      'finance-portal-eod-wrap',
      '0 6 * * *',
      $job$select public.cron_invoke_signed_function('finance-portal-briefing-runner', '{"mode":"eod"}'::jsonb, 'pg_cron');$job$
    );
  end if;
end
$cron$;
