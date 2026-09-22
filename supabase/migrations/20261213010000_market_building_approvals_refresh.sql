-- The supply register refreshes itself, on the schedule the sales register
-- already runs on.
--
-- @effect: select 1 from cron.job where jobname = 'market-sales-refresh-approvals'
--
-- One more job on `public.market_sales_refresh(jsonb)`, which
-- 20261127090000 already created and which posts one stage to
-- `market-sales-ingest` from pg_cron. Nothing new is invented here: the same
-- SECURITY DEFINER function, the same `cron_service_role_headers()`, the same
-- vault-held URL, so the job body still carries no secret and no project
-- literal.
--
-- 17:45 UTC — 03:45 AEST / 04:45 AEDT, after the eight sales stages at
-- :00 through :35, and staggered from them for the loader's own reason: one
-- heavy download per invocation (546 WORKER_RESOURCE_LIMIT on five at once).
-- The ABS is a different host from the archive the VIC and SA stages read, so
-- this is politeness to our own egress rather than to theirs.
--
-- The ABS publishes monthly and this asks daily, which is deliberate and is
-- the sales register's rule: a reading is the newest publication its source
-- has released as of the day it is asked for, the upsert changes nothing on
-- the days nothing changed, and a revision the ABS issues is picked up the
-- next morning rather than at the next quarter.
--
-- Asserted by effect, never by configuration: `cron.job` must hold this row
-- after the migration applies, and the day's `market_sales_sync` rows are the
-- proof a run DELIVERED — pg_cron reports on the SQL that queued the request,
-- not on the request.

do $$
declare
  jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'market-sales-refresh-approvals' loop
    perform cron.unschedule(jid);
  end loop;
  perform cron.schedule(
    'market-sales-refresh-approvals',
    '45 17 * * *',
    $job$select public.market_sales_refresh('{"stage": "approvals"}'::jsonb);$job$
  );
  raise notice 'Scheduled market-sales-refresh-approvals.';
end $$;
