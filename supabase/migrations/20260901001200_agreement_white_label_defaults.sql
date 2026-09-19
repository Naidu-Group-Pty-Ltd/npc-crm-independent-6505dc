-- ─────────────────────────────────────────────────────────────────────────────
-- White-label: stop the founding tenant's identity being the default identity.
--
-- This product is sold to other agencies. Every name, ABN, email and phone on
-- a generated agreement is supposed to come from that deployment's own
-- `whitelabel_settings` / `contact_details`, and an audit of the whole
-- agreement path confirms it does — there is not one tenant literal in
-- `_shared/agreements/`, `manage-partner-agreements`, `agreement-centre-render`
-- or the DOCX builder.
--
-- The leaks were all in the database, as COLUMN DEFAULTS, which is the one
-- place a code audit does not look:
--
--   partner_agreements.principal_legal_name  DEFAULT 'NPC Services Pty Ltd'
--   whitelabel_settings.company_name         DEFAULT 'NPC Property'
--   whitelabel_settings.email_signature_name DEFAULT 'NPC Property Services'
--
-- The first is the serious one. `principal_legal_name` is the column behind the
-- `ba_legal_name` field, which prints on the cover particulars ("BETWEEN …"),
-- in the Agreement Details grid and on the execution block. An agreement
-- created on another agency's deployment without that field explicitly set
-- would have named **NPC Services Pty Ltd as a party to their contract** — a
-- silent, legally material error, on a page nobody re-reads because the rest
-- of the document is correctly branded.
--
-- The second is the source of `company_name` in `loadIssuerDefaults`, which
-- becomes the cover wordmark, the running header and the correspondence
-- sign-off. A fresh workspace that had not yet saved its branding would have
-- issued agreements masthead "NPC Property".
--
-- Empty string rather than NULL, and rather than dropping the default:
-- `principal_legal_name` is NOT NULL, and `substitutePlain` already treats an
-- empty value as unbound — it prints the field's own `<<INSERT>>` bracket. So
-- an unset party name now shows as a blank to fill in, which is what a
-- template is for, instead of asserting the wrong company.
--
-- Existing rows are untouched: changing a DEFAULT only affects future inserts.
-- This deployment's real values live in `whitelabel_settings` and
-- `global_report_settings` and are unaffected.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.partner_agreements
  ALTER COLUMN principal_legal_name SET DEFAULT '';

COMMENT ON COLUMN public.partner_agreements.principal_legal_name IS
  'The issuing party''s legal name. Defaults to empty, never to a company name: this column prints as a PARTY on the face of the agreement, so a wrong default is a wrong contract. Populated from the tenant''s own settings via the wizard, or left blank to print <<INSERT>>.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whitelabel_settings'
      AND column_name = 'company_name'
  ) THEN
    EXECUTE 'ALTER TABLE public.whitelabel_settings ALTER COLUMN company_name SET DEFAULT ''''';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whitelabel_settings'
      AND column_name = 'email_signature_name'
  ) THEN
    EXECUTE 'ALTER TABLE public.whitelabel_settings ALTER COLUMN email_signature_name SET DEFAULT ''''';
  END IF;
END $$;
