-- A workspace that cannot afford a verification is not a provider fault.
--
-- Identity verification is charged to a workspace in TOKENS —
-- `_shared/aml/verificationTokenPrice.pure.ts` is the one place the price is
-- stated — and the reservation is taken after the check is claimed and before
-- the first paid call. When Mission Control explicitly refuses it, the run
-- stops having called nothing, consumed no attempt and written no customer
-- outcome, and records the condition on the row.
--
-- It needs a category of its own. `provider_error_category` already carries
-- `insufficient_credits`, and that one means DIDIT's balance is empty (a 403
-- carrying "credit"): it sends an operator to top up the vendor account. This
-- one means the WORKSPACE's token balance is empty and sends them to Mission
-- Control. Spelling them the same way would send every operator to the wrong
-- remedy — the exact defect this column's vocabulary was widened for once
-- already (20260911000000, where a configured-but-simulated provider read as
-- no provider at all).
--
-- `processing_status` is untouched: this is a `technical_failure` like every
-- other condition of the infrastructure rather than of the customer, so
-- `retry_verification_processing` re-runs it once the balance is topped up.
--
-- Additive and idempotent. No row is rewritten; the constraint only widens.
--
-- ROLLBACK:
--   ALTER TABLE aml.verification_checks
--     DROP CONSTRAINT IF EXISTS verification_checks_provider_error_category_check;
--   ALTER TABLE aml.verification_checks
--     ADD CONSTRAINT verification_checks_provider_error_category_check
--     CHECK (provider_error_category IS NULL OR provider_error_category IN
--       ('provider_not_configured','provider_misconfigured','provider_unavailable',
--        'timeout','storage_unreadable','capture_unusable','worker_failure',
--        'insufficient_credits','rate_limited','provider_rejected_request'));

ALTER TABLE aml.verification_checks
  DROP CONSTRAINT IF EXISTS verification_checks_provider_error_category_check;
ALTER TABLE aml.verification_checks
  ADD CONSTRAINT verification_checks_provider_error_category_check
  CHECK (provider_error_category IS NULL OR provider_error_category IN
    ('provider_not_configured','provider_misconfigured','provider_unavailable',
     'timeout','storage_unreadable','capture_unusable','worker_failure',
     'insufficient_credits','rate_limited','provider_rejected_request',
     'workspace_out_of_tokens'));

-- Asserted by its effect, never by the statement above having run: a clone
-- whose constraint predates this would accept the write at the application and
-- be refused by the column, which looks from the function exactly like a write
-- nobody attempted.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'aml.verification_checks'::regclass
       AND conname = 'verification_checks_provider_error_category_check'
       AND pg_get_constraintdef(oid) LIKE '%workspace_out_of_tokens%'
  ) THEN
    RAISE EXCEPTION 'verification token pricing did not converge: provider_error_category cannot record workspace_out_of_tokens';
  END IF;
END $$;
