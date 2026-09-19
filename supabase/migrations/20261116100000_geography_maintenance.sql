-- ME-5.1 item 7 — canonical geography becomes maintained infrastructure.
--
-- `report_geography` was populated once by a backfill and nothing kept it
-- current: a grep of the fleet found the table named only in pure modules and
-- specs. A derived table that only a backfill maintains is correct on the day
-- it lands and silently stale from the next one.
--
-- Three columns make maintenance possible without re-resolving what has not
-- changed:
--
--   * `coordinate_fingerprint` — the coordinate the geography was derived FROM,
--     rounded to ~1 m. Reconciliation compares it to the report's current
--     coordinate, so an unchanged point costs nothing and a moved one is
--     re-resolved. It is a fingerprint of the SOURCE, never a replacement for
--     it: `investment_reports.location_intelligence` keeps exactly the bytes it
--     was written with.
--
--   * `methodology_version` — which resolver produced the row. A row written by
--     an older methodology is re-resolvable without re-resolving everything.
--
--   * `resolution_attempts` / `last_attempt_at` — so a failure is retried with
--     a bound rather than for ever, and so a permanently-failing row is
--     visible rather than silently absent.
--
-- Idempotency is the primary key: one row per report, upserted. There is no
-- path that writes a second row for the same report.

BEGIN;

ALTER TABLE public.report_geography
  ADD COLUMN IF NOT EXISTS coordinate_fingerprint text,
  ADD COLUMN IF NOT EXISTS methodology_version    text NOT NULL DEFAULT 'me5.0',
  ADD COLUMN IF NOT EXISTS resolution_attempts    integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_attempt_at        timestamptz;

COMMENT ON COLUMN public.report_geography.coordinate_fingerprint IS
  'The coordinate this geography was derived from, rounded to ~1 m. Reconciliation '
  'compares it against the report''s current coordinate so unchanged points are never '
  're-resolved. A fingerprint of the source, never a replacement for it.';

COMMENT ON COLUMN public.report_geography.methodology_version IS
  'Which resolver produced this row, so a methodology change can re-resolve only what '
  'it affects rather than the whole corpus.';

-- Backfill the fingerprint for rows the ME-5 pass already resolved, so
-- reconciliation does not immediately re-resolve all 1,114.
UPDATE public.report_geography
SET coordinate_fingerprint = round(latitude::numeric, 5) || ',' || round(longitude::numeric, 5)
WHERE coordinate_fingerprint IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

-- What reconciliation looks for: no row, a stale methodology, or a failure
-- worth retrying. Partial so it stays small as the corpus grows.
CREATE INDEX IF NOT EXISTS report_geography_needs_attention_idx
  ON public.report_geography (methodology_version, status, resolution_attempts)
  WHERE status <> 'resolved' OR methodology_version <> 'me5.1';

COMMIT;
