-- The Borrowing Capacity Snapshot's render path.
--
-- Two things, both of which the format needs before a document can be generated
-- server-side. See docs/reports/BORROWING_CAPACITY.md.
--
-- ── 1. Keep the audit trail and the explanation (F12) ───────────────────────
--
-- `calculate-borrowing-capacity` builds both on every assessment and returns
-- them in its response — and its INSERT does not write them, because there is
-- nowhere to write them. Every generator reads them off the stored row, in
-- camelCase, from an all-snake_case table, so they are always undefined. Two
-- pages of the report — the two that would actually explain a lending decision
-- to the client — have never appeared in a document anyone received.
--
-- The alternative was to recompute them at render time. That is worse: a
-- recomputation runs against today's policy and today's HEM benchmark, so the
-- audit trail could disagree with the headline figures printed beside it on the
-- same page. A report must explain the numbers it is showing, not different
-- ones.
--
-- jsonb rather than columns: both are versioned nested shapes owned by the
-- engine (`AuditTrailData`, `ExplanationReport`), and flattening them here would
-- mean a migration every time the engine grows an entry type.

ALTER TABLE public.borrowing_capacity_assessments
  ADD COLUMN IF NOT EXISTS audit_trail jsonb,
  ADD COLUMN IF NOT EXISTS explanation jsonb;

COMMENT ON COLUMN public.borrowing_capacity_assessments.audit_trail IS
  'AuditTrailData from calculate-borrowing-capacity: every value the lender adjusted, what it started as, and the rule that moved it. Read by the report renderer; see supabase/functions/_shared/reports/borrowingCapacity/audit.pure.ts for the unit and polarity of each entry.';
COMMENT ON COLUMN public.borrowing_capacity_assessments.explanation IS
  'ExplanationReport from calculate-borrowing-capacity: the assessment step by step, in plain terms.';

-- ── 2. A record of what was sent, and under whose brand ─────────────────────
--
-- The artefact side of `report_brand_snapshots` (migration 20260813000000) for
-- this format. `investment_reports.brand_snapshot_id` covers the investment
-- report; a Borrowing Capacity Snapshot has no report row of its own, so this
-- is it.
--
-- It is a job row as well as a record: a render that fails leaves a row saying
-- why, which is the difference between "the client says the PDF never arrived"
-- and an answer.

CREATE TABLE IF NOT EXISTS public.borrowing_capacity_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT rather than CASCADE on the assessment: deleting an assessment must
  -- not silently delete the evidence that a document was issued from it.
  assessment_id uuid REFERENCES public.borrowing_capacity_assessments(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- What the client received.
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,

  -- The brand it was issued under. RESTRICT for the same reason the snapshot
  -- table uses it: a pinned brand that is still referenced cannot be removed.
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,

  -- What the brand snapshot was missing, from `auditSnapshot()`. Advisory:
  -- rendering does not stop for a missing ABN, but a support question about a
  -- document with no ABN on it has an answer here.
  brand_gaps text[] NOT NULL DEFAULT '{}',

  duration_ms integer,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.borrowing_capacity_renders IS
  'One row per Borrowing Capacity Snapshot render: what was produced, for whom, and under which brand snapshot. Written by render-borrowing-capacity-pdf.';

CREATE INDEX IF NOT EXISTS borrowing_capacity_renders_client_idx
  ON public.borrowing_capacity_renders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS borrowing_capacity_renders_assessment_idx
  ON public.borrowing_capacity_renders (assessment_id)
  WHERE assessment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS borrowing_capacity_renders_brand_idx
  ON public.borrowing_capacity_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS borrowing_capacity_renders_failed_idx
  ON public.borrowing_capacity_renders (created_at DESC)
  WHERE status = 'failed';

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row names a client and points at a file of their financials. It is
-- readable by whoever can already read that client, using the same rule the
-- rest of the client tables use, and writable only by the render path.

ALTER TABLE public.borrowing_capacity_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY borrowing_capacity_renders_select
  ON public.borrowing_capacity_renders
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = borrowing_capacity_renders.client_id
        AND (
          c.created_by = auth.uid()
          OR c.assigned_team_user_id = auth.uid()
          OR public.has_role(auth.uid(), 'superadmin')
        )
    )
  );

REVOKE ALL ON public.borrowing_capacity_renders FROM anon, authenticated;
GRANT SELECT ON public.borrowing_capacity_renders TO authenticated;
GRANT ALL ON public.borrowing_capacity_renders TO service_role;
