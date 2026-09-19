-- The executed copy of a DIRECT partner acknowledgement.
--
-- Every portal partner's executed agreement can be produced as a PDF from
-- Partner Agreement Records. A partner who acknowledged the same instrument
-- through an emailed link had no such document — the acceptance was recorded
-- with its evidence, but nothing could be handed to an auditor, to the
-- partner, or to the client's file. An executed agreement that cannot be
-- produced is a weak record.
--
-- These columns mirror `portal_terms_acceptances` exactly, including its
-- artefact-complete constraint: a stored path and a generation time are
-- written together or not at all, so a half-written artefact can never be
-- mistaken for a real one. The copy itself is written ONCE and never
-- overwritten — see `partnerAgreementRevision.pure.ts` on why a re-render
-- writes a NEW object and repoints the row instead.

ALTER TABLE aml.direct_partner_acknowledgements
  ADD COLUMN IF NOT EXISTS agreement_storage_path text,
  ADD COLUMN IF NOT EXISTS agreement_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_pdf_bytes integer,
  -- The tenant's brand and the party names, frozen at render time: both are
  -- editable, and an executed agreement must keep saying what it said.
  ADD COLUMN IF NOT EXISTS agreement_brand_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS agreement_party_snapshot jsonb;

ALTER TABLE aml.direct_partner_acknowledgements
  DROP CONSTRAINT IF EXISTS dpa_agreement_artefact_complete;
ALTER TABLE aml.direct_partner_acknowledgements
  ADD CONSTRAINT dpa_agreement_artefact_complete
  CHECK (num_nonnulls(agreement_storage_path, agreement_generated_at) = ANY (ARRAY[0, 2]));

COMMENT ON COLUMN aml.direct_partner_acknowledgements.agreement_storage_path IS
  'The executed-agreement PDF in the partner-agreements bucket, under a direct/ prefix. Written once; a new revision writes a new object rather than replacing this one.';
