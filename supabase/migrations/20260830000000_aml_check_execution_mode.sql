-- Classify verification/screening executions by mode and evidential standing.
--
-- Production ran the deterministic IDV simulator (no provider_configs row +
-- no AML_PROVIDER_MODE meant the factory defaulted to it) and recorded
-- synthetic 'failed' identity checks against a real customer. Those rows are
-- not compliance evidence: they must never feed risk derivation, attempt
-- allowances, service-gate reasoning or client-visible failure state — but
-- they are also history, and history is preserved, never deleted.
--
-- Additive only. Defaults describe rows the live path writes; the functions
-- stamp execution_mode/authoritative explicitly per provider mode and retry
-- without these columns while a database has not applied this migration.
--
-- ROLLBACK:
--   ALTER TABLE aml.identity_checks  DROP COLUMN IF EXISTS execution_mode,
--     DROP COLUMN IF EXISTS authoritative, DROP COLUMN IF EXISTS environment,
--     DROP COLUMN IF EXISTS superseded_at, DROP COLUMN IF EXISTS superseded_reason;
--   ALTER TABLE aml.screening_checks DROP COLUMN IF EXISTS execution_mode,
--     DROP COLUMN IF EXISTS authoritative, DROP COLUMN IF EXISTS environment,
--     DROP COLUMN IF EXISTS superseded_at, DROP COLUMN IF EXISTS superseded_reason;

ALTER TABLE aml.identity_checks
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'live'
    CHECK (execution_mode IN ('live', 'simulation')),
  ADD COLUMN IF NOT EXISTS authoritative boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

ALTER TABLE aml.screening_checks
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'live'
    CHECK (execution_mode IN ('live', 'simulation')),
  ADD COLUMN IF NOT EXISTS authoritative boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text;

-- Backfill ONLY rows whose provider is conclusively the simulator. The
-- original result payload and audit history stay untouched; the rows simply
-- stop being evidence. No row is deleted and no status is rewritten.
UPDATE aml.identity_checks
SET execution_mode = 'simulation',
    authoritative  = false,
    superseded_reason = COALESCE(superseded_reason,
      'simulator execution — not compliance evidence (production-readiness remediation)')
WHERE provider = 'simulator';

UPDATE aml.screening_checks
SET execution_mode = 'simulation',
    authoritative  = false,
    superseded_reason = COALESCE(superseded_reason,
      'simulator execution — not compliance evidence (production-readiness remediation)')
WHERE provider = 'simulator';

-- Verify convergence: no simulator row may remain authoritative.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM aml.identity_checks WHERE provider = 'simulator' AND authoritative)
     OR EXISTS (SELECT 1 FROM aml.screening_checks WHERE provider = 'simulator' AND authoritative) THEN
    RAISE EXCEPTION 'execution-mode classification did not converge — simulator rows remain authoritative';
  END IF;
END $$;
