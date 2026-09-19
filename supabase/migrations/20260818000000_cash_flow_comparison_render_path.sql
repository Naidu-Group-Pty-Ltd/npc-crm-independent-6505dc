-- The Cash Flow Comparison Analysis's render path.
--
-- One table: a record of what was sent, of what, and under whose brand.
--
-- The projections are deliberately **not** stored here, for the reason
-- `20260815000000_cash_flow_render_path.sql` gives for the single-property
-- format: they are computed live in `CashFlowAnalysisModal` from overrides the
-- adviser may not have saved, and duplicating them would create a second answer
-- to "what did this report say".
--
-- Nor is the model's analysis. `cash_flow_analyses` already exists for that and
-- holds zero rows — its INSERT policy requires `auth.role() = 'authenticated'`
-- while this application signs in through `custom_users`, and its SELECT policy
-- requires `created_by = auth.uid()` while the modal's insert never sets
-- `created_by`. That is a real defect and it is recorded in
-- `docs/reports/CASH_FLOW_COMPARISON.md`, but it is not this table's to fix:
-- a render ledger that started persisting analyses would be a third answer.
--
-- What is worth keeping is the artefact and the shape of what produced it.

CREATE TABLE IF NOT EXISTS public.cash_flow_comparison_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The report the adviser had open. It names the file and the storage prefix,
  -- so a deleted report has no render worth keeping.
  primary_report_id uuid NOT NULL REFERENCES public.investment_reports(id) ON DELETE CASCADE,

  -- Every report compared, the primary included, in display order.
  --
  -- An array carries no foreign key and that is the point: a peer report being
  -- deleted must not delete the record that a document comparing it was sent.
  -- An id in here that no longer resolves is evidence, not corruption.
  compared_report_ids uuid[] NOT NULL DEFAULT '{}',
  property_count integer,

  -- The profile the comparison was run under.
  --
  -- Recorded because the model is asked to rank "for the ${investorProfile}
  -- investor" (`compare-cash-flow-reports/index.ts:155`), so a document produced
  -- under `growth` and one under `income` are different documents from the same
  -- properties, and a support question about which one a client holds needs an
  -- answer that is not a guess.
  investor_profile text,

  -- Whether the adviser had generated a written analysis at all.
  --
  -- The question this column exists to answer is "what proportion of the
  -- documents we send carry model prose", because the four sections that depend
  -- on it are the most expensive part of this format to maintain and nobody
  -- currently knows how often they appear.
  has_ai_analysis boolean NOT NULL DEFAULT false,

  -- Which of the producer's eight sections did not arrive.
  --
  -- `compare-cash-flow-reports` asks for eight sections under a 4,000-token
  -- ceiling — a third of what the sibling comparison function is given, and that
  -- one truncated 94% of its five-property calls. Here truncation fails loudly
  -- rather than storing a damaged row, so there is nothing to salvage; what does
  -- happen is a model closing its braces early, and this column is how often.
  ai_sections_missing text[] NOT NULL DEFAULT '{}',

  -- How many years were projected. A property of the document a client holds.
  term_years integer,

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

COMMENT ON TABLE public.cash_flow_comparison_renders IS
  'One row per Cash Flow Comparison Analysis render: what was produced, which investment reports it compared, whether it carried a written analysis, and under which brand snapshot. Written by render-cash-flow-comparison-pdf. Neither the projections nor the analysis are stored here — see the migration header for why.';

CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_primary_idx
  ON public.cash_flow_comparison_renders (primary_report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_brand_idx
  ON public.cash_flow_comparison_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_failed_idx
  ON public.cash_flow_comparison_renders (created_at DESC)
  WHERE status = 'failed';
-- "How many documents did we send without a written analysis?" is the question
-- that decides whether the four model-dependent sections earn their keep, and it
-- should be one query rather than a scan.
CREATE INDEX IF NOT EXISTS cash_flow_comparison_renders_analysis_idx
  ON public.cash_flow_comparison_renders (has_ai_analysis, created_at DESC);

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file of several clients' financial projections. The
-- route that writes it gates on the `reports / can_view` module permission — the
-- same gate `render-cash-flow-pdf` and `render-investment-report-pdf` apply to
-- the same underlying reports; the read policy below is the narrower of the two
-- available rules, because a row here is evidence and superadmins are who audit
-- it.

ALTER TABLE public.cash_flow_comparison_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_flow_comparison_renders_select
  ON public.cash_flow_comparison_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.cash_flow_comparison_renders FROM anon, authenticated;
GRANT SELECT ON public.cash_flow_comparison_renders TO authenticated;
GRANT ALL ON public.cash_flow_comparison_renders TO service_role;
