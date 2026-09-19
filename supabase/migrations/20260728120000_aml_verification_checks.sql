-- Identity verification records + biometric consent (owner decisions 2026-07-28).
--
-- Encodes four decisions:
--   1. Self-hosted, open-source biometric provider  → provider is a free text
--      label, not an enum, so the stack can be swapped without a migration.
--   2. Biometrics ARE retained                      → biometric_* columns, a
--      dedicated private bucket, and a mandatory separate consent (APP 3.3).
--   3. No re-verification interval                  → deliberately NO expires_at
--      and no scheduled re-check. Manual re-verify only.
--   4. Two retries, three attempts total            → attempt_number 1..3 with a
--      CHECK, and an 'exhausted' terminal status.
--
-- Rows are per PARTY, not per case: a trust purchase can require four separate
-- verifications and a case-level flag cannot express "two of four passed".
--
-- Additive only. No existing rows are modified.
--
-- ROLLBACK:
--   DELETE FROM aml.consent_documents WHERE version = '2026.2';
--   DROP TABLE IF EXISTS aml.verification_checks;

CREATE TABLE IF NOT EXISTS aml.verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  -- The person being verified. Null means the primary customer; otherwise a
  -- beneficial owner / controller captured in the Phase 6 party model.
  party_id uuid,
  party_label text NOT NULL,

  check_type text NOT NULL
    CHECK (check_type IN ('electronic_idv', 'document_sighting', 'dvs', 'screening')),

  -- Decision 4: attempt 1 plus two retries. The CHECK is the enforcement point;
  -- application code must not be the only thing holding this.
  attempt_number integer NOT NULL DEFAULT 1
    CHECK (attempt_number BETWEEN 1 AND 3),

  -- 'referred' matters as much as pass/fail: most real IDV outcomes needing
  -- human attention are neither a clean pass nor a clean fail.
  -- 'exhausted' is the terminal state after the third failed attempt.
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'passed', 'failed',
                      'referred', 'exhausted', 'abandoned')),

  provider text,
  provider_reference text,
  -- Sources matched, confidence, liveness score, reasons. Never surfaced to
  -- the client portal or the finance portal.
  outcome_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,

  -- Decision 2: biometrics are retained. Stored in a dedicated private bucket
  -- (aml-biometrics), separate from aml-documents so its access policy can be
  -- tighter. Sensitive information under Privacy Act 1988 s 6.
  biometric_kind text CHECK (biometric_kind IN ('face_image', 'face_template')),
  biometric_storage_path text,
  biometric_captured_at timestamptz,
  -- The consent that authorised retaining it. Retention without this is a
  -- collection of sensitive information without consent (APP 3.3).
  biometric_consent_id uuid REFERENCES aml.consents(id),

  -- Manual/assisted verification (the mandatory fallback path).
  verified_by uuid,
  verified_by_type text CHECK (verified_by_type IN ('staff', 'provider')),

  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Decision 3: NO expires_at. Verification does not lapse on a clock.
  -- Trigger-based re-verification (material change, monitoring trigger) is
  -- handled by the Phase 10 review machinery, not by an interval here.

  -- A biometric may only be recorded together with the consent that authorised
  -- it, and with the kind and capture time that make it auditable.
  CONSTRAINT biometric_requires_consent CHECK (
    biometric_storage_path IS NULL
    OR (biometric_consent_id IS NOT NULL
        AND biometric_kind IS NOT NULL
        AND biometric_captured_at IS NOT NULL)
  )
);

