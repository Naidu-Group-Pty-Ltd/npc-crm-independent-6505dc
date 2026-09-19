-- Retire the hosted identity-capture experience.
--
-- Production was still resolving `provider_key = 'didit'`, flow
-- `hosted_session`, so the portal answered `provider_flow: 'hosted'`, rendered
-- "Continue verification", and opened `verify.didit.me/session/…` in a separate
-- window. Two customers reached that state; one of them today.
--
-- The product decision is now final: no customer is sent to a verification
-- vendor's page again. The browser can no longer open a window and the portal
-- function can no longer answer `hosted` — this is the third lock, in the data.
--
-- ## What it does NOT do
--
-- It does not delete a single row, mark anybody failed, consume an attempt, or
-- touch a completed hosted result. Historical Didit evidence is compliance
-- evidence and stays exactly where it is. A late signed webhook for a session
-- that already ran is still accepted and still settles the canonical record —
-- this closes the door on the hosted UI, not on hosted outcomes.
--
-- ROLLBACK:
--   -- Restore the two provider rows to their pre-cutover state:
--   UPDATE aml.provider_configs SET active = true
--    WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
--   UPDATE aml.provider_configs SET active = false
--    WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';
--   -- Un-retire the attempts this migration superseded (identified by reason):
--   UPDATE aml.verification_checks
--      SET superseded_at = NULL, superseded_reason = NULL, processing_status = 'processing'
--    WHERE superseded_reason = 'hosted capture retired: standalone cutover 20260911000300';
--   -- NOTE: rolling back does NOT restore the hosted UI. That is deleted in
--   -- the frontend bundle and in aml-client-portal; a rollback here only
--   -- restores provider resolution, which would then read as
--   -- manual_verification_required.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Retire stale hosted attempts that never produced an outcome.
--
-- Strictly bounded, and every clause is a thing that must NOT be touched:
--
--   attempt_consumed = false   → the customer's allowance is untouched, and a
--                                row that already spent one is a real outcome
--   status = 'pending'         → never a passed, failed, referred or exhausted
--                                result. Those are canonical evidence
--   processing_status IN (…)   → only rows still waiting on a session that can
--                                no longer be opened
--   superseded_at IS NULL      → idempotent; a second apply changes nothing
--
-- `status` is deliberately NOT written. Retiring a session the customer can no
-- longer reach is housekeeping, not a finding against them — the same rule
-- `releaseHostedCheck` has always followed, and the same vocabulary
-- (`processing_status = 'cancelled'`, `superseded_at`, `superseded_reason`).
--
-- The effect for the customer is that `projectParty` stops counting the row as
-- in-flight, so the portal offers Start (or Try again) on the NPC capture
-- journey with their full allowance intact.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE aml.verification_checks
   SET processing_status  = 'cancelled',
       superseded_at      = now(),
       superseded_reason  = 'hosted capture retired: standalone cutover 20260911000300',
       updated_at         = now()
 WHERE check_type = 'electronic_idv'
   AND provider = 'didit'
   AND superseded_at IS NULL
   AND attempt_consumed = false
   AND status = 'pending'
   AND processing_status IN ('submitted', 'queued', 'processing', 'retry_scheduled');

-- ─────────────────────────────────────────────────────────────────────────
-- 2. The provider switch.
--
-- Exactly one IDV provider serves new attempts. `resolveTenantProvider` takes
-- the single highest-priority ACTIVE row, so leaving both on would resolve
-- deterministically rather than alternate — but "deterministic" is not the bar
-- here. The bar is that the retired one cannot be resolved at all.
--
-- Order matters within the transaction: the hosted row is deactivated FIRST,
-- so there is no instant at which two rows are active and a concurrent portal
-- read could resolve the wrong one. Migrations run in a transaction, so a
-- reader sees neither change or both.
--
-- `didit_standalone` may legitimately be missing here — 20260911000000 seeds it
-- only where `aml.tenant_settings` has a `default` tenant. The activation is
-- therefore written so that it activates a row that exists and does nothing at
-- all if one does not, rather than failing the deploy.
--
-- ## If the Standalone thresholds are not configured
--
-- Activating it does NOT then produce a broken customer experience, and it
-- certainly does not fall back to hosted. `getStandaloneIdvProvider` throws
-- unless DIDIT_API_KEY and both decline thresholds are present and in range,
-- `clientSafeIdvState` turns that into `temporarily_unavailable`, and the
-- portal renders the documentary route. That is the intended end state until
-- compliance supplies the numbers: no biometric collected, no popup, and a
-- real way for the customer to finish.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE aml.provider_configs
   SET active = false, updated_at = now()
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';

UPDATE aml.provider_configs
   SET active = true, updated_at = now()
 WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';

-- ─────────────────────────────────────────────────────────────────────────
-- Convergence. Each of these is a way the cutover could silently not happen,
-- and every one of them would leave a customer able to reach the hosted UI.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_active_idv integer;
  v_hosted_active boolean;
  v_standalone_active boolean;
  v_stale_hosted integer;
BEGIN
  SELECT count(*) INTO v_active_idv
    FROM aml.provider_configs
   WHERE tenant_id = 'default' AND capability = 'idv' AND active;

  SELECT coalesce(bool_or(active), false) INTO v_hosted_active
    FROM aml.provider_configs
   WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';

  SELECT coalesce(bool_or(active), false) INTO v_standalone_active
    FROM aml.provider_configs
   WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit_standalone';

  SELECT count(*) INTO v_stale_hosted
    FROM aml.verification_checks
   WHERE check_type = 'electronic_idv'
     AND provider = 'didit'
     AND superseded_at IS NULL
     AND attempt_consumed = false
     AND status = 'pending'
     AND processing_status IN ('submitted', 'queued', 'processing', 'retry_scheduled');

  IF v_hosted_active THEN
    RAISE EXCEPTION 'hosted IDV cutover did not converge: provider_key=didit is still active, so the portal would still resolve a hosted session';
  END IF;

  IF v_stale_hosted > 0 THEN
    RAISE EXCEPTION 'hosted IDV cutover did not converge: % unconsumed hosted attempts are still in flight', v_stale_hosted;
  END IF;

  -- More than one active IDV provider is a configuration nobody intended.
  IF v_active_idv > 1 THEN
    RAISE EXCEPTION 'hosted IDV cutover did not converge: % IDV providers are active for tenant default', v_active_idv;
  END IF;

  -- Zero active is SAFE (the portal renders the documentary route) but it is
  -- not what this migration set out to do, so it is worth saying out loud in
  -- the deploy log rather than discovering later.
  IF NOT v_standalone_active THEN
    RAISE WARNING 'hosted IDV retired, but didit_standalone is not active for tenant default — electronic verification will read as unavailable and customers will be offered the documentary route. Seed 20260911000000 first, then re-run this migration.';
  END IF;
END $$;
