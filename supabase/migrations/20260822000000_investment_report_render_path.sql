-- The investment report's render path.
--
-- One table: a record of what was produced, from which report, under whose
-- brand, and — new for this format — how much of the document was actually
-- drawn rather than written.
--
-- The report is deliberately not copied here. It is already one row of
-- `investment_reports` carrying six jsonb columns and up to 338,471 characters
-- of prose, and this document is a rendering of it. The same reasoning every
-- other ledger in this programme gives.

CREATE TABLE IF NOT EXISTS public.investment_report_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: the document is *of* the report.
  report_id uuid NOT NULL
    REFERENCES public.investment_reports(id) ON DELETE CASCADE,

  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'investment-reports',
  storage_path text,
  bytes integer,
  page_count integer,

  -- How much of the document is picture rather than prose.
  --
  -- The point of this migration is that six jsonb columns of measurement — the
  -- score breakdown, the walk score, the household profile, the macro
  -- indicators, the cost lines, the three-scenario projection — stop being
  -- retyped as prose and start being drawn. `charts_drawn` is how anyone checks
  -- that is actually happening in production rather than only in a fixture.
  --
  -- `charts_skipped` is the more interesting number. A chart is skipped when the
  -- section that earns it has no data behind it, which is ordinary — but a jump
  -- in the skip rate means an upstream column stopped being populated, and this
  -- is the only place that would show.
  charts_drawn integer NOT NULL DEFAULT 0,
  charts_skipped integer NOT NULL DEFAULT 0,

  -- Which of the two big optional payloads the report actually had.
  --
  -- Measured before the work: 979 of 1,176 rows carry a score and only **179**
  -- carry a financial model. So a document with no yield and no projection is
  -- the ordinary case, not a failure, and these two columns are what stops
  -- somebody reading the absence as one.
  has_financials boolean NOT NULL DEFAULT false,
  has_score boolean NOT NULL DEFAULT false,

  -- What the caps did not carry.
  chapters_dropped integer NOT NULL DEFAULT 0,
  chars_omitted integer NOT NULL DEFAULT 0,

  -- The chapters the document turned out to have. Taken from the prose's own
  -- numbered skeleton, so two reports of the same tier should agree.
  chapters_included text[] NOT NULL DEFAULT '{}',

  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
  brand_gaps text[] NOT NULL DEFAULT '{}',

  duration_ms integer,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.investment_report_renders IS
  'One row per investment report render: what was produced, how many infographics were drawn against how many were skipped for want of data, whether the row carried a score and a financial model, and under which brand snapshot. Written by render-investment-report-pdf.';

CREATE INDEX IF NOT EXISTS investment_report_renders_report_idx
  ON public.investment_report_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS investment_report_renders_brand_idx
  ON public.investment_report_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS investment_report_renders_failed_idx
  ON public.investment_report_renders (created_at DESC)
  WHERE status = 'failed';
-- "Are we still drawing the charts?" — one query, and the reason this ledger
-- differs from the other seven.
CREATE INDEX IF NOT EXISTS investment_report_renders_skipped_idx
  ON public.investment_report_renders (created_at DESC)
  WHERE charts_skipped > 0;

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file describing a named property and, on the
-- client-report path, a named client's position. The route gates on
-- `reports / can_view`; the read policy here is the narrowest available,
-- because a row is evidence and superadmins are who audit it.

ALTER TABLE public.investment_report_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY investment_report_renders_select
  ON public.investment_report_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.investment_report_renders FROM anon, authenticated;
GRANT SELECT ON public.investment_report_renders TO authenticated;
GRANT ALL ON public.investment_report_renders TO service_role;
