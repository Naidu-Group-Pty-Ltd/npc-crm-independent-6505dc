-- Retention for the raw identity captures the Standalone journey stores.
--
-- The NPC capture journey writes a customer's identity document and their face
-- into `aml-documents` and `aml-biometrics`. Nothing has ever deleted them.
-- This adds the machinery that can — and, deliberately, does not decide when.
--
-- ## This does NOT introduce a retention period
--
-- `20260726140000_aml_retention_triggers.sql` records the programme's §18
-- position and it is explicit:
--
--   "Retention must not be implemented as automatic deletion seven years after
--    upload." The clock starts at a recorded TRIGGER EVENT, and a record with
--    no recorded trigger has not started its clock and is never
--    disposal-eligible.
--
-- So the cleanup worker requires BOTH clocks to have run out: the case's live
-- `aml.retention_triggers.minimum_retention_date`, and a configured
-- `AML_IDV_CAPTURE_RETENTION_DAYS` floor on the age of the capture itself.
-- With no configuration it deletes nothing and reports "not configured"; with
-- no trigger it deletes nothing and reports "awaiting retention trigger". The
-- duration is a compliance decision and neither this migration nor the code
-- makes one.
--
-- That is also what NPC has already told these customers. The biometric
-- consent (catalogue 2026.2) says their facial image is "kept for the
-- record-keeping period required by anti-money laundering law, measured from
-- the end of our business relationship with you, and are then destroyed" —
-- which is §18's trigger model, not a counter from upload.
--
-- ## Why three columns rather than jsonb
--
-- The per-object detail DOES go in `outcome_detail.standalone.capture_retention`,
-- because it is evidence and that is where evidence lives. These three carry
-- the parts that have to be queryable:
--
--   * `capture_deleted_at` is the candidate-scan predicate. A jsonb path test
--     cannot use an index, so without a column the daily scan would read every
--     settled check ever written, for ever, and get slower every week.
--   * `capture_cleanup_status` lets an operator find partial failures — the
--     expected outcome of a storage hiccup mid-sequence — without unpacking a
--     jsonb blob that also holds provider evidence.
--   * `capture_retention_days_used` records the policy that was in force when
--     the deletion happened, which is the question an auditor asks and the one
--     a later configuration change would otherwise erase.
--
-- Additive, idempotent, and it rewrites no existing row.
--
-- ROLLBACK:
--   SELECT cron.unschedule('aml-idv-retention-daily');
--   DROP INDEX IF EXISTS aml.idx_aml_verification_capture_retention;
--   ALTER TABLE aml.verification_checks
--     DROP COLUMN IF EXISTS capture_deleted_at,
--     DROP COLUMN IF EXISTS capture_cleanup_status,
--     DROP COLUMN IF EXISTS capture_retention_days_used;

ALTER TABLE aml.verification_checks
  ADD COLUMN IF NOT EXISTS capture_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS capture_cleanup_status text
    CHECK (capture_cleanup_status IS NULL OR capture_cleanup_status IN
      ('deleted', 'partial', 'failed', 'refused')),
  ADD COLUMN IF NOT EXISTS capture_retention_days_used integer
    CHECK (capture_retention_days_used IS NULL OR capture_retention_days_used > 0);

COMMENT ON COLUMN aml.verification_checks.capture_deleted_at IS
  'When the raw identity captures for this attempt were destroyed. NULL means '
  'they are still in aml-documents/aml-biometrics — which is also true for '
  'every attempt whose AML retention trigger (§18) has not run out. Set only '
  'when EVERY recorded object was removed; a partial run leaves it NULL so the '
  'next pass finishes the job.';
COMMENT ON COLUMN aml.verification_checks.capture_cleanup_status IS
  'Roll-up of the last cleanup pass: deleted | partial | failed | refused. '
  '"partial" is expected and safely re-runnable, not a bug.';
COMMENT ON COLUMN aml.verification_checks.capture_retention_days_used IS
  'The AML_IDV_CAPTURE_RETENTION_DAYS value in force when the captures were '
  'destroyed. Recorded per row so a later policy change cannot rewrite the '
  'basis on which past evidence was disposed of.';

-- The candidate scan: settled attempts whose captures are still present.
-- Ordered by completion so the oldest evidence is always considered first.
CREATE INDEX IF NOT EXISTS idx_aml_verification_capture_retention
  ON aml.verification_checks (processing_completed_at)
  WHERE check_type = 'electronic_idv'
    AND capture_deleted_at IS NULL
    AND processing_completed_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Daily, and deliberately not more often.
--
-- Retention is measured in years; an attempt that waits one more day for its
-- turn has waited years already. It is kept OFF the verification processor's
-- one-minute schedule on purpose — processing a customer's submission and
-- destroying their evidence are different responsibilities with different
-- blast radii, and a bug in either must not be able to drive the other.
--
-- 03:17 UTC: outside the business day in both Australian time zones, and on a
-- minute nothing else in this project uses, so the daily jobs do not all wake
-- at :00 and contend.
--
-- Safe to run when nothing is configured: with no AML_IDV_CAPTURE_RETENTION_DAYS
-- the worker deletes nothing and answers `configured: false`. Scheduling it
-- before the policy exists is therefore harmless, and means the schedule is
-- already in place when the policy is decided.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('aml-idv-retention-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aml-idv-retention-daily');

    PERFORM cron.schedule(
      'aml-idv-retention-daily',
      '17 3 * * *',
      $job$SELECT public.cron_invoke_signed_function('aml-idv-retention', '{}'::jsonb, 'pg_cron');$job$
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'aml' AND table_name = 'verification_checks'
       AND column_name = 'capture_deleted_at'
  ) THEN
    RAISE EXCEPTION 'idv capture retention did not converge: capture_deleted_at missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'aml' AND indexname = 'idx_aml_verification_capture_retention'
  ) THEN
    RAISE EXCEPTION 'idv capture retention did not converge: candidate-scan index missing';
  END IF;

  -- The whole mechanism is subordinate to §18. If that table is not here, the
  -- worker would have no clock to consult and would retain everything for ever
  -- — safe, but silently useless, which is worth failing loudly about.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'aml' AND table_name = 'retention_triggers'
  ) THEN
    RAISE EXCEPTION 'idv capture retention did not converge: aml.retention_triggers is missing, so the §18 clock cannot be read';
  END IF;
END $$;
