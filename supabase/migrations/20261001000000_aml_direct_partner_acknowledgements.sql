-- AML/CTF Compliance Passport — the DIRECT partner acknowledgement.
--
-- A partner outside the three portals ("Other") has no sign-up to carry the
-- prebuilt Portal Access, Confidentiality, Privacy and AML/CTF Compliance
-- Passport Agreement, whose mandatory `binding_amlctf_arrangement`
-- acknowledgement is the s 37A / rule 6-29 arrangement statement. Until now
-- an operator typed an arrangement reference on their behalf, which records
-- an instrument nobody signed.
--
-- This table records the partner acknowledging it themselves, through a
-- one-time emailed link — same agreement text, same mandatory
-- acknowledgements, different delivery channel.
--
-- ── Why this is NOT `public.portal_terms_acceptances` ────────────────────
-- That table carries three hard constraints that a non-portal party cannot
-- satisfy: `portal` must be solicitor|builder|finance; exactly one of the
-- three portal-user FKs must be non-null; and the portal must match its FK.
-- Relaxing them would touch every executed portal agreement, the
-- `partner_agreement_records` view and the portal PDF generator. So this is a
-- parallel record with its own lifecycle, and the portal store is untouched.
--
-- ── The gate is the arrangement row, not a new rule ──────────────────────
-- `grant_access` already refuses without an active arrangement whose review
-- is current. `agreement_id` here is written ONLY on acceptance, so no
-- acceptance means no arrangement means no passport. Nothing new enforces it.

CREATE TABLE IF NOT EXISTS aml.direct_partner_acknowledgements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL DEFAULT 'default',
  case_id           uuid NOT NULL REFERENCES aml.cases(id) ON DELETE CASCADE,
  partner_org_id    uuid NOT NULL REFERENCES aml.partner_organisations(id) ON DELETE CASCADE,
  -- The exact agreement text the partner was shown. A later dispute is about
  -- what they read, never about what the current template happens to say.
  terms_version_id  uuid NOT NULL REFERENCES public.portal_terms_versions(id),

  recipient_name    text NOT NULL,
  recipient_email   text NOT NULL,

  -- The link credential is stored hashed; the plaintext exists only in the
  -- email. Same rule as every other token in this system.
  token_hash        text NOT NULL UNIQUE,
  expires_at        timestamptz NOT NULL,

  status            text NOT NULL DEFAULT 'sent'
                      CHECK (status IN ('sent','viewed','accepted','declined','expired','superseded')),

  sent_at           timestamptz NOT NULL DEFAULT now(),
  sent_by           uuid,
  resend_count      integer NOT NULL DEFAULT 0,
  viewed_at         timestamptz,
  accepted_at       timestamptz,
  declined_at       timestamptz,
  decline_reason    text,

  -- What they actually asserted, and who they said they were. Only keys the
  -- agreement defines are stored; an acceptance never claims more than was given.
  acknowledgements  jsonb,
  accepted_by_name  text,
  ip_hash           text,
  user_agent_hash   text,

  -- Written on acceptance only. This is the passport gate.
  agreement_id      uuid REFERENCES aml.reliance_agreements(id) ON DELETE SET NULL,

  -- A reissued request supersedes its predecessor rather than editing it.
  superseded_by_id  uuid REFERENCES aml.direct_partner_acknowledgements(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- An acceptance is only an acceptance with its evidence: when, what was
  -- ticked, and who typed their name. Enforced here as well as in code.
  CONSTRAINT dpa_accepted_is_evidenced CHECK (
    status <> 'accepted' OR (
      accepted_at IS NOT NULL
      AND accepted_by_name IS NOT NULL
      AND acknowledgements IS NOT NULL
      AND jsonb_typeof(acknowledgements) = 'array'
      AND jsonb_array_length(acknowledgements) > 0
    )
  ),
  CONSTRAINT dpa_declined_is_stamped CHECK (
    status <> 'declined' OR declined_at IS NOT NULL
  ),
  CONSTRAINT dpa_acknowledgements_shape CHECK (
    acknowledgements IS NULL OR jsonb_typeof(acknowledgements) = 'array'
  )
);

-- One LIVE request per partner per case: reissuing supersedes, so two open
-- links can never both be accepted into two arrangements.
CREATE UNIQUE INDEX IF NOT EXISTS dpa_one_live_request
  ON aml.direct_partner_acknowledgements (case_id, partner_org_id)
  WHERE status IN ('sent','viewed');

CREATE INDEX IF NOT EXISTS dpa_case_idx ON aml.direct_partner_acknowledgements (case_id);
CREATE INDEX IF NOT EXISTS dpa_org_idx  ON aml.direct_partner_acknowledgements (partner_org_id);
CREATE INDEX IF NOT EXISTS dpa_status_idx ON aml.direct_partner_acknowledgements (status);

ALTER TABLE aml.direct_partner_acknowledgements ENABLE ROW LEVEL SECURITY;

-- Service role only, like every other aml table. The public acceptance page
-- reaches it through the edge function, never directly.
DROP POLICY IF EXISTS "aml_dpa_service_only" ON aml.direct_partner_acknowledgements;
CREATE POLICY "aml_dpa_service_only" ON aml.direct_partner_acknowledgements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE aml.direct_partner_acknowledgements IS
  'A non-portal partner acknowledging the AML/CTF Compliance Passport Agreement through a one-time emailed link. Accepting creates the reliance_agreements row that grant_access requires — no acceptance, no passport.';
