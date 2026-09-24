-- The forward-demand register refreshes itself, one projection workbook per
-- job, on the schedule a projection actually changes on.
--
-- @effect: select 1 from cron.job where jobname = 'market-sales-refresh-projections-vic-lga'
--
-- One job per workbook on `public.market_sales_refresh(jsonb)` — the SECURITY
-- DEFINER function 20261127090000 created, posting one `market-sales-ingest`
-- stage with `cron_service_role_headers()` and the vault-held URL, so no job
-- body carries a secret or a project literal. Nothing new is invented here.
--
-- Monthly, not daily. A jurisdiction reissues its projections every one to
-- three years, and the sales register asks daily because a quarterly
-- publisher's newest quarter is what a reading must be; a projection edition
-- is not a quarter. A month is still frequent enough to be clone
-- self-healing: a deployment provisioned without these rows fills itself
-- within one, because the rows a migration INSERTs never travel to a clone
-- (docs/operations/CLONE_PROVISIONING_GAPS.md) and this table is seeded by
-- nothing.
--
-- Staggered five minutes apart on the 3rd of the month, 18:05 UTC onward
-- (04:05 AEST, when nobody is generating a report), for the loader's own rule:
-- ONE heavy workbook per invocation — five DCJ workbooks in one call hit the
-- edge worker's compute allowance (546 WORKER_RESOURCE_LIMIT, 15 Sep 2026) —
-- and the archive's CDX index sheds load under concurrent asks, which the
-- Victorian file is read through.
--
-- A file whose licence has not been read from its publisher is REFUSED by the
-- loader, and that refusal is written to `market_sales_sync` every month
-- until it is read. That is deliberate: a job that is scheduled and refuses
-- says so where an operator looks, while a job that was never scheduled says
-- nothing at all.
--
-- ## The shipping order
--
-- This file and 20261218000000 (the table) apply AFTER `market-sales-ingest`
-- with the `projections` stage is deployed, never before: the approvals
-- register's first run answered HTTP 400 in five milliseconds because its
-- table and job landed while the deployed function did not know the stage
-- (20261214000000). A green cron run is not a delivered request — the day's
-- `market_sales_sync` rows are the proof:
--
--   select created_at, detail->>'file' file, detail->>'refused' refused,
--          detail->>'rows_written' rows, detail->>'via' via
--   from public.market_sales_sync
--   where detail->>'stage' = 'projections' order by created_at desc limit 12;

do $$
declare
  jobs constant jsonb := '[
    ["market-sales-refresh-projections-nsw-sa2",    "5 18 3 * *",  {"stage": "projections", "file": "nsw_sa2"}],
    ["market-sales-refresh-projections-nsw-lga",    "10 18 3 * *", {"stage": "projections", "file": "nsw_lga"}],
    ["market-sales-refresh-projections-vic-lga",    "15 18 3 * *", {"stage": "projections", "file": "vic_lga"}],
    ["market-sales-refresh-projections-qld-sa2",    "20 18 3 * *", {"stage": "projections", "file": "qld_sa2"}],
    ["market-sales-refresh-projections-qld-lga",    "25 18 3 * *", {"stage": "projections", "file": "qld_lga"}],
    ["market-sales-refresh-projections-tas-medium", "30 18 3 * *", {"stage": "projections", "file": "tas_medium"}],
    ["market-sales-refresh-projections-tas-high",   "35 18 3 * *", {"stage": "projections", "file": "tas_high"}],
    ["market-sales-refresh-projections-tas-low",    "40 18 3 * *", {"stage": "projections", "file": "tas_low"}]
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
