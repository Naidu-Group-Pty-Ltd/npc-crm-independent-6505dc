-- Separate the verification CAPTURE ROW from the customer's ATTEMPT ALLOWANCE.
--
-- Found by the production-shaped database rehearsal, not by reading code.
--
-- `aml.verification_checks.attempt_number` was doing two incompatible jobs:
--
--   1. row identity — `uq_aml_verification_attempt` is unique on
--      (case_id, coalesce(party_id, case_id), check_type, attempt_number);
--   2. the allowance ceiling — CHECK (attempt_number BETWEEN 1 AND 3).
--
-- That was coherent while every capture implied a consumed attempt. The
-- canonical model (20260831000000) deliberately broke that equivalence: a
-- provider outage, an unusable capture, a worker retry and a simulation all
-- create a capture row and consume NOTHING, with `aml.verification_attempts_used()`
-- as the single allowance counter. With both jobs on one column:
--
--   * deriving attempt_number from the consumed count made the next capture
--     reuse the previous number, so the unique index raised 23505 and the
--     portal answered "your verification is already being checked" — a client
--     whose first capture was unreadable could never recapture at all;
--   * deriving it from the row count instead hits the 1..3 CHECK after three
--     capture rows, even when none of them consumed an attempt — so a client
--     unlucky enough to meet two provider outages would be locked out with
--     their full allowance untouched.
--
-- Both failure modes are reachable in normal operation. This migration moves
-- row identity onto `capture_sequence` (the column 20260831000000 added for
-- exactly this) and leaves the allowance where the canonical model puts it:
-- `attempt_consumed`, counted by `aml.verification_attempts_used()`, gated by
-- the portal and by aml-verification. `attempt_number` keeps its meaning for
-- display and for legacy rows, and stays >= 1.
--
-- Additive and idempotent. It does not delete or rewrite any row, and it does
-- not weaken the allowance: the ceiling moves from a column CHECK that counted
-- the wrong thing to the function that counts the right thing.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS aml.uq_aml_verification_capture;
--   CREATE UNIQUE INDEX uq_aml_verification_attempt
--     ON aml.verification_checks (case_id, COALESCE(party_id, case_id), check_type, attempt_number);
--   ALTER TABLE aml.verification_checks
--     DROP CONSTRAINT IF EXISTS verification_checks_attempt_number_check;
--   ALTER TABLE aml.verification_checks
--     ADD CONSTRAINT verification_checks_attempt_number_check
--     CHECK (attempt_number >= 1 AND attempt_number <= 3);
--   -- (only safe once no party holds more than three capture rows)

-- 1. Every existing row gets a capture_sequence. Rows created before
--    20260831000000 default it to 1, so fall back to attempt_number, and
--    de-duplicate within each party group by requested_at order.
WITH ordered AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY case_id, COALESCE(party_id, case_id), check_type
           ORDER BY requested_at, attempt_number, id
         ) AS seq
    FROM aml.verification_checks
)
UPDATE aml.verification_checks v
   SET capture_sequence = ordered.seq
  FROM ordered
 WHERE v.id = ordered.id
   AND (v.capture_sequence IS NULL OR v.capture_sequence <> ordered.seq);

-- 2. Row identity moves to capture_sequence.
DROP INDEX IF EXISTS aml.uq_aml_verification_attempt;
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_verification_capture
  ON aml.verification_checks (case_id, COALESCE(party_id, case_id), check_type, capture_sequence);

-- 3. attempt_number is no longer the ceiling — only a positive ordinal.
ALTER TABLE aml.verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_attempt_number_check;
ALTER TABLE aml.verification_checks
  ADD CONSTRAINT verification_checks_attempt_number_check
  CHECK (attempt_number >= 1);

-- 4. capture_sequence must be a positive ordinal too.
ALTER TABLE aml.verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_capture_sequence_check;
ALTER TABLE aml.verification_checks
  ADD CONSTRAINT verification_checks_capture_sequence_check
  CHECK (capture_sequence >= 1);

COMMENT ON COLUMN aml.verification_checks.attempt_number IS
  'Display ordinal for this capture. NOT the allowance: the customer''s '
  'remaining attempts come from aml.verification_attempts_used(), which counts '
  'only attempt_consumed rows. See 20260901000200.';
COMMENT ON COLUMN aml.verification_checks.capture_sequence IS
  'Per-party capture row number. Row identity (uq_aml_verification_capture). '
  'Increments for every capture, including those that consume no attempt.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'aml' AND indexname = 'uq_aml_verification_attempt'
  ) THEN
    RAISE EXCEPTION 'capture-row identity did not converge: the attempt_number unique index still exists';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'aml' AND indexname = 'uq_aml_verification_capture'
  ) THEN
    RAISE EXCEPTION 'capture-row identity did not converge: uq_aml_verification_capture missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'aml.verification_checks'::regclass
       AND conname = 'verification_checks_attempt_number_check'
       AND pg_get_constraintdef(oid) LIKE '%<= 3%'
  ) THEN
    RAISE EXCEPTION 'capture-row identity did not converge: attempt_number is still capped at 3';
  END IF;
END $$;
