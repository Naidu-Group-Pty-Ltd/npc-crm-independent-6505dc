-- Self-hosted identity verification is a live-only production capability.
--
-- The historical seed created `selfhosted` as mode='simulator'. A later guard
-- stopped that row being active in production, but the persisted configuration
-- still looked like a simulator and kept sending operators and automation back
-- through a dead setup path. Normalise that legacy state now.
--
-- This migration does NOT activate the provider before the real verification
-- service is reachable. It leaves the row `mode='live', active=false`, so the
-- only remaining activation step is `active=true` after the production backend
-- has successfully reached the service health endpoint.
--
-- Screening providers are deliberately untouched.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_aml_reject_simulator_idv ON aml.provider_configs;
--   DROP FUNCTION IF EXISTS aml.tg_reject_simulator_idv();

UPDATE aml.provider_configs
SET mode = 'live',
    active = false,
    last_health_status = 'unconfigured',
    last_health_message = 'Live self-hosted verification service is not connected yet.',
    updated_at = now()
WHERE capability = 'idv'
  AND provider_key = 'selfhosted'
  AND mode = 'simulator';

-- Replace the earlier active-only guard. IDV simulator configuration is no
-- longer a valid persisted state at all, even when inactive. Test simulators
-- remain code fixtures; they are not tenant provider configuration.
DROP TRIGGER IF EXISTS trg_aml_reject_active_simulator_idv ON aml.provider_configs;
DROP FUNCTION IF EXISTS aml.tg_reject_active_simulator_idv();

CREATE OR REPLACE FUNCTION aml.tg_reject_simulator_idv()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.capability = 'idv' AND NEW.mode = 'simulator' THEN
    RAISE EXCEPTION
      'Identity-verification providers are live-only. Configure the selfhosted provider as live.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_aml_reject_simulator_idv ON aml.provider_configs;
CREATE TRIGGER trg_aml_reject_simulator_idv
  BEFORE INSERT OR UPDATE ON aml.provider_configs
  FOR EACH ROW EXECUTE FUNCTION aml.tg_reject_simulator_idv();
