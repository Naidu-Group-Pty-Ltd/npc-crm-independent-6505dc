do $archive_retention$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'market-updates-archive-purge-daily';
  end if;
end;
$archive_retention$;

create or replace function public.purge_expired_market_updates_archive()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise log 'market_updates archive purge skipped: archived articles have indefinite reversible retention';
  return 0;
end;
$$;

revoke all on function public.purge_expired_market_updates_archive()
  from public, anon, authenticated;
grant execute on function public.purge_expired_market_updates_archive()
  to service_role;