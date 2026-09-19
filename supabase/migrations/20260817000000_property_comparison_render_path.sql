-- The Property Comparison Analysis's render path.
--
-- One table: a record of what was produced, from which comparison, and under
-- whose brand.
--
-- The document's contents are deliberately **not** stored here. Everything this
-- format prints is already in the `property_comparisons` row, which is pointed at
-- below. Copying it would create a second answer to "what did this comparison
-- say", which is the failure mode this programme is removing.
--
-- Three columns no prior ledger needed, and the reason they exist:
--
--   Twenty-seven of the fifty stored comparisons were saved *while the analysis
--   was still being written*. The producer asks a model for ten sections of JSON
--   under a 12,000-token ceiling; for five properties the response is cut off,
--   the parse throws, and the raw text is stored with every structured column
--   left NULL. The renderer reads those rows back and says on the page which
--   sections the record does not hold.
--
--   `source_shape`, `recovered_sections` and `missing_sections` are how that
--   becomes answerable after the fact: "how many documents did we send from a
--   truncated record, and what was missing from them" should be one query rather
--   than a re-render of everything.
--
-- `score_scale` is here for a related reason: `rankings[].finalScore` is recorded
-- out of 100 on most rows and out of 10 on six, the newest included, and the
-- renderer infers which. Recording what it inferred means the inference can be
-- audited instead of trusted.
--
-- Note what this migration does *not* do: it adds nothing to
-- `property_comparisons`. No `pdf_file_path`, no backfill of the recovered JSON
-- into the seven columns, and no `structure_version` bump. That column already
-- means two things; writing rows we did not produce would make it mean three.

CREATE TABLE IF NOT EXISTS public.property_comparison_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: the comparison is the subject of the document, and a deleted
  -- comparison has no render worth keeping.
  comparison_id uuid NOT NULL REFERENCES public.property_comparisons(id) ON DELETE CASCADE,

  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- What the client received.
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  property_count integer,
  pages integer,

  -- Where the content came from, and what it was missing.
  source_shape text CHECK (source_shape IN ('columns', 'salvaged')),
  recovered_sections text[] NOT NULL DEFAULT '{}',
  missing_sections text[] NOT NULL DEFAULT '{}',

  -- 10 or 100. NULL when the analysis scored nothing, which is a real state:
  -- the newest comparisons score every property zero because the underlying
  -- reports carried no data to score.
  score_scale integer CHECK (score_scale IS NULL OR score_scale IN (10, 100)),

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

COMMENT ON TABLE public.property_comparison_renders IS
  'One row per Property Comparison Analysis render: what was produced, from which comparison, under which brand snapshot, and — when the source record was truncated — which sections it was missing. Written by render-property-comparison-pdf. The document contents are not stored here; the source row is referenced instead.';

CREATE INDEX IF NOT EXISTS property_comparison_renders_comparison_idx
  ON public.property_comparison_renders (comparison_id, created_at DESC);
CREATE INDEX IF NOT EXISTS property_comparison_renders_brand_idx
  ON public.property_comparison_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS property_comparison_renders_failed_idx
  ON public.property_comparison_renders (created_at DESC)
  WHERE status = 'failed';
-- And from "how many documents went out from a truncated record", which is the
-- question the salvage path exists to make answerable.
CREATE INDEX IF NOT EXISTS property_comparison_renders_shape_idx
  ON public.property_comparison_renders (source_shape, created_at DESC)
  WHERE source_shape IS NOT NULL;

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file comparing several properties' financials. The
-- route that writes it gates on the `reports / can_view` module permission — the
-- same gate `render-investment-report-pdf` applies to the reports a comparison is
-- derived from. The read policy below is the narrower of the two available rules,
-- because a row here is evidence and superadmins are who audit it. This matches
-- `cash_flow_renders`, `borrowing_capacity_renders` and
-- `portfolio_review_renders`.

ALTER TABLE public.property_comparison_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY property_comparison_renders_select
  ON public.property_comparison_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.property_comparison_renders FROM anon, authenticated;
GRANT SELECT ON public.property_comparison_renders TO authenticated;
GRANT ALL ON public.property_comparison_renders TO service_role;
