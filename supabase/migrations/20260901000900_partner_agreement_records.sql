-- A downloadable, retained copy of every executed Partner Portal Agreement.
--
-- The acceptance itself has been recorded since the cascade — who accepted,
-- against which version, which acknowledgments they asserted, when, from what
-- hashed address. What did not exist was the artefact: a document a person can
-- open, read and keep, showing the agreement as executed between two named
-- organisations. "We have a row in a table" is not a copy of an agreement.
--
-- WHY THE PDF IS GENERATED ON DEMAND AND THEN KEPT, rather than generated at
-- acceptance:
--
--   * Acceptance must not depend on a PDF renderer being up. Blocking a partner
--     at the door because a container is restarting is the wrong trade, and a
--     retry loop inside the accept path is a second failure mode on the one
--     request that must not fail.
--   * Every acceptance already recorded — including the solicitor acceptances
--     taken before this feature existed — gets a record the first time anyone
--     asks for one. Generating only at acceptance would have left those with
--     nothing, permanently.
--   * The document is reproducible from data that is already immutable: the
--     terms version's text and hash, and the acceptance row. The only volatile
--     input is the white-label branding, which is why it is snapshotted into
--     the row the first time the record is generated and reused afterwards.
--
-- So the first request renders and stores; every later request serves the same
-- stored bytes. The file is never regenerated over the top of itself — a
-- partner and the Command Centre must be able to hold the same document.

-- ===========================================================================
-- 1. Where the artefact lives on the acceptance
-- ===========================================================================
ALTER TABLE public.portal_terms_acceptances
  ADD COLUMN IF NOT EXISTS agreement_storage_path text,
  ADD COLUMN IF NOT EXISTS agreement_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_pdf_bytes integer,
  ADD COLUMN IF NOT EXISTS agreement_brand_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS agreement_party_snapshot jsonb;

COMMENT ON COLUMN public.portal_terms_acceptances.agreement_storage_path IS
  'Object path in the partner-agreements bucket for the executed copy of this agreement. Written once, when the copy is first generated; the bytes are never replaced, so a copy already supplied to a partner stays byte-identical to the one the Command Centre holds.';
COMMENT ON COLUMN public.portal_terms_acceptances.agreement_brand_snapshot IS
  'The white-label configuration used to produce the stored copy — operator name, ABN, contact details. Snapshotted because branding is editable and the document must keep saying what it said when it was executed.';
COMMENT ON COLUMN public.portal_terms_acceptances.agreement_party_snapshot IS
  'The two parties as they stood at generation: the accepting person and their partner organisation. A renamed firm must not silently rewrite an executed agreement.';

-- One acceptance, one artefact. A second path for the same acceptance would
-- mean two documents claiming to be the same executed agreement.
CREATE UNIQUE INDEX IF NOT EXISTS portal_terms_acceptances_agreement_path_key
  ON public.portal_terms_acceptances(agreement_storage_path)
  WHERE agreement_storage_path IS NOT NULL;

-- The generated columns move together or not at all: a path with no timestamp
-- is a half-written record, and a timestamp with no path points at nothing.
ALTER TABLE public.portal_terms_acceptances
  DROP CONSTRAINT IF EXISTS portal_terms_acceptances_agreement_artefact_complete;
ALTER TABLE public.portal_terms_acceptances
  ADD CONSTRAINT portal_terms_acceptances_agreement_artefact_complete
  CHECK (num_nonnulls(agreement_storage_path, agreement_generated_at) IN (0, 2)) NOT VALID;
ALTER TABLE public.portal_terms_acceptances
  VALIDATE CONSTRAINT portal_terms_acceptances_agreement_artefact_complete;

-- ===========================================================================
-- 2. A private bucket of its own
--
-- Not a report bucket and not a client bucket: these are executed agreements
-- between the operator and a partner organisation, and nothing else belongs in
-- the same namespace. Private, so every download is a signed URL minted by a
-- function that has already checked who is asking.
-- ===========================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('partner-agreements', 'partner-agreements', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Service role only. There is no policy for `authenticated` or `anon` on
-- purpose: a Command Centre user reaches these through
-- `partner-agreement-records`, which checks the module permission first, and a
-- partner reaches their own through their own portal's session. Neither holds a
-- Postgres role that can read the bucket directly.
DROP POLICY IF EXISTS partner_agreements_service ON storage.objects;
CREATE POLICY partner_agreements_service ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'partner-agreements')
  WITH CHECK (bucket_id = 'partner-agreements');

-- ===========================================================================
-- 3. The Command Centre's view of who has executed what
--
-- One row per acceptance across all three portals, with the party names
-- resolved. A view rather than three queries in the client, so "which partners
-- have signed" cannot mean three different things in three tabs.
-- ===========================================================================
-- [Phase 7, network extraction] The builder legs left with the portal — a
-- view is validated at creation, so a fresh clone could not build the old
-- definition against dropped tables, and the builder acceptance rows this
-- register would have shown were deleted (and archived) by 20261124000000.
-- Shape-identical to the original and to the definition the decommission
-- migration installs on databases that predate this edit.
CREATE OR REPLACE VIEW public.partner_agreement_records AS
SELECT
  a.id                        AS acceptance_id,
  a.portal,
  a.accepted_at,
  a.acknowledgements,
  a.agreement_storage_path,
  a.agreement_generated_at,
  a.agreement_pdf_bytes,
  v.id                        AS terms_version_id,
  v.version,
  v.title,
  v.document_hash,
  COALESCE(s.id, f.id)        AS portal_user_id,
  COALESCE(s.name, fc.name)   AS accepted_by_name,
  COALESCE(s.email, f.email)  AS accepted_by_email,
  COALESCE(sf.name, fc.company) AS organisation_name,
  sf.trading_name             AS organisation_trading_name
FROM public.portal_terms_acceptances a
JOIN public.portal_terms_versions v ON v.id = a.terms_version_id
LEFT JOIN public.solicitor_portal_users s ON s.id = a.solicitor_user_id
LEFT JOIN public.solicitor_firms sf       ON sf.id = s.firm_id
LEFT JOIN public.finance_portal_users f   ON f.id = a.finance_user_id
LEFT JOIN public.finance_agent_contacts fc ON fc.id = f.finance_contact_id;

COMMENT ON VIEW public.partner_agreement_records IS
  'Executed Partner Portal Agreements across the Solicitor, Builder and Finance portals, with both parties resolved. Read by partner-agreement-records for the Command Centre; service-role only, like the tables beneath it.';

REVOKE ALL ON public.partner_agreement_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partner_agreement_records TO service_role;

-- ===========================================================================
-- 4. Assertions
-- ===========================================================================
DO $$
DECLARE v_count bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'partner-agreements' AND public = false
  ) THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: the partner-agreements bucket is missing or public';
  END IF;

  -- The view must run, not merely parse: it joins six tables and a LATERAL, and
  -- a wrong column name here is invisible until a Command Centre user opens the
  -- tab.
  SELECT count(*) INTO v_count FROM public.partner_agreement_records;
  RAISE NOTICE 'partner agreement records: view returns % executed agreements', v_count;
END $$;
