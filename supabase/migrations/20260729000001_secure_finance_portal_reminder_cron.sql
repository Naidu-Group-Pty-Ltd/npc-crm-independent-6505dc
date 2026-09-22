-- Replace the public-anon-key reminder cron authorization with a dedicated secret.
-- Provision the same random value as the Edge Function secret
-- FINANCE_PORTAL_CRON_SECRET and as the Vault secret finance_portal_cron_secret.
-- The public anon key remains only an API gateway credential, never authorization.

do $migration$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'finance-portal-reminders-hourly';

    if exists (
      select 1
      from vault.decrypted_secrets
      where name = 'finance_portal_cron_secret'
        and length(decrypted_secret) >= 16
    ) then
      perform cron.schedule(
        'finance-portal-reminders-hourly',
        '15 * * * *',
        $job$
        select net.http_post(
          url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/finance-portal-batch6',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name in ('supabase_anon_key', 'SUPABASE_ANON_KEY')
              order by (name = 'supabase_anon_key') desc
              limit 1
            ),
            'x-cron-secret', (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'finance_portal_cron_secret'
              limit 1
            )
          ),
          body := jsonb_build_object('operation', 'reminders_run_due')
        );
        $job$
      );
    end if;
  end if;
end
$migration$;
