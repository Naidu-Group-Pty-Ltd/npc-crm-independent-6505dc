-- =============================================================================
-- The Commercial & Industrial Capacity Report's render path
-- =============================================================================
-- Two things, both of which the format needs before a document can be generated
-- server-side. See docs/reports/COMMERCIAL_CAPACITY.md.
--
-- ── 1. Keep the analysis ────────────────────────────────────────────────────
--
-- The report's Analysis section is written by a language model from the figures
-- the engine produced. It is persisted rather than regenerated, for three
-- reasons in descending order of importance:
--
--   * **A re-issued report must say what the first one said.** A client who
--     receives the document twice and finds the reading of their deal has
--     changed has no way to tell whether the figures changed too. They did not;
--     the model is non-deterministic. Persisting is what makes the document
--     reproducible.
--   * A model call is metered. Re-rendering an unchanged assessment should not
--     spend one.
--   * The analysis is evidence of what was sent. Regenerating it destroys the
--     record of what the client was actually told.
--
-- jsonb rather than columns: it is a versioned nested shape owned by
-- `_shared/reports/commercialCapacity/analysis.pure.ts` (interpretation,
-- findings, scenarios, questions, and the model that wrote them), and
-- flattening it here would mean a migration every time that schema grows a
-- field.
--
-- It hangs off the **calculation run** rather than off the assessment, and that
-- placement is the whole point: an analysis interprets a specific set of
-- figures. Recalculating an assessment writes a NEW run — runs are immutable —
-- so an analysis can never outlive the numbers it was written about. On the
-- assessment it would have silently survived a recalculation and gone on
-- describing a facility that no longer existed.

ALTER TABLE public.commercial_industrial_calculation_runs
  ADD COLUMN IF NOT EXISTS analysis jsonb;

COMMENT ON COLUMN public.commercial_industrial_calculation_runs.analysis IS
  'CapacityAnalysis from render-commercial-capacity-pdf: the model-authored reading of THIS run''s figures — interpretation, findings, scenarios, credit questions, and the model and timestamp that produced them. Attached to the run rather than the assessment so it cannot outlive the numbers it interprets. See supabase/functions/_shared/reports/commercialCapacity/analysis.pure.ts.';

-- ── 2. A record of what was sent, and under whose brand ─────────────────────
--
-- The artefact side of `report_brand_snapshots` for this format, and a job row
-- as well as a record: a render that fails leaves a row saying why, which is
-- the difference between "the report never arrived" and an answer.

CREATE TABLE IF NOT EXISTS public.commercial_industrial_report_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT rather than CASCADE: deleting an assessment must not silently
  -- delete the evidence that a document was issued from it.
  assessment_id uuid NOT NULL
    REFERENCES public.commercial_industrial_assessments(id) ON DELETE RESTRICT,
  -- The run whose figures the document states. Without this, a render row
  -- cannot be tied back to the numbers it printed.
  calculation_run_id uuid
    REFERENCES public.commercial_industrial_calculation_runs(id) ON DELETE RESTRICT,

  -- The owner of the assessment, so this table can be scoped the way every
  -- other table in this feature is.
  user_id uuid NOT NULL,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- What was produced.
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  page_count integer,

  -- The brand it was issued under. RESTRICT for the reason the snapshot table
  -- uses it: a pinned brand that is still referenced cannot be removed.
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,

  -- What the brand snapshot was missing. Advisory: rendering does not stop for
  -- a missing ABN, but a support question about a document with no ABN on it
  -- has an answer here.
  brand_gaps text[] NOT NULL DEFAULT '{}',

  -- Whether the document carried a model-authored analysis, and why not when it
  -- did not. "The analysis is missing" is asked at the moment somebody is about
  -- to send the document, and "the model was unavailable" and "it was turned
  -- off" are different answers.
  has_analysis boolean NOT NULL DEFAULT false,
  analysis_note text,

  duration_ms integer,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.commercial_industrial_report_renders IS
  'One row per Commercial & Industrial Capacity Report render: what was produced, from which calculation run, and under which brand snapshot. Written by render-commercial-capacity-pdf.';

CREATE INDEX IF NOT EXISTS ci_report_renders_assessment_idx
  ON public.commercial_industrial_report_renders (assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ci_report_renders_user_idx
  ON public.commercial_industrial_report_renders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ci_report_renders_brand_idx
  ON public.commercial_industrial_report_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS ci_report_renders_failed_idx
  ON public.commercial_industrial_report_renders (created_at DESC)
  WHERE status = 'failed';

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- The same rule the rest of this feature uses, and deliberately not the rule
-- `borrowing_capacity_renders` uses. That table is scoped through `clients`,
-- because a Snapshot always has one. A C&I assessment need not be linked to a
-- client at all — standalone is a supported state in this workflow — so
-- scoping through `clients` here would make a standalone assessment's renders
-- readable by nobody, or by everybody, depending on how the join was written.
--
-- RLS admits service_role only; reads and writes go through the edge functions,
-- which authenticate the caller and scope every query by user_id.

ALTER TABLE public.commercial_industrial_report_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role manages ci report renders"
  ON public.commercial_industrial_report_renders;
CREATE POLICY "service_role manages ci report renders"
  ON public.commercial_industrial_report_renders FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.commercial_industrial_report_renders FROM anon, authenticated;
GRANT ALL ON public.commercial_industrial_report_renders TO service_role;
