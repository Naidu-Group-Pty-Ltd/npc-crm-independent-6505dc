-- Fires the approvals and projections first loads again, but only on a
-- database where they never landed.
--
-- `20261214000000` and `20261218020000` fire each register's first load once,
-- and Mission Control delivered both to every mirror clone. On a clone the
-- load runs in that clone's own `market-sales-ingest`, and those functions
-- were older than the migrations that called them. Measured 23 Sep 2026 in
-- each clone's `function_edge_logs`: `npc-test-76b3b3` and
-- `preflight-property-group` refuse the `approvals` stage, and every mirror
-- refuses `projections`. Each call answered HTTP 400, so the tables are empty
-- there while the prime holds 138,152 approvals rows and all five projection
-- files.
--
-- A delivered migration is never delivered twice, so those two files cannot
-- try again. The hourly approvals job repairs itself once the function is
-- current, but the projections jobs first run on the 3rd of next month. This
-- file is the second attempt, and it fires only where there is nothing yet:
-- every call is guarded by a `where not exists` on the slice it loads. On the
-- prime, and on any clone the first load reached, it posts nothing.
--
-- ## The shipping order, which is not interchangeable
--
-- Apply this only after Mission Control has redeployed `market-sales-ingest`
-- on every clone. Applied before that, each call answers the same HTTP 400,
-- and the file is recorded as done without anything having loaded, which is
-- `20261214000000`'s first finding over again. The ingest code is already
-- current in every mirror repository; what lags is the deployed function.
--
-- It is safe to apply more than once, for the reasons the two files above
-- give: both registers are keyed on the publisher's own identifiers, so a
-- second run of a slice replaces it rather than adding to it, and each prune
-- keeps to its own edition and series. Tasmania stays out, as in
-- `20261218020000`, because its licence decision has not been made.
--
-- No `@effect` probe, for `20261214000000`'s reason: `net.http_post` queues
-- the request, and the load lands afterwards in the edge function. The effect
-- is checked where it lands: `market_sales_sync` rows with a `stage` of
-- `approvals` or `projections`, and the rows each register now holds.
select public.market_sales_refresh('{"stage": "approvals"}'::jsonb)
 where not exists (select 1 from public.market_building_approvals);

select public.market_sales_refresh('{"stage": "projections", "file": "nsw_sa2"}'::jsonb)
 where not exists (select 1 from public.population_projections where state = 'NSW' and area_kind = 'sa2');

select public.market_sales_refresh('{"stage": "projections", "file": "nsw_lga"}'::jsonb)
 where not exists (select 1 from public.population_projections where state = 'NSW' and area_kind = 'lga');

select public.market_sales_refresh('{"stage": "projections", "file": "vic_lga"}'::jsonb)
 where not exists (select 1 from public.population_projections where state = 'VIC' and area_kind = 'lga');

select public.market_sales_refresh('{"stage": "projections", "file": "qld_sa2"}'::jsonb)
 where not exists (select 1 from public.population_projections where state = 'QLD' and area_kind = 'sa2');

select public.market_sales_refresh('{"stage": "projections", "file": "qld_lga"}'::jsonb)
 where not exists (select 1 from public.population_projections where state = 'QLD' and area_kind = 'lga');
