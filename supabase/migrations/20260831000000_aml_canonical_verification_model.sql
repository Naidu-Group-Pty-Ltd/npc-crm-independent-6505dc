-- Canonical identity-verification model (integration Stage 2/3).
--
-- aml.verification_checks becomes the single production IDV record: portal
-- submissions, manual sightings and worker-processed provider results all
-- live here. aml.identity_checks stays read-only legacy history (PR #1937's
-- 20260830000000 already classifies its simulator rows non-authoritative).
--
-- Columns verified against production dduzbchuswwbefdunfct on 2026-08-05
-- before writing: nothing added below already exists there.
--
-- Attempt accounting (Stage 3): a customer attempt is consumed only when the
-- provider actually examined usable captures and returned an authoritative
-- identity outcome. attempt_consumed records that decision per row;
-- aml.verification_attempts_used() is the single server-side counter —
-- MAX(attempt_number) is no longer the truth.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS aml.verification_attempts_used(uuid, uuid);
--   DROP TABLE IF EXISTS aml.party_verification_links;
--   ALTER TABLE aml.verification_checks
--     DROP COLUMN IF EXISTS execution_mode, DROP COLUMN IF EXISTS authoritative,
--     DROP COLUMN IF EXISTS environment, DROP COLUMN IF EXISTS processing_status,
--     DROP COLUMN IF EXISTS attempt_consumed, DROP COLUMN IF EXISTS processing_attempts,
--     DROP COLUMN IF EXISTS capture_sequence, DROP COLUMN IF EXISTS provider_attempt_reference,
--     DROP COLUMN IF EXISTS provider_error_category, DROP COLUMN IF EXISTS superseded_at,
--     DROP COLUMN IF EXISTS superseded_reason, DROP COLUMN IF EXISTS processing_started_at,
--     DROP COLUMN IF EXISTS processing_completed_at, DROP COLUMN IF EXISTS next_retry_at,
--     DROP COLUMN IF EXISTS idempotency_key, DROP COLUMN IF EXISTS source_request_id,
--     DROP COLUMN IF EXISTS source_submission_id;

ALTER TABLE aml.verification_checks
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'live'
    CHECK (execution_mode IN ('live', 'simulation', 'manual')),
  ADD COLUMN IF NOT EXISTS authoritative boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS environment text,
  -- Worker pipeline state — separate from the identity outcome in `status`.
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'submitted'
    CHECK (processing_status IN
      ('submitted','queued','processing','completed','capture_unusable',
       'technical_failure','retry_scheduled','dead_lettered','cancelled')),
  -- The Stage 3 decision, recorded explicitly per row.
  ADD COLUMN IF NOT EXISTS attempt_consumed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS capture_sequence integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS provider_attempt_reference text,
  ADD COLUMN IF NOT EXISTS provider_error_category text
    CHECK (provider_error_category IS NULL OR provider_error_category IN
      ('provider_not_configured','provider_misconfigured','provider_unavailable',
       'timeout','storage_unreadable','capture_unusable','worker_failure')),
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz,
  ADD COLUMN IF NOT EXISTS superseded_reason text,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS source_request_id uuid,
  ADD COLUMN IF NOT EXISTS source_submission_id uuid;

-- One live processing pipeline per submission: duplicate outbox deliveries
-- collapse instead of double-calling the provider.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_verification_idempotency
  ON aml.verification_checks(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_aml_verification_processing
  ON aml.verification_checks(processing_status, next_retry_at)
  WHERE processing_status IN ('queued','retry_scheduled');

-- Historical electronic rows predate the pipeline: they were adjudicated
-- under the old model where an existing row implied a consumed attempt.
-- Preserve that meaning explicitly so the new counter does not resurrect
-- attempts that were genuinely used, and mark them completed.
UPDATE aml.verification_checks
SET attempt_consumed = true,
    processing_status = 'completed'
WHERE check_type = 'electronic_idv'
  AND status IN ('passed','failed','referred','exhausted');

-- Stage 3: the single server-side attempt counter. Counts electronic
-- attempts that actually consumed allowance; simulations, technical
-- failures, unusable captures and manual sightings never count.
CREATE OR REPLACE FUNCTION aml.verification_attempts_used(p_case_id uuid, p_party_id uuid)
RETURNS integer
LANGUAGE sql STABLE
SET search_path = aml, public
AS $$
  SELECT count(*)::integer
  FROM aml.verification_checks
  WHERE case_id = p_case_id
    AND (CASE WHEN p_party_id IS NULL THEN party_id IS NULL ELSE party_id = p_party_id END)
    AND check_type = 'electronic_idv'
    AND attempt_consumed
    AND execution_mode <> 'simulation'
    AND superseded_at IS NULL;
$$;
REVOKE ALL ON FUNCTION aml.verification_attempts_used(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION aml.verification_attempts_used(uuid, uuid) TO service_role;

-- Stage 14: typed evidence links from canonical parties to canonical
-- verification checks (Ownership & Control currently points at legacy
-- identity_checks). Service-role only, like the rest of the aml schema.
CREATE TABLE IF NOT EXISTS aml.party_verification_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  party_type text NOT NULL CHECK (party_type IN
    ('case_subject','beneficial_owner','authorised_representative','co_purchaser',
     'trustee','director','donor','private_lender','other')),
  party_id uuid,
  verification_check_id uuid NOT NULL REFERENCES aml.verification_checks(id),
  relationship text NOT NULL DEFAULT 'identity_evidence',
  authoritative boolean NOT NULL DEFAULT true,
  linked_by uuid,
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlink_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_aml_pvl_case ON aml.party_verification_links(case_id);
CREATE INDEX IF NOT EXISTS idx_aml_pvl_party ON aml.party_verification_links(party_type, party_id)
  WHERE unlinked_at IS NULL;
ALTER TABLE aml.party_verification_links ENABLE ROW LEVEL SECURITY;
