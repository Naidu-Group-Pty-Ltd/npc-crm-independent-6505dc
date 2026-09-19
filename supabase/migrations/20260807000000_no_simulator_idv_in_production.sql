-- Identity verification runs live or not at all.
--
-- `20260802120000_seed_selfhosted_kyc_providers` seeded the selfhosted IDV row
-- as `active = true, mode = 'simulator'`, on the reasoning that going live
-- would then be a toggle rather than data entry. In production that produced
-- the worst of both: AML › Configuration › Providers showed an **active**
-- identity provider, while `decideProvider` refused to execute it on every
-- request — because production must never run the deterministic simulator.
-- The dashboard said configured; the customer was told electronic
-- verification was unavailable; and nothing reconciled the two.
--
-- An IDV provider whose only usable operating state is simulator is not a
-- configured provider, it is an unfinished one. So it is no longer left
-- active. Screening (`local_lists`) is untouched — its simulator has different
-- semantics and is not on the customer's identity path.
--
-- This changes no customer-visible behaviour: resolution already refused, and
-- clients already route to document verification by an adviser. What changes
-- is that the configuration screen now tells the truth, and going live becomes
-- one deliberate edit (mode = 'live', active = true) once the verification
-- service is reachable.
--
-- Additive and idempotent. Applying it twice is a no-op.
--
-- ROLLBACK:
--   UPDATE aml.provider_configs SET active = true
--   WHERE capability = 'idv' AND mode = 'simulator' AND provider_key <> 'simulator';

UPDATE aml.provider_configs
SET active = false,
    last_health_status = 'unconfigured',
    last_health_message = 'Simulator mode is not a usable state for identity '
      || 'verification. Set mode to live once the verification service is reachable.',
    updated_at = now()
WHERE capability = 'idv'
  AND mode = 'simulator'
  AND active = true;

-- Keep it true going forward: nothing may activate an IDV provider that is
-- still in simulator mode. Screening is deliberately out of scope.
CREATE OR REPLACE FUNCTION aml.tg_reject_active_simulator_idv()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.capability = 'idv' AND NEW.active AND NEW.mode = 'simulator' THEN
    RAISE EXCEPTION
      'An identity-verification provider cannot be active in simulator mode. '
      'Set mode to live once the verification service is reachable, or leave the row inactive.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_reject_active_simulator_idv ON aml.provider_configs;
CREATE TRIGGER trg_aml_reject_active_simulator_idv
  BEFORE INSERT OR UPDATE ON aml.provider_configs
  FOR EACH ROW EXECUTE FUNCTION aml.tg_reject_active_simulator_idv();
