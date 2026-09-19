-- Hosted-session identity verification (Didit) on the EXISTING canonical model.
--
-- Nothing here creates a second source of truth. `aml.verification_checks`
-- stays the canonical electronic KYC record; a Didit verification is an
-- ordinary `check_type = 'electronic_idv'` row whose `provider` is 'didit' and
-- whose `provider_reference` is the Didit session id. The columns the canonical
-- model already added (20260831000000) carry everything else:
--
--   provider                    'didit'
--   provider_reference          Didit session_id
--   provider_attempt_reference  Didit session_id (the attempt IS the session)
--   idempotency_key             collapses double-clicks onto one session
--   processing_status           session lifecycle, separate from `status`
--   attempt_consumed            still only ever true for a real outcome
--   outcome_detail              allow-listed evidence summary, no images
--   execution_mode/environment  live vs sandbox provenance
--
-- Additive and idempotent. It adds no column that duplicates an existing one,
-- rewrites no historical row, and leaves every selfhosted row untouched.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS aml.uq_aml_verification_active_hosted_session;
--   DROP INDEX IF EXISTS aml.idx_aml_verification_provider_reference;
--   DROP INDEX IF EXISTS aml.idx_aml_provider_events_verification_check;
--   ALTER TABLE aml.provider_events DROP COLUMN IF EXISTS verification_check_id;
--   -- restore the unconditional emit:
--   CREATE OR REPLACE FUNCTION aml.tg_emit_verification_requested() ... (see 20260831000100)

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Keep hosted-session checks OUT of the self-hosted image worker.
--
-- `aml.verification.requested` exists for one consumer:
-- cross-portal-outbox-worker/verificationConsumer.ts. That consumer downloads
-- `document_reference` from `aml-documents` and posts base64 images to the
-- self-hosted service. A Didit check has no such object — the customer
-- captured their document on Didit's UI and NPC never received it — so the
-- worker would throw `storage_unreadable:document` and stamp a technical
-- failure onto a check whose real outcome is already on its way by webhook.
--
-- The condition is written as the consumer's actual precondition rather than
-- as a provider name, so any future hosted provider is covered without
-- revisiting this function: no NPC-owned document, no self-hosted processing.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION aml.tg_emit_verification_requested()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = aml, public
AS $$
BEGIN
  IF NEW.check_type = 'electronic_idv'
     AND NEW.processing_status IN ('submitted', 'queued')
     -- Self-hosted capture path only. The consumer reads this object; without
     -- it there is nothing for it to process and its only possible outcome is
     -- a technical failure against a customer who did nothing wrong.
     AND NEW.document_reference IS NOT NULL THEN
    INSERT INTO public.integration_outbox
      (aggregate_type, aggregate_id, event_type, event_version, payload, idempotency_key)
    VALUES (
      'aml_verification_check', NEW.id, 'aml.verification.requested', 1,
      jsonb_build_object(
        'verification_check_id', NEW.id,
        'case_id', NEW.case_id,
        'capture_sequence', NEW.capture_sequence
      ),
      'aml-verify-' || NEW.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Webhook → canonical row correlation.
--
-- The webhook receiver is given a Didit session id and must find the one check
-- it belongs to. Without an index that is a sequential scan on every delivery.
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_aml_verification_provider_reference
  ON aml.verification_checks (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. At most ONE active hosted session per party — enforced by the database.
--
-- Application code already refuses a second submission while one is in flight,
-- but "check then insert" is not atomic: a double-click, a browser retry and a
-- second tab all race that gap, and each lost race is a REAL provider session
-- that NPC pays for and the customer never sees. A partial unique index closes
-- it: the loser gets 23505 and is answered with the session that already
-- exists.
--
-- Deliberately scoped to in-flight rows. A completed, cancelled or superseded
-- session leaves the slot free, so the customer's next legitimate attempt is
-- never blocked by history. An abandoned session is released explicitly by
-- aml-client-portal (processing_status → 'cancelled', superseded_at set) after
-- it reconciles the session's real state with Didit, so a customer who closed
-- the tab is never locked out waiting for a webhook that may not come.
-- ─────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_verification_active_hosted_session
  ON aml.verification_checks (case_id, COALESCE(party_id, case_id))
  WHERE check_type = 'electronic_idv'
    AND document_reference IS NULL
    AND processing_status IN ('submitted', 'queued', 'processing')
    AND superseded_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Webhook de-duplication against the canonical row.
--
-- `aml.provider_events` already gives replay protection through
-- UNIQUE (provider, dedup_key) — the Didit `event_id`, which their retries
-- reuse by design. It could only point at the LEGACY aml.identity_checks
-- table, so a Didit event had nowhere to record which canonical check it
-- settled. This is the missing link, and it is what lets a duplicate delivery
-- be recognised as already applied rather than merely already received.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE aml.provider_events
  ADD COLUMN IF NOT EXISTS verification_check_id uuid
    REFERENCES aml.verification_checks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aml_provider_events_verification_check
  ON aml.provider_events (verification_check_id)
  WHERE verification_check_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. The provider row, INACTIVE.
--
-- Provider selection is server-side configuration and stays that way: the
-- browser can never send `provider = didit`. This seeds the row so switching
-- NPC onto Didit is a reviewed one-field change by an operator —
--
--   UPDATE aml.provider_configs SET active = true
--    WHERE tenant_id = 'default' AND capability = 'idv' AND provider_key = 'didit';
--
-- — rather than an INSERT with columns to get right under pressure. It is
-- inserted inactive on purpose: this migration must not switch a live tenant's
-- identity verification onto a new provider as a side effect of deploying.
--
-- `config.workflow_id` is intentionally left empty. It is not a secret, but it
-- differs between the sandbox and live Didit applications, and a wrong value
-- would have NPC accepting decisions from a workflow whose modules it never
-- chose. The operator sets it alongside DIDIT_API_KEY / DIDIT_WEBHOOK_SECRET.
-- No credential is ever stored here — `secret_ref` names the secret, and the
-- value lives only in the function environment.
-- ─────────────────────────────────────────────────────────────────────────
-- `mode` is stated explicitly and must stay that way. The column defaults to
-- 'simulator', and production carries a trigger — aml.tg_reject_simulator_idv(),
-- BEFORE INSERT OR UPDATE — that raises check_violation on any `idv` row in
-- simulator mode. Omitting `mode` therefore made this migration impossible to
-- apply to production: it failed with
--   23514: Identity-verification providers are live-only.
-- Found by applying it to dduzbchuswwbefdunfct on 2026-08-08, not by review;
-- the local rehearsal database has no such trigger, so it passed there.
--
-- 'live' is also the only correct value: there is no Didit simulator, and
-- decideProvider() refuses a live-only provider left in simulator mode. The
-- row is still seeded INACTIVE — mode says HOW it would run, not WHETHER.
INSERT INTO aml.provider_configs
  (tenant_id, capability, provider_key, display_label, priority,
   cost_per_unit_cents, currency, active, mode, secret_ref, config)
SELECT 'default', 'idv', 'didit', 'Didit (hosted identity verification)', 10,
       0, 'AUD', false, 'live', 'DIDIT_API_KEY',
       jsonb_build_object(
         'flow', 'hosted_session',
         'workflow_id', '',
         'required_features', jsonb_build_array('ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH'),
         'note', 'Identity verification only. Didit AML/PEP/sanctions screening is NOT enabled '
                 'and must not be: NPC screens against its own DFAT/UN/OFAC lists.'
       )
WHERE EXISTS (SELECT 1 FROM aml.tenant_settings WHERE tenant_id = 'default')
ON CONFLICT (tenant_id, capability, provider_key) DO NOTHING;

COMMENT ON INDEX aml.uq_aml_verification_active_hosted_session IS
  'At most one in-flight hosted-session IDV check per party. Prevents a '
  'double-click or browser retry from creating a second chargeable provider '
  'session. Released when the session completes, is cancelled, or is superseded.';

-- Convergence checks: this migration is meaningless if the trigger did not
-- take, and a silent no-op here would mean Didit checks quietly entering the
-- self-hosted worker in production.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'aml' AND p.proname = 'tg_emit_verification_requested'
       AND pg_get_functiondef(p.oid) LIKE '%document_reference IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'didit hosted IDV did not converge: the verification outbox trigger still emits for hosted-session checks';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'aml' AND indexname = 'uq_aml_verification_active_hosted_session'
  ) THEN
    RAISE EXCEPTION 'didit hosted IDV did not converge: active-session uniqueness index missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'aml' AND table_name = 'provider_events'
       AND column_name = 'verification_check_id'
  ) THEN
    RAISE EXCEPTION 'didit hosted IDV did not converge: provider_events.verification_check_id missing';
  END IF;
END $$;
