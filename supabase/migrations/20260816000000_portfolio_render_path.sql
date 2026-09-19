-- The Portfolio Performance Review's render path.
--
-- One table: a record of what was produced, from which report, and under whose
-- brand.
--
-- The document's contents are deliberately **not** stored here. Unlike the Cash
-- Flow ledger — whose subject is computed live in the browser — everything this
-- format says already lives in `portfolio_analysis_reports.report_data` and, when
-- there is one, a `portfolio_reviews` row. Both are pointed at below. Copying
-- their contents into a third place would create a second answer to "what did
-- this review say", which is the failure mode this programme is removing.
--
-- What is worth keeping is the artefact, and the two rows it was made from: a
-- reader of this table can reproduce any document it names.
--
-- Note what this migration does *not* do: it does not touch
-- `portfolio_analysis_reports.pdf_file_path`. That column is what *publish to
-- client portal* reads (`manage-client-data/index.ts:540-609`, uniqueness-guarded
-- by `20260724000000_prevent_duplicate_portfolio_publications.sql`). Pointing it
-- at a document produced by a different renderer would silently change what every
-- future publication sends a client. Switching that over stays a separate,
-- deliberate decision.

CREATE TABLE IF NOT EXISTS public.portfolio_review_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: the report is the subject of the document, and a deleted report has
  -- no render worth keeping.
  report_id uuid NOT NULL REFERENCES public.portfolio_analysis_reports(id) ON DELETE CASCADE,

  -- Denormalised from the report deliberately. The report carries the client, but
  -- a support question here starts from "which of this client's reviews were
  -- sent", and CASCADE on the report would otherwise take the answer with it.
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,

  -- Which review was folded in, or NULL when the document was written from the
  -- analysis alone. SET NULL rather than CASCADE: the render still happened, and
  -- losing the row would make a document unaccounted for.
  review_id uuid REFERENCES public.portfolio_reviews(id) ON DELETE SET NULL,

  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- What the client received.
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,

  -- How many properties the document covered, and how long it ran to. Recorded
  -- because this is the one migrated format whose length scales with its
  -- subject, so "is this document the size it should be" is a question with two
  -- numbers in it rather than one.
  holdings integer,
  pages integer,

  -- The brand it was issued under. RESTRICT for the same reason the snapshot
  -- table uses it: a pinned brand that is still referenced cannot be removed.
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,

  -- What the brand snapshot was missing. Advisory: rendering does not stop for a
  -- missing ABN, but a support question about a document with no ABN on it has an
  -- answer here.
  brand_gaps text[] NOT NULL DEFAULT '{}',

  duration_ms integer,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portfolio_review_renders IS
  'One row per Portfolio Performance Review render: what was produced, from which analysis report and review, and under which brand snapshot. Written by render-portfolio-review-pdf. The document contents are not stored here — the two source rows are referenced instead.';

CREATE INDEX IF NOT EXISTS portfolio_review_renders_report_idx
  ON public.portfolio_review_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portfolio_review_renders_client_idx
  ON public.portfolio_review_renders (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS portfolio_review_renders_brand_idx
  ON public.portfolio_review_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS portfolio_review_renders_failed_idx
  ON public.portfolio_review_renders (created_at DESC)
  WHERE status = 'failed';

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file holding a client's whole financial position. The
-- route that writes it gates on ownership of the client, falling back to the
-- `portfolio_reports / can_view` module permission; the read policy below is the
-- narrower of the two available rules, because a row here is evidence and
-- superadmins are who audit it. This matches `cash_flow_renders` and
-- `borrowing_capacity_renders`.

ALTER TABLE public.portfolio_review_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY portfolio_review_renders_select
  ON public.portfolio_review_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.portfolio_review_renders FROM anon, authenticated;
GRANT SELECT ON public.portfolio_review_renders TO authenticated;
GRANT ALL ON public.portfolio_review_renders TO service_role;
