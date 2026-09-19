-- Phase 10 (monitoring and ongoing CDD) — risk-based periodic review
-- scheduling, trigger-event reviews, deadline-extension provenance and the
-- relationship-end record (directive §12.9, §18 retention triggers).
--
-- Additive and reversible. Ongoing CDD must continue for the applicable
-- relationship period and stop when the relationship ends — the end is an
-- explicit, reasoned, audited record, never an inferred state, and it never
-- deletes monitoring history.
--
-- ROLLBACK:
--   ALTER TABLE aml.cases
--     DROP COLUMN IF EXISTS monitoring_status,
--     DROP COLUMN IF EXISTS monitoring_status_reason,
--     DROP COLUMN IF EXISTS relationship_ended_at,
--     DROP COLUMN IF EXISTS relationship_end_reason,
--     DROP COLUMN IF EXISTS relationship_end_recorded_by,
--     DROP COLUMN IF EXISTS next_periodic_review_at,
--     DROP COLUMN IF EXISTS last_periodic_review_at;
--   ALTER TABLE aml.existing_customer_reviews
--     DROP COLUMN IF EXISTS trigger_kind,
--     DROP COLUMN IF EXISTS trigger_event_id,
--     DROP COLUMN IF EXISTS original_due_at,
--     DROP COLUMN IF EXISTS extension_count,
--     DROP COLUMN IF EXISTS extension_reason;
--   ALTER TABLE aml.tenant_settings DROP COLUMN IF EXISTS review_interval_config;

-- 1) Relationship lifecycle + periodic-review scheduling on the case ---------
ALTER TABLE aml.cases
  ADD COLUMN IF NOT EXISTS monitoring_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS monitoring_status_reason text,
  ADD COLUMN IF NOT EXISTS relationship_ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS relationship_end_reason text,
  ADD COLUMN IF NOT EXISTS relationship_end_recorded_by uuid,
  ADD COLUMN IF NOT EXISTS next_periodic_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_periodic_review_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aml_cases_monitoring_status_check') THEN
    ALTER TABLE aml.cases ADD CONSTRAINT aml_cases_monitoring_status_check CHECK (
      monitoring_status IN ('active', 'paused', 'ended'));
  END IF;
END $$;

-- Scan support: find cases whose periodic review has fallen due, ignoring
-- relationships that have ended.
CREATE INDEX IF NOT EXISTS aml_cases_next_periodic_review_idx
  ON aml.cases (next_periodic_review_at)
  WHERE monitoring_status = 'active' AND next_periodic_review_at IS NOT NULL;

-- 2) Review provenance: what triggered it, and every deadline change ---------
ALTER TABLE aml.existing_customer_reviews
  ADD COLUMN IF NOT EXISTS trigger_kind text,
  ADD COLUMN IF NOT EXISTS trigger_event_id uuid,
  ADD COLUMN IF NOT EXISTS original_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS extension_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extension_reason text;

-- Backfill the original deadline for existing rows so extensions always have
-- a baseline to compare against.
UPDATE aml.existing_customer_reviews
  SET original_due_at = due_at
  WHERE original_due_at IS NULL AND due_at IS NOT NULL;

-- 3) Risk-based review intervals (tenant-configurable) ----------------------
-- Months between periodic reviews per internal risk rating. The edge function
-- falls back to these defaults when a tenant has no override.
ALTER TABLE aml.tenant_settings
  ADD COLUMN IF NOT EXISTS review_interval_config jsonb NOT NULL DEFAULT
    '{"prohibited": 3, "high": 12, "medium": 24, "low": 36, "unrated": 12}'::jsonb;
