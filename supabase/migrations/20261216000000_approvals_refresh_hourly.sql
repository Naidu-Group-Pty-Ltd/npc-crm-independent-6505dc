-- The supply register asks hourly, because a settled run asks nothing.
--
-- @effect: select 1 from cron.job where jobname = 'market-sales-refresh-approvals' and schedule = '20 * * * *'
--
-- `20261213010000` scheduled this once a day at 17:45, which was the right
-- cadence for a loader that read ONE window and needed a page index from a
-- caller. It no longer does: `planApprovalsWork` derives each run's window
-- from the register's own two edges — newest month held and oldest month held
-- — so every invocation deepens the register by one window until it reaches
-- `REGISTER_FLOOR_PERIOD`, then reports `settled` and asks the publisher
-- nothing at all.
--
-- That changes what a schedule costs. Daily, a 24-month register is eight
-- nights away and a revision the Bureau issues waits up to a day. Hourly, it
-- converges in about eight hours and then **each run is one table read** — the
-- planner returns `settled` without a single request to the ABS. Frequency is
-- therefore nearly free after convergence, which is the property that makes
-- accuracy affordable rather than expensive.
--
-- Three things this does NOT do.
--
-- It does not hammer the Bureau. Currency is a CADENCE in the planner — one
-- frontier read per calendar month, read from the `loaded_at` the register
-- already holds — precisely because `asOf > frontier` is always true against
-- a publisher two months in arrears and would have re-read the frontier every
-- hour for ever. After convergence the ABS is asked once a month.
--
-- It does not overlap itself. One page is ~10 s against an hourly tick, and
-- the loader's own rule is one heavy read per invocation (546
-- WORKER_RESOURCE_LIMIT on five at once); minute 20 also keeps it clear of the
-- eight sales stages at :00 through :35 of 17:00.
--
-- And it does not need dialling back once the register is full. A settled run
-- is cheaper than the cron entry that fires it, so leaving it hourly is what
-- keeps the register current within an hour of a Bureau release rather than
-- within a day — and on a clone with an empty register it is what walks the
-- register up with nobody scheduling anything.
--
-- Asserted by effect, never by configuration: `cron.job` must hold this row
-- at this schedule after the migration applies, and the day's
-- `market_sales_sync` rows are the proof a run DELIVERED — pg_cron reports on
-- the SQL that queued the request, not on the request.

do $$
declare
  jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'market-sales-refresh-approvals' loop
    perform cron.unschedule(jid);
  end loop;
  perform cron.schedule(
    'market-sales-refresh-approvals',
    '20 * * * *',
    $job$select public.market_sales_refresh('{"stage": "approvals"}'::jsonb);$job$
  );
  raise notice 'Rescheduled market-sales-refresh-approvals hourly at minute 20.';
end $$;
