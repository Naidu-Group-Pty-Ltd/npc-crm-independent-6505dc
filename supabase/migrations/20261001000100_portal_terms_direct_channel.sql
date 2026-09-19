-- The AML/CTF Compliance Passport Agreement, published for the DIRECT channel.
--
-- A partner outside the three portals acknowledges the SAME instrument the
-- portals do — same title, same clauses, same mandatory acknowledgements —
-- through a one-time emailed link instead of a sign-up. For the record to say
-- honestly what they were shown, the text needs a row of its own rather than
-- borrowing another channel's.
--
-- WIDENING, not changing: 'direct' is ADDED to the allowed portals. Every
-- reader of this table either filters by its own portal
-- (`eq('portal','finance'|'builder'|'solicitor')`) or reads a specific row by
-- id, so a 'direct' row is invisible to all of them, and no existing row
-- changes. `portal_terms_acceptances` is untouched — its own portal check and
-- owner constraints stay exactly as they are, which is why direct
-- acknowledgements live in `aml.direct_partner_acknowledgements` instead.
--
-- The content is COPIED from the live agreement rather than retyped: the
-- direct partner must be shown the same words, and a transcription is how two
-- versions of one instrument start to drift.

ALTER TABLE public.portal_terms_versions
  DROP CONSTRAINT IF EXISTS portal_terms_versions_portal_check;

ALTER TABLE public.portal_terms_versions
  ADD CONSTRAINT portal_terms_versions_portal_check
  CHECK (portal = ANY (ARRAY['solicitor'::text, 'builder'::text, 'finance'::text, 'direct'::text]));

INSERT INTO public.portal_terms_versions
  (portal, version, title, content_markdown, published_at, effective_at, document_hash)
SELECT
  'direct', src.version, src.title, src.content_markdown,
  src.published_at, src.effective_at, src.document_hash
FROM public.portal_terms_versions src
WHERE src.portal = 'finance'
  AND src.retired_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.portal_terms_versions d
    WHERE d.portal = 'direct' AND d.version = src.version
  )
ORDER BY src.effective_at DESC NULLS LAST
LIMIT 1;
