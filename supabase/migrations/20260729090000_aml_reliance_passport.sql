-- Compliance Passport — cross-portal reuse of a completed AML/CTF process
-- under the reliance provisions of the AML/CTF Act 2006 (Cth), Part 2
-- Division 7 (ss 37A–38): one reporting entity may rely on the applicable
-- customer identification procedure carried out by another under a written
-- CDD arrangement, subject to risk assessment and regular review, with the
-- relying entity remaining responsible for its own compliance.
--
-- Model:
--   reliance_agreements    the WRITTEN arrangement per partner organisation
--                          (s 37A is unavailable without one — that is why
--                          agreement_reference and next_review_due are NOT
--                          NULL, not merely encouraged)
--   compliance_attestations  a versioned, hash-addressed, SANITISED snapshot
--                          of the procedures performed on a case. What a
--                          partner relies on. Never raw case internals.
--   reliance_grants        per case + agreement: the client-consented handle
--                          a partner uses. Token stored as a hash only.
--   independent_assessments  a partner's OWN determination, recorded against
--                          the attestation hash — reuse of internally-held
--                          records instead of re-approaching the client.
--   reliance_access_log    every partner access, logged.
--
-- Boundary rule carried over from the tri-portal contracts: an attestation
-- states WHAT PROCEDURES WERE PERFORMED. It never carries risk ratings,
-- screening match content, reviewer notes or MLRO commentary — a partner
-- relying on our identification procedure has no entitlement to our
-- investigation, and tipping-off (s 123) forbids sharing some of it anyway.
--
-- Additive only.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS aml.reliance_access_log;
--   DROP TABLE IF EXISTS aml.independent_assessments;
--   DROP TABLE IF EXISTS aml.reliance_grants;
--   DROP TABLE IF EXISTS aml.compliance_attestations;
--   DROP TABLE IF EXISTS aml.reliance_agreements;
--   DELETE FROM aml.consent_documents WHERE code = 'compliance_sharing';

CREATE TABLE IF NOT EXISTS aml.reliance_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_name text NOT NULL,
  partner_org_type text NOT NULL CHECK (partner_org_type IN
    ('finance', 'builder', 'developer', 'solicitor_conveyancer', 'other')),
  partner_abn text,
  -- The written agreement is the statutory precondition, not paperwork.
  agreement_reference text NOT NULL,
  executed_on date NOT NULL,
  -- s 37A requires the arrangement be reviewed regularly. An overdue review
  -- suspends new grants (enforced in the edge function).
  next_review_due date NOT NULL,
  last_reviewed_at timestamptz,
  last_reviewed_by uuid,
  scope text[] NOT NULL DEFAULT ARRAY['customer_identification']::text[],
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'terminated')),
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aml.compliance_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  version integer NOT NULL,
  -- The sanitised statement of procedures performed. Its shape is owned by
  -- the edge function; the hash makes any given attestation immutable
  -- evidence even if this row were later tampered with.
  payload jsonb NOT NULL,
  payload_sha256 text NOT NULL,
  issued_by uuid NOT NULL,
  issued_by_email text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (case_id, version)
);

CREATE TABLE IF NOT EXISTS aml.reliance_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES aml.reliance_agreements(id),
  attestation_id uuid NOT NULL REFERENCES aml.compliance_attestations(id),
  -- The client consent that authorises this disclosure (APP 6). A grant
  -- without it cannot exist.
  consent_id uuid NOT NULL REFERENCES aml.consents(id),
  -- Raw token is returned exactly once at creation; only its hash is stored.
  access_token_hash text NOT NULL UNIQUE,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text
);

CREATE TABLE IF NOT EXISTS aml.independent_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES aml.reliance_grants(id),
  case_id uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES aml.reliance_agreements(id),
  assessor_name text NOT NULL,
  assessor_role text,
  -- Pinned to the exact attestation content assessed, so the partner's
  -- decision remains meaningful if a later attestation supersedes it.
  based_on_attestation_sha256 text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'satisfied', 'not_satisfied', 'records_requested')),
  decision_notes text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aml.reliance_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES aml.reliance_grants(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN
    ('redeem', 'view_attestation', 'independent_assessment', 'records_request')),
  actor_label text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON aml.reliance_agreements, aml.compliance_attestations,
  aml.reliance_grants, aml.independent_assessments, aml.reliance_access_log
  TO service_role;
ALTER TABLE aml.reliance_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.compliance_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.reliance_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.independent_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE aml.reliance_access_log ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['reliance_agreements','compliance_attestations',
      'reliance_grants','independent_assessments','reliance_access_log'] LOOP
    BEGIN
      EXECUTE format(
        'CREATE POLICY "aml_%s_service_only" ON aml.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t, t);
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_aml_attestations_case
  ON aml.compliance_attestations(case_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_aml_reliance_grants_case
  ON aml.reliance_grants(case_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_reliance_access_grant
  ON aml.reliance_access_log(grant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aml_independent_assessments_case
  ON aml.independent_assessments(case_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- Client consent for sharing — published INTO the current catalogue version
-- (2026.2) rather than as a new version, because it is OPTIONAL
-- (required = false): a new version would re-ask every client for every
-- consent to add a document most will never need. The consent gate only
-- blocks on required documents, so nothing already accepted changes.
-- Declining costs the client nothing with us — the partner organisation
-- simply approaches them directly instead.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO aml.consent_documents
  (code, version, acknowledgement_type, title, summary, body, statutory_basis, reference_links, required, sort_order)
VALUES (
  'compliance_sharing', '2026.2', 'consent',
  'Sharing your completed verification with partner organisations',
  'Let the other organisations working on your purchase reuse the identity checks you have already completed, so you are not asked to verify again.',
  'Several organisations are usually involved in a property purchase — a mortgage broker or lender, '
  || 'a builder or developer, and a solicitor or conveyancer. Many of them have their own legal '
  || 'obligation to verify your identity before they can act.'
  || E'\n\n'
  || 'Australian anti-money laundering law allows one organisation to rely on the customer '
  || 'identification another has already carried out, under a written agreement between them. With '
  || 'your consent, we share with those partner organisations a record of the checks we have '
  || 'completed — what was verified, how, and when — and, where their own compliance requires it '
  || 'and the written agreement provides for it, copies of the identification records. Each partner '
  || 'remains responsible for its own compliance decisions.'
  || E'\n\n'
  || 'We share this only with organisations that hold a current written agreement with us, every '
  || 'access is recorded, and we do not share our internal assessments or commentary about you.'
  || E'\n\n'
  || 'This consent is optional. If you decline, nothing changes with us — but each partner '
  || 'organisation will need to contact you and verify your identity separately.',
  ARRAY[
    'Anti-Money Laundering and Counter-Terrorism Financing Act 2006 (Cth), Part 2 Division 7 (ss 37A–38) — reliance on customer identification carried out by another reporting entity under a customer due diligence arrangement',
    'Privacy Act 1988 (Cth), Australian Privacy Principle 6.1(a) — disclosure with consent'
  ],
  '[
     {"label": "AUSTRAC — customer identification and verification", "url": "https://www.austrac.gov.au/business/core-guidance/customer-identification-and-verification"}
   ]'::jsonb,
  false, 60
)
ON CONFLICT (code, version) DO NOTHING;
