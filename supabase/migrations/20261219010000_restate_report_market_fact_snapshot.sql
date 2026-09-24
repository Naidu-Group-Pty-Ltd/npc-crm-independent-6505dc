-- @effect: select 1 from information_schema.columns where table_schema = 'public' and table_name = 'investment_reports' and column_name = 'market_fact_snapshot'
--
-- Restates `20261119100000`: `investment_reports.market_fact_snapshot`.
--
-- `generate-investment-report` writes this column in its first, progressive
-- and final saves, and `regenerate-report-qualitative` writes it when it
-- rewrites the prose. PostgREST refuses an update that names a column the
-- table does not have, so on a database without it each of those saves fails.
-- The prime and the CRM clone have the column. The three mirror clones do not
-- (measured 23 Sep 2026), for the reason `20261219000000` gives: their ledgers
-- stamp `20261119100000` as accounted for, and Mission Control never re-sends
-- a stamped file.
--
-- The same nullable, additive column and the same comment as the original.
-- Every existing row keeps NULL, which readers already take to mean the
-- report predates the snapshot. Idempotent. `migration-drift` does not count
-- columns, so the probe above states the effect.
ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS market_fact_snapshot jsonb;

COMMENT ON COLUMN public.investment_reports.market_fact_snapshot IS
  'RF-7.2B.1 report-time snapshot of the authoritative market facts used at generation '
  '(value, source, dataset, grain, geography id, reference period, as-of date, gate ruling, '
  'assurance version). NULL means the report predates the snapshot; it is never backfilled.';
