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