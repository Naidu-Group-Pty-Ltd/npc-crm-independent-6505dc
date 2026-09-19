-- Turn the partner AML/CTF Compliance page ON — the Passport, and only that.
--
-- The page, the routes, the nav entries and the shared workspace all already
-- existed and had never served a partner. Five of the six reasons are code and
-- are fixed in this change; the sixth is this: every flag was off, so the nav
-- entry did not render and the page answered "not available".
--
-- What this enables, and deliberately what it does not:
--
--   aml_partner_compliance_workspace  ON   the master switch for the
--                                          session-authenticated partner ops
--   aml_partner_workspace_finance     ON   the page exists in each portal
--   aml_partner_workspace_builder     ON   (builder also serves developer
--   aml_partner_workspace_solicitor   ON    organisations — one portal)
--   aml_partner_passport_view         ON   the Passport document is served
--
--   aml_partner_workspace_full        LEFT OFF — deliberately.
--
-- That last line is the safety property. `partnerSurfaceMode` resolves the
-- surface to `passport_only` when the Passport is on and the full workspace is
-- not, so this migration shows a partner the Compliance Passport, the statutory
-- responsibility notice and a support route — and NONE of the eight Phase 4
-- panels (records requests, the independent determination form, evidence
-- deliveries, the audit receipt, the clarification channel). Several of those
-- would render and then refuse, because their own write flags
-- (aml_partner_records_requests_write, aml_partner_determinations_write,
-- aml_partner_evidence_delivery_write) are separately off and stay off here.
--
-- Nothing about disclosure is decided by these flags. A partner still reaches
-- the page only through their own portal session, mapped to an ACTIVE
-- membership on a canonical organisation that is cross-referenced to their
-- portal organisation, on a matter linked to their organisation; and the
-- document is served only when `passportDisclosure` allows it — a live grant on
-- a current attestation. Every one of those is re-checked on every request.
--
-- Reversible in one statement: set the five keys back to 'false'::jsonb.
UPDATE public.feature_flags
   SET value = 'true'::jsonb,
       updated_at = now()
 WHERE key IN (
         'aml_partner_compliance_workspace',
         'aml_partner_workspace_finance',
         'aml_partner_workspace_builder',
         'aml_partner_workspace_solicitor',
         'aml_partner_passport_view'
       );

-- The full workspace stays off. Stated as an assertion rather than assumed,
-- because enabling it here would be a silent eight-panel rollout.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.feature_flags
     WHERE key = 'aml_partner_workspace_full' AND value = 'true'::jsonb
  ) THEN
    RAISE EXCEPTION
      'aml_partner_workspace_full is ON. This migration enables the Passport-only surface; enabling the full Phase 4 workspace is a separate, reviewed decision.';
  END IF;
END $$;
