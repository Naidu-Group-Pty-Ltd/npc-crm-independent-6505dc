-- The 10 Year Cash Flow Analysis's render path.
--
-- One table: a record of what was sent, and under whose brand.
--
-- The projection itself is deliberately **not** stored here. It is not the
-- server's to own — `CashFlowAnalysisModal` computes it live from overrides the
-- adviser may not have saved, and `cash_flow_analyses.analysis_data` already
-- holds the saved form. Duplicating it would create a second answer to "what
-- did this report say", which is the failure mode this programme is removing,
-- not adding.
--
-- What is worth keeping is the artefact: which file was produced, from which
-- report, by whom, under which pinned brand, and — when it failed — why. That
-- last column is the difference between "the client says the PDF never arrived"
-- and an answer.

CREATE TABLE IF NOT EXISTS public.cash_flow_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE here, unlike the borrowing capacity ledger: an investment report is
  -- the subject of the document rather than evidence beside it, and a deleted
  -- report has no render worth keeping.
  report_id uuid NOT NULL REFERENCES public.investment_reports(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- What the client received.
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,

  -- How many years were projected. Recorded because the answer is a property of
  -- the document a client holds, and the modal does not have to send ten.
  term_years integer,

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

COMMENT ON TABLE public.cash_flow_renders IS
  'One row per 10 Year Cash Flow Analysis render: what was produced, from which investment report, and under which brand snapshot. Written by render-cash-flow-pdf. The projection is not stored here — see the table comment in the migration for why.';

CREATE INDEX IF NOT EXISTS cash_flow_renders_report_idx
  ON public.cash_flow_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cash_flow_renders_brand_idx
  ON public.cash_flow_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS cash_flow_renders_failed_idx
  ON public.cash_flow_renders (created_at DESC)
  WHERE status = 'failed';

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file of a client's financial projections. The route
-- that writes it gates on the `reports / can_view` module permission, which is
-- the same gate `render-investment-report-pdf` applies to the same report; the
-- read policy below is the narrower of the two available rules, because a row
-- here is evidence and superadmins are who audit it.

ALTER TABLE public.cash_flow_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY cash_flow_renders_select
  ON public.cash_flow_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.cash_flow_renders FROM anon, authenticated;
GRANT SELECT ON public.cash_flow_renders TO authenticated;
GRANT ALL ON public.cash_flow_renders TO service_role;