GRANT ALL ON aml.verification_checks TO service_role;
ALTER TABLE aml.verification_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "aml_verification_checks_service_only" ON aml.verification_checks
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_aml_verification_checks_case
  ON aml.verification_checks(case_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_verification_checks_party
  ON aml.verification_checks(case_id, party_id, attempt_number DESC);
-- Outstanding work queue: anything not in a settled state.
CREATE INDEX IF NOT EXISTS idx_aml_verification_checks_open
  ON aml.verification_checks(status, requested_at)
  WHERE status IN ('pending', 'in_progress', 'referred');

-- One row per attempt per party per check type — makes the three-attempt
-- ceiling enforceable rather than advisory.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aml_verification_attempt
  ON aml.verification_checks(case_id, COALESCE(party_id, case_id), check_type, attempt_number);

-- ─────────────────────────────────────────────────────────────────────────
-- Consent catalogue v2026.2 — adds biometric collection consent.
--
-- Required by decision 2. Biometric information is sensitive information
-- (Privacy Act 1988 s 6) and APP 3.3 requires consent specific to collecting
-- it. The existing identity_verification consent covers electronic
-- verification in general; it does not authorise retaining a face image.
--
-- The four AUSTRAC documents are re-published unchanged at 2026.2 because the
-- gate treats acceptance as version-specific: a catalogue version must be
-- internally complete, or clients would be asked for the new consent while the
-- others silently read as outstanding.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO aml.consent_documents
  (code, version, acknowledgement_type, title, summary, body, statutory_basis, reference_links, required, sort_order)
SELECT code, '2026.2', acknowledgement_type, title, summary, body,
       statutory_basis, reference_links, required, sort_order
FROM aml.consent_documents
WHERE version = '2026.1'
ON CONFLICT (code, version) DO NOTHING;

INSERT INTO aml.consent_documents
  (code, version, acknowledgement_type, title, summary, body, statutory_basis, reference_links, required, sort_order)
VALUES
(
  'biometric_collection', '2026.2', 'consent',
  'Facial image and biometric verification',
  'Consent to capture, check and retain a facial image so we can confirm you are the holder of your identity document.',
  'To confirm that you are the person shown on your identity document, we ask you to take a photograph of your face. '
  || 'We compare that photograph with the photograph on your document, and we run an automated check intended to '
  || 'confirm a real person is present rather than a photograph, screen or mask.'
  || E'\n\n'
  || 'A facial image, and the mathematical template derived from it, are biometric information. Australian privacy law '
  || 'treats this as sensitive information, which means we may only collect it with your consent. This consent is '
  || 'separate from the other consents for that reason.'
  || E'\n\n'
  || 'We retain your facial image and the derived template as part of your compliance record. They are processed and '
  || 'stored on infrastructure we control — they are not sent to an overseas identity verification service. Access is '
  || 'restricted to compliance staff who need it, and every access is recorded in a tamper-evident log. They are kept '
  || 'for the record-keeping period required by anti-money laundering law, measured from the end of our business '
  || 'relationship with you, and are then destroyed.'
  || E'\n\n'
  || 'You may have up to three attempts at the facial check. If the check does not succeed, that is not a finding '
  || 'against you — checks of this kind fail for ordinary reasons such as lighting or camera quality. A member of our '
  || 'staff will contact you to complete verification another way.'
  || E'\n\n'
  || 'You do not have to consent to this. If you would prefer, you may ask us to verify your identity from original or '
  || 'certified copies of your identity documents instead, and we will arrange that.',
  ARRAY[
    'Privacy Act 1988 (Cth), section 6 — biometric information is sensitive information',
    'Privacy Act 1988 (Cth), Australian Privacy Principle 3.3 — consent is required to collect sensitive information',
    'Privacy Act 1988 (Cth), Australian Privacy Principle 11 — security and destruction of personal information',
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — customer identification and verification',
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth) — record-keeping obligations (seven years)'
  ],
  '[
     {"label": "OAIC — what is sensitive information", "url": "https://www.oaic.gov.au/privacy/your-privacy-rights/your-personal-information/what-is-personal-information"},
     {"label": "AUSTRAC — customer identification and verification", "url": "https://www.austrac.gov.au/business/core-guidance/customer-identification-and-verification"}
   ]'::jsonb,
  false, 25
)
ON CONFLICT (code, version) DO NOTHING;
