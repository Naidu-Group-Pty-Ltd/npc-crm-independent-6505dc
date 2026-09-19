-- Phase 11 (regulatory and records) — trigger-based retention (directive §18)
-- and the disposal-evidence record.
--
-- §18 is explicit: "Retention must not be implemented as automatic deletion
-- seven years after upload." The clock starts at a recorded TRIGGER EVENT —
-- relationship end, occasional transaction completion, transaction date,
-- program version obsolescence, investigation completion, report completion
-- or legal-hold release — and the minimum retention date is derived from that
-- trigger plus the schedule's retention period. A record with no recorded
-- trigger has not started its clock and is never disposal-eligible.
--
-- Additive and reversible.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS aml.retention_triggers;
--   ALTER TABLE aml.retention_scan_items
--     DROP COLUMN IF EXISTS trigger_id,
--     DROP COLUMN IF EXISTS trigger_kind,
--     DROP COLUMN IF EXISTS trigger_date,
--     DROP COLUMN IF EXISTS minimum_retention_date,
--     DROP COLUMN IF EXISTS legal_basis,
--     DROP COLUMN IF EXISTS privacy_restricted,
--     DROP COLUMN IF EXISTS dependency_blockers,
--     DROP COLUMN IF EXISTS disposal_evidence;

-- 1) Retention triggers (§18) ------------------------------------------------
CREATE TABLE IF NOT EXISTS aml.retention_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  case_id uuid REFERENCES aml.cases(id) ON DELETE CASCADE,
  record_category text NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN (
    'relationship_end',
    'occasional_transaction_complete',
    'transaction_date',
    'program_version_obsolete',
    'investigation_complete',
    'report_complete',
    'legal_hold_release')),
  trigger_date timestamptz NOT NULL,
  legal_basis text NOT NULL,
  retention_years numeric(5,2) NOT NULL CHECK (retention_years >= 0),
  -- Derived and stored so the scan never re-derives the clock at disposal time.
  minimum_retention_date timestamptz NOT NULL,
  privacy_restricted boolean NOT NULL DEFAULT false,
  privacy_restriction_note text,
  disposal_method text NOT NULL DEFAULT 'soft_delete',
  source_note text,
  recorded_by uuid,
  recorded_by_label text,
  superseded_at timestamptz,
  superseded_by uuid REFERENCES aml.retention_triggers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The operative trigger for a record is the latest non-superseded one; the
-- scan reads by (entity_type, entity_id) and by due date.
CREATE INDEX IF NOT EXISTS aml_retention_triggers_entity_idx
  ON aml.retention_triggers (entity_type, entity_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS aml_retention_triggers_due_idx
  ON aml.retention_triggers (minimum_retention_date) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS aml_retention_triggers_case_idx
  ON aml.retention_triggers (case_id);

-- Read for AML roles; writes only through the SECURITY DEFINER edge function
-- so the retention clock cannot be moved from the browser.
ALTER TABLE aml.retention_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aml_retention_triggers_read" ON aml.retention_triggers
  FOR SELECT TO authenticated USING (public.has_any_aml_role(auth.uid()));
GRANT SELECT ON aml.retention_triggers TO authenticated;
GRANT ALL ON aml.retention_triggers TO service_role;

-- 2) Scan-item display contract + disposal evidence (§18) --------------------
-- Every retained record must be able to show its category, legal basis,
-- trigger date, retention period, minimum retention date, hold state, privacy
-- restriction, disposal method, approval state and disposal evidence.
ALTER TABLE aml.retention_scan_items
  ADD COLUMN IF NOT EXISTS trigger_id uuid REFERENCES aml.retention_triggers(id),
  ADD COLUMN IF NOT EXISTS trigger_kind text,
  ADD COLUMN IF NOT EXISTS trigger_date timestamptz,
  ADD COLUMN IF NOT EXISTS minimum_retention_date timestamptz,
  ADD COLUMN IF NOT EXISTS legal_basis text,
  ADD COLUMN IF NOT EXISTS privacy_restricted boolean NOT NULL DEFAULT false,
  -- Why a record could not be disposed of (open report, active obligation,
  -- referenced evidence …). Checked at dry run AND again at execution.
  ADD COLUMN IF NOT EXISTS dependency_blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What was actually done, by whom, when, and to what — written only after
  -- the disposal action succeeds.
  ADD COLUMN IF NOT EXISTS disposal_evidence jsonb;

-- 'blocked' records a dependency stop; the existing dispositions are kept.
DO $$
BEGIN
  ALTER TABLE aml.retention_scan_items DROP CONSTRAINT IF EXISTS retention_scan_items_disposition_check;
  ALTER TABLE aml.retention_scan_items ADD CONSTRAINT retention_scan_items_disposition_check
    CHECK (disposition IN ('pending','held','blocked','approved','disposed','skipped','failed'));
END $$;
