-- The Market Intelligence export's render path.
--
-- One table: a record of what was produced, from which report, under whose
-- brand, and how much of the report's prose it actually carried.
--
-- The report is deliberately **not** copied here. It is already one jsonb column
-- on one row of `marketing_intelligence_reports`, and this document is a
-- rendering of it, so a snapshot in the ledger would be a second answer to "what
-- did the report say" — the failure mode this programme removes rather than
-- adds. The same reasoning `20260815000000_cash_flow_render_path.sql` gives for
-- the projection and `20260820000000_report_qa_render_path.sql` for the
-- conversation.

CREATE TABLE IF NOT EXISTS public.market_intelligence_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: the document is *of* the report, so a deleted report has no render
  -- worth keeping.
  report_id uuid NOT NULL
    REFERENCES public.marketing_intelligence_reports(id) ON DELETE CASCADE,

  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),

  -- Copied from the row rather than joined, because they are what the document
  -- was *rendered as*. A report's `audience_segment` can be edited after the
  -- fact; the PDF somebody already has cannot.
  report_type text NOT NULL DEFAULT '',
  audience_segment text NOT NULL DEFAULT '',

  -- What was produced.
  file_name text NOT NULL DEFAULT '',
  -- The private bucket the DDL created alongside the reports table in April and
  -- that `dispatch-marketing-reports` already reads from. It has held zero
  -- objects since the day it was made; this is the path that starts filling it.
  storage_bucket text NOT NULL DEFAULT 'marketing-reports',
  storage_path text,
  bytes integer,
  page_count integer,

  -- Whether `marketing_intelligence_reports.pdf_storage_path` was set.
  --
  -- Worth its own column rather than inferring it from `storage_path`, because
  -- the two can legitimately disagree: the file is always written, and the
  -- column update is allowed to fail without failing the render. When the
  -- scheduled marketing email attaches nothing, "was the path ever written for
  -- this report" is the first question, and this answers it.
  persisted boolean NOT NULL DEFAULT false,

  -- How much of the report the document carried.
  --
  -- Three numbers answering three different questions. `layers_shown` and
  -- `layers_empty` are the format's defining defect made countable: the edge
  -- function runs five of the eight layers in parallel with a `.catch` that
  -- returns empty, and 6 of the record's 46 layer bodies are empty strings. The
  -- legacy generator lists those in its table of contents and then prints
  -- nothing for them. `sections_dropped` and `chars_omitted` are what the
  -- document budget and the per-section cap did not carry — one layer in the
  -- record is 244,332 characters, twenty times the average.
  layers_shown integer NOT NULL DEFAULT 0,
  layers_empty integer NOT NULL DEFAULT 0,
  sections_dropped integer NOT NULL DEFAULT 0,
  chars_omitted integer NOT NULL DEFAULT 0,

  -- Which sections the document turned out to have.
  --
  -- Declared from a fixed vocabulary of fifteen, but which of them appear
  -- depends on what the payload holds, so this is how anyone checks what a given
  -- file actually contained without re-rendering it.
  sections_included text[] NOT NULL DEFAULT '{}',

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

COMMENT ON TABLE public.market_intelligence_renders IS
  'One row per Market Intelligence render: what was produced, from which report, how many layers had content, what the caps did not carry, whether pdf_storage_path was set, and under which brand snapshot. Written by render-market-intelligence-pdf. The report payload is not copied here — see the migration header for why.';

CREATE INDEX IF NOT EXISTS market_intelligence_renders_report_idx
  ON public.market_intelligence_renders (report_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_intelligence_renders_brand_idx
  ON public.market_intelligence_renders (brand_snapshot_id)
  WHERE brand_snapshot_id IS NOT NULL;
-- Support queries start from "which renders failed today".
CREATE INDEX IF NOT EXISTS market_intelligence_renders_failed_idx
  ON public.market_intelligence_renders (created_at DESC)
  WHERE status = 'failed';
-- "How often are we sending a report with a layer missing?" — the question the
-- parallel `.catch` creates, and it should be one query rather than a scan.
CREATE INDEX IF NOT EXISTS market_intelligence_renders_gaps_idx
  ON public.market_intelligence_renders (created_at DESC)
  WHERE layers_empty > 0;
-- "Which reports have a PDF the email dispatch can actually attach?"
CREATE INDEX IF NOT EXISTS market_intelligence_renders_persisted_idx
  ON public.market_intelligence_renders (report_id, created_at DESC)
  WHERE persisted;

-- ── Access ──────────────────────────────────────────────────────────────────
--
-- A render row points at a file of market commentary that goes out under a
-- tenant's brand, sometimes as an attachment on a scheduled marketing email.
-- The route that writes it gates on the `marketing_analytics / can_view` module
-- permission; the read policy below is the narrowest rule available, because a
-- row here is evidence and superadmins are who audit it.

ALTER TABLE public.market_intelligence_renders ENABLE ROW LEVEL SECURITY;

CREATE POLICY market_intelligence_renders_select
  ON public.market_intelligence_renders
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'));

REVOKE ALL ON public.market_intelligence_renders FROM anon, authenticated;
GRANT SELECT ON public.market_intelligence_renders TO authenticated;
GRANT ALL ON public.market_intelligence_renders TO service_role;
