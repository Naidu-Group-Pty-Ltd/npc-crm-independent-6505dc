-- @effect: select 1 from cron.job where jobname = 'urban-centre-register-refresh'
-- The line above is this file's own statement of what is true once it has
-- run. It exists because this migration creates no object, so
-- `scripts/ops/migration-drift.mjs` has nothing to count and would report
-- it as unverifiable — which is exactly how seed v18 merged to main, never
-- landed, and left every report printing the heading it was written to fix.
-- Read-only by construction: the runner refuses anything that is not a
-- lone SELECT.
-- The urban-centre register refreshes itself monthly, and monthly is the point.
--
-- The cadence of a register should be the cadence of its publisher, and this
-- one could hardly differ more from the sales register beside it.
-- `market_sales_medians` reads quarterly publications whose archive captures
-- land on no schedule of ours, so the only way to hold "the newest publication
-- as of today" is to ask every day. The ASGS release is a CONSTANT IN CODE
-- (`ASGS_RELEASE`, `asgsGeography.pure.ts`) and the ABS reissues it about
-- every five years, so asking daily would buy nothing a code change did not
-- already require.
--
-- What a schedule DOES buy here is the thing a migration cannot:
-- clone self-healing. `CLONE_PROVISIONING_GAPS.md` measured that the rows a
-- migration INSERTs do not travel — seven `market_sources` seeding migrations
-- recorded as applied against a table holding zero rows, behind 310 ingestion
-- runs that had produced nothing. A register loaded only by hand on the prime
-- is therefore empty on every clone while looking, from the ledger, exactly
-- like it is full. One request a month heals that, and retries a load that
-- failed its plausibility bounds.
--
-- 18:10 UTC is 04:10 AEST / 05:10 AEDT, off the hour and clear of the
-- 17:00-17:35 band the sales register's eight staggered jobs occupy.
--
-- The loader is idempotent by construction — upsert every centre, then prune
-- the codes this load did not carry — so a month in which the ABS released
-- nothing changes nothing.

do $$
declare
  jid bigint;
begin
  for jid in select jobid from cron.job where jobname = 'urban-centre-register-refresh' loop
    perform cron.unschedule(jid);
  end loop;
  perform cron.schedule(
    'urban-centre-register-refresh',
    '10 18 1 * *',
    'select public.urban_centre_refresh(''{}''::jsonb);'
  );
  raise notice 'Scheduled urban-centre-register-refresh.';
end $$;
