-- AUSTRAC reports — somewhere for a finished report to go.
--
-- THE PROBLEM. `delete_report` refuses anything past the draft statuses, and
-- that is correct: an approved, lodged, acknowledged, rejected or withdrawn
-- report is a RETAINED RECORD, kept for seven years with the evidence behind
-- it. So the register lists every report the entity has ever made, for ever,
-- and the two that still need something are buried among the ones that do
-- not.
--
-- THE ANSWER, AND WHAT IT IS NOT. Archiving hides a row from the working list
-- and keeps every byte of it — the row, its versions, its submissions, its
-- receipts and its case events. Nothing is deleted, nothing is redacted, and
-- it is reversible. `archived_at` is the whole mechanism; `archived_by`
-- records who, because a compliance record's disappearance from a list is
-- itself worth being able to explain.
--
-- THE RULE THE SERVER ENFORCES ON TOP OF THIS. A report may be archived only
-- once nothing is owed to AUSTRAC — see `_shared/aml/austracArchive.pure.ts`.
-- An archive that can hide an approved-but-unlodged Suspicious Matter Report
-- is not a tidy-up feature, it is a way to lose a statutory deadline.
--
-- Additive and idempotent: two nullable columns, no default, no backfill. An
-- existing row reads NULL, which is "not archived", which is what every row
-- was before this ran.

ALTER TABLE aml.reports
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

COMMENT ON COLUMN aml.reports.archived_at IS
  'When the report was put away. NULL means it is on the working register. Archiving never deletes: the row, its versions, its submissions and its receipts are all retained.';
COMMENT ON COLUMN aml.reports.archived_by IS
  'Who archived it. Kept because a record disappearing from a list is itself worth being able to explain.';

-- The register reads "not archived" on every page load, and the archived view
-- is the rarer one. A partial index over the live rows is what that query
-- actually wants.
CREATE INDEX IF NOT EXISTS reports_live_created_idx
  ON aml.reports (created_at DESC)
  WHERE archived_at IS NULL;
