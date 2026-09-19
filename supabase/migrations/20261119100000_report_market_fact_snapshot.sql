-- RF-7.2B.1 — the report-time market-fact snapshot.
--
-- A generated report quotes facts that come from tables the platform keeps
-- refreshing: the ABS Census projection, the RBA statistical tables. Reopening
-- a report a year later and re-reading those tables would change what the
-- document appears to have said, silently, with no version and no trace. That
-- is the failure this column prevents.
--
-- It stores, per authoritative fact the report used: the value, its source,
-- the dataset or series it came from, the geography grain and identifier, the
-- reference period, the as-of/publication date, the gate's ruling, and the
-- assurance versions the snapshot was produced under. Enough to reproduce what
-- the client was shown, without re-querying anything.
--
-- Deliberately additive and nullable. Every existing row keeps NULL: this is a
-- forward-only change, no historical report is rewritten, and a reader must
-- treat NULL as "this report predates the snapshot" rather than as an empty
-- snapshot. Nothing backfills it.
ALTER TABLE public.investment_reports
  ADD COLUMN IF NOT EXISTS market_fact_snapshot jsonb;

COMMENT ON COLUMN public.investment_reports.market_fact_snapshot IS
  'RF-7.2B.1 report-time snapshot of the authoritative market facts used at generation '
  '(value, source, dataset, grain, geography id, reference period, as-of date, gate ruling, '
  'assurance version). NULL means the report predates the snapshot; it is never backfilled.';
