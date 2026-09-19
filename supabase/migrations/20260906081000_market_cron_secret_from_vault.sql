-- The market cron secret is read from the vault, where a non-superuser can put it.
--
-- `agent-planner-run-scheduled` and `market-qa-subscriptions-run-due` sent
-- `x-cron-secret` from `current_setting('app.market_ingestion_cron_secret')`:
-- a database setting nothing had ever set, and nothing COULD. On this platform
-- the `postgres` role is not a superuser, and a placeholder parameter can be
-- set database-wide or on a role only by one — measured 6 Sep 2026 as
-- `42501: permission denied to set parameter "app.market_ingestion_cron_secret"`
-- from the role that owns the database. `coalesce(…, '')` then turned that
-- absence into an EMPTY credential, and the ten market functions comparing the
-- header against `MARKET_INGESTION_CRON_SECRET` answered 401 to every tick, on
-- the prime and on every clone that mirrors it.
--
-- The vault is writable by this role (the internal signing pair already lives
-- there), so the header reads `market_ingestion_cron_secret` from
-- `vault.decrypted_secrets` — with no fallback. An absent secret is a NULL
-- header the function refuses, never an empty one it might not. Mission
-- Control's prime-secret-pairs job writes the vault half and the environment
-- half together, and its clone sweep gives each clone its OWN pair.
--
-- Neither job was declared by any migration before this; both were scheduled
-- by hand. This file is now their declaration, so a replay from empty carries
-- them. Idempotent: unschedule by name, then schedule.

do $market_cron$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron is not installed; market cron jobs not rescheduled';
    return;
  end if;

  perform cron.unschedule(jobid) from cron.job where jobname = 'agent-planner-run-scheduled';
  perform cron.schedule(
    'agent-planner-run-scheduled',
    '*/5 * * * *',
    $job$
    select net.http_post(
      url     := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/agent-planner',
      headers := public.cron_signed_internal_headers(
        'POST', 'agent-planner',
        jsonb_build_object('action','run-scheduled'),
        'pg_cron',
        jsonb_build_object('x-cron-secret', (
          select decrypted_secret from vault.decrypted_secrets
           where name = 'market_ingestion_cron_secret' limit 1))
      ),
      body    := jsonb_build_object('action','run-scheduled')
    );
    $job$
  );

  perform cron.unschedule(jobid) from cron.job where jobname = 'market-qa-subscriptions-run-due';
  perform cron.schedule(
    'market-qa-subscriptions-run-due',
    '20 * * * *',
    $job$
    select net.http_post(
      url     := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/market-qa-subscriptions',
      headers := public.cron_signed_internal_headers(
        'POST', 'market-qa-subscriptions',
        jsonb_build_object('action','run-due'),
        'pg_cron',
        jsonb_build_object('x-cron-secret', (
          select decrypted_secret from vault.decrypted_secrets
           where name = 'market_ingestion_cron_secret' limit 1))
      ),
      body    := jsonb_build_object('action','run-due')
    );
    $job$
  );
end $market_cron$;
