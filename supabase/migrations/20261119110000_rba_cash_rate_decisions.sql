-- RF-7.2B.1 §1 — the RBA's own Cash Rate Target decision history.
--
-- Why a separate source when F1 is already loaded: F1's `FIRMMCCRT` column
-- records only NON-ZERO changes. Measured over the whole published series on
-- 11 Sep 2026 its distinct values are -0.50, -0.25, -0.15, 0.25 and 0.50, and
-- it carries no 0 anywhere. So F1 can say when the target last MOVED but not
-- when the current target took EFFECT, and those are different dates whenever
-- the Board meets and holds.
--
-- On 11 Sep 2026 the RBA publishes "Cash Rate Target 4.35%, effective
-- 12 August 2026", while the last change was 6 May 2026 — the Board met on
-- 17 June and 12 August and left the rate where it was. Deriving the effective
-- date from F1 would have reported a date three months stale under the RBA's
-- own label.
--
-- One row per published decision, including the holds, which are the whole
-- point. `change_points` and `target_percent` are nullable because the RBA
-- published the target as a RANGE in 1990 (seven rows, newest 4 Jul 1990,
-- e.g. "15.00 to 15.50"); those rows are kept with their verbatim text rather
-- than dropped, so a truncated download can never be mistaken for a short
-- history.
CREATE TABLE IF NOT EXISTS public.rba_cash_rate_decisions (
  effective_date  date PRIMARY KEY,
  change_points   numeric NULL,
  target_percent  numeric NULL,
  target_text     text NOT NULL,
  source          text NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.rba_cash_rate_decisions IS
  'RBA Cash Rate Target decision history (rba.gov.au/statistics/cash-rate), one row per '
  'published decision INCLUDING unchanged ones. The authority for the current target''s '
  'effective date, which statistical table F1 cannot supply because its change column '
  'omits holds.';
COMMENT ON COLUMN public.rba_cash_rate_decisions.change_points IS
  'Percentage points; 0 for a hold. NULL only for the 1990 rows the RBA published as a range.';
COMMENT ON COLUMN public.rba_cash_rate_decisions.target_text IS
  'Verbatim from the RBA page, so a 1990 range is preserved rather than lost to NULL.';

-- RLS on with NO policy, matching `rba_series_meta` / `rba_observations` in
-- 20261112090000_rba_series.sql exactly: this reference data is reached only
-- through `rba-data-service`, which holds the service role and bypasses RLS.
-- Adding an authenticated SELECT policy here would widen access beyond its
-- siblings for no caller that exists.
ALTER TABLE public.rba_cash_rate_decisions ENABLE ROW LEVEL SECURITY;
