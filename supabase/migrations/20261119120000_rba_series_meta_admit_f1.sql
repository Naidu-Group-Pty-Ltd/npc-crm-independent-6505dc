-- RF-7.2B.1 activation fix — `rba_series_meta.table_code` must admit 'f1'.
--
-- ## What happened
--
-- RF-7.2B.1 added F1 (the DAILY money-market table) as a source, because F1.1's
-- monthly AVERAGE cannot state the cash rate target in force. `RbaTableCode` in
-- `_shared/rbaTables.pure.ts` gained `'f1'`, `RBA_WANTED_SERIES` gained
-- `FIRMMCRTD` and `FIRMMCCRT`, and `rba-tables-ingest` learned to accept the
-- table — but the CHECK constraint on this column was never widened with them.
-- It still read:
--
--     check (table_code in ('f1.1', 'g1', 'f5'))
--
-- So the very first production F1 load failed, in the exact shape the code
-- vocabulary predicts:
--
--     rba_series_meta upsert failed for FIRMMCRTD: new row for relation
--     "rba_series_meta" violates check constraint
--     "rba_series_meta_table_code_check"
--
-- Found by the RF-7.2B.1 §9c post-deploy activation check, on the first real
-- attempt rather than by inspection. The function failed CLOSED and wrote
-- nothing, which is correct — but F1 could not load at all, so the cash-rate
-- target had no value cross-check and the "in force as at" row could never be
-- stated.
--
-- ## Why the enum is widened rather than dropped
--
-- The constraint is doing real work: it is what stops a typo'd table code
-- entering the series register and producing a reading nobody can trace to a
-- published table. The answer is to admit the code the product now loads, not
-- to stop checking.
--
-- ## The class, which this repository has now met three times
--
-- A code-side vocabulary extension with no matching database constraint change:
-- `template_library_entries_category_check` vs `TemplateLibraryCategory`,
-- `report_geography.method` vs the sweep's `'point_in_polygon'`, and this. The
-- column decides; the TypeScript union only proposes. `rbaTableCodes.spec.ts`
-- now reads this migration and `RbaTableCode` and fails when they disagree.
--
-- Idempotent, additive, and no data is touched: widening a CHECK cannot
-- invalidate a row that already satisfies the narrower one.

BEGIN;

ALTER TABLE public.rba_series_meta
  DROP CONSTRAINT IF EXISTS rba_series_meta_table_code_check;

ALTER TABLE public.rba_series_meta
  ADD CONSTRAINT rba_series_meta_table_code_check
  CHECK (table_code IN ('f1', 'f1.1', 'g1', 'f5'));

COMMENT ON COLUMN public.rba_series_meta.table_code IS
  'Which published RBA statistical table this series comes from: f1 (daily '
  'money market — the cash rate target ON A DATE), f1.1 (monthly average), '
  'g1 (inflation), f5 (lending rates). Kept in step with RbaTableCode in '
  '_shared/rbaTables.pure.ts by rbaTableCodes.spec.ts.';

COMMIT;
