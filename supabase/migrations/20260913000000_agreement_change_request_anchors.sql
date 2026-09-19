-- Pin a change request to the clause it is about.
--
-- `partner_agreement_change_requests` identified a section and carried prose.
-- The partner had to translate "the second sentence of 3.2" into one of nine
-- broad sections and describe the location in words; the issuer read the prose
-- and went looking. The request had no address.
--
-- The address already existed: `contentOverrides.pure.ts` gives every text node
-- of the template a stable path so the issuer can amend that exact node. An
-- anchor stores the same path, which is what lets a request and the amendment
-- that answers it name the same clause.
--
-- Three columns, all nullable, no constraints and no backfill:
--   * an existing request simply has no anchor and renders in the list as it
--     always did;
--   * `anchor_label` is stored rather than re-derived, so a request survives
--     the clause being renumbered — it degrades to a section-level entry
--     instead of silently re-pinning itself to whatever now occupies that path.
--     A comment about a commission rate landing on a termination clause is
--     worse than no pin at all;
--   * `anchor_quote` keeps a short extract so a stale anchor can still show
--     what it was about.
--
-- The code does NOT require this migration. Migrations here are applied out of
-- band and one has already sat unapplied for three weeks, so the server probes
-- for these columns and, when they are absent, saves the request with its
-- location stated in the first line of the comment. The pin is lost; the
-- request never is. Applying this turns the pins on with no code change.

ALTER TABLE public.partner_agreement_change_requests
  ADD COLUMN IF NOT EXISTS anchor_path text,
  ADD COLUMN IF NOT EXISTS anchor_label text,
  ADD COLUMN IF NOT EXISTS anchor_quote text;

COMMENT ON COLUMN public.partner_agreement_change_requests.anchor_path IS
  'Content-slot path of the clause this request is pinned to — the same key an amendment writes to (see _shared/agreements/contentOverrides.pure.ts). Null for an unpinned or pre-anchoring request.';

COMMENT ON COLUMN public.partner_agreement_change_requests.anchor_label IS
  'Human label of the clause AT THE TIME the request was raised ("Clause 11.2"). Stored rather than re-derived so a renumbered clause degrades to a section-level entry instead of re-pinning to whatever now occupies the path.';

COMMENT ON COLUMN public.partner_agreement_change_requests.anchor_quote IS
  'Short extract of the wording the partner was reading, so a stale anchor still shows its subject.';

-- Open requests are read per agreement on every document render, on both
-- portals. This is the shape of that read.
CREATE INDEX IF NOT EXISTS idx_pacr_agreement_anchor
  ON public.partner_agreement_change_requests (agreement_id, status)
  INCLUDE (anchor_path);
