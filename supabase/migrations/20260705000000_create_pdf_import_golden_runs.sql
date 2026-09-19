-- Phase 9C — Golden regression run history + baseline comparison ledger.
--
-- Durable, append-only history of orchestrated golden corpus regression runs.
-- Complements (does NOT replace) template_imports.meta.golden_regression_summary,
-- which remains the compact "latest" summary for fast dashboard display. This
-- table is the long-term regression ledger — one row per persisted golden run —
-- used for trend tracking and baseline comparison (and, in later phases, release
-- gating and monitoring).
--
-- Stores METADATA ONLY — never source PDFs, screenshots, raster images, or
-- generated PDFs. Ownership follows the linked template_imports row.

CREATE TABLE IF NOT EXISTS public.pdf_import_golden_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  run_id text NOT NULL,
  run_batch_id text,

  corpus_id text NOT NULL,
  category text NOT NULL,

  import_id uuid NOT NULL REFERENCES public.template_imports(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.report_templates(id) ON DELETE SET NULL,

  source_filename text,
  engine_version text,

  orchestrator_version text,
  summary_version text,

  import_status text,
  run_status text,
  run_decision text,

  quality_gate_status text NOT NULL,
  operator_decision text NOT NULL,

  import_page_count integer,
  template_page_count integer,

  visual_qa_score numeric,
  visual_qa_manual_review_required boolean,

  repair_status text,
  repair_final_score numeric,
  repair_requires_fallback boolean,
  repair_requires_manual_review boolean,

  ai_reconciliation_status text,
  ai_reconciliation_recommendation text,

  export_parity_status text,
  export_parity_mode text,
  export_vs_source_score numeric,
  editor_vs_source_score numeric,
  export_vs_editor_score numeric,

  warning_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,

  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,

  gate_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  triage_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  golden_regression_summary jsonb NOT NULL DEFAULT '{}'::jsonb,

  baseline_comparison jsonb,

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pdf_import_golden_runs_run_id_not_empty CHECK (length(btrim(run_id)) > 0),
  CONSTRAINT pdf_import_golden_runs_corpus_id_not_empty CHECK (length(btrim(corpus_id)) > 0),
  CONSTRAINT pdf_import_golden_runs_category_not_empty CHECK (length(btrim(category)) > 0),
  CONSTRAINT pdf_import_golden_runs_quality_gate_status_valid
    CHECK (quality_gate_status IN ('pass', 'warning', 'fail', 'blocked', 'not_evaluated')),
  CONSTRAINT pdf_import_golden_runs_operator_decision_valid
    CHECK (operator_decision IN ('accepted', 'accepted_with_warnings', 'rejected', 'needs_rerun', 'not_reviewed')),
  CONSTRAINT pdf_import_golden_runs_warning_count_nonneg CHECK (warning_count >= 0),
  CONSTRAINT pdf_import_golden_runs_failure_count_nonneg CHECK (failure_count >= 0),
  CONSTRAINT pdf_import_golden_runs_visual_qa_score_range
    CHECK (visual_qa_score IS NULL OR (visual_qa_score >= 0 AND visual_qa_score <= 1)),
  CONSTRAINT pdf_import_golden_runs_repair_final_score_range
    CHECK (repair_final_score IS NULL OR (repair_final_score >= 0 AND repair_final_score <= 1)),
  CONSTRAINT pdf_import_golden_runs_export_vs_source_score_range
    CHECK (export_vs_source_score IS NULL OR (export_vs_source_score >= 0 AND export_vs_source_score <= 1)),
  CONSTRAINT pdf_import_golden_runs_editor_vs_source_score_range
    CHECK (editor_vs_source_score IS NULL OR (editor_vs_source_score >= 0 AND editor_vs_source_score <= 1)),
  CONSTRAINT pdf_import_golden_runs_export_vs_editor_score_range
    CHECK (export_vs_editor_score IS NULL OR (export_vs_editor_score >= 0 AND export_vs_editor_score <= 1))
);

-- Reconcile an already-created table (e.g. from an earlier apply) that predates
-- the repair_status column. No-op on a freshly created table.
ALTER TABLE public.pdf_import_golden_runs ADD COLUMN IF NOT EXISTS repair_status text;

COMMENT ON TABLE public.pdf_import_golden_runs IS
  'Historical golden corpus regression runs for PDF import quality framework. Stores metadata only, never source PDFs or raster artifacts.';

-- Indexes for the history / baseline read paths.
CREATE INDEX IF NOT EXISTS idx_pdf_import_golden_runs_import_id
  ON public.pdf_import_golden_runs (import_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_golden_runs_template_id
  ON public.pdf_import_golden_runs (template_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_golden_runs_corpus_id_created_at
  ON public.pdf_import_golden_runs (corpus_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdf_import_golden_runs_quality_gate_status
  ON public.pdf_import_golden_runs (quality_gate_status);
CREATE INDEX IF NOT EXISTS idx_pdf_import_golden_runs_operator_decision
  ON public.pdf_import_golden_runs (operator_decision);
CREATE INDEX IF NOT EXISTS idx_pdf_import_golden_runs_run_batch_id
  ON public.pdf_import_golden_runs (run_batch_id);
CREATE INDEX IF NOT EXISTS idx_pdf_import_golden_runs_created_at
  ON public.pdf_import_golden_runs (created_at DESC);

-- Keep updated_at fresh via the shared repo trigger helper.
DROP TRIGGER IF EXISTS trg_pdf_import_golden_runs_updated_at ON public.pdf_import_golden_runs;
CREATE TRIGGER trg_pdf_import_golden_runs_updated_at
  BEFORE UPDATE ON public.pdf_import_golden_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Row level security: reads follow ownership of the linked import (owner or
-- admin, mirroring template_imports). Writes are service-role only — the secure
-- template-import-pdf edge function performs ownership-checked inserts (the
-- browser client is anonymous under this app's custom-auth flow).
ALTER TABLE public.pdf_import_golden_runs ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.pdf_import_golden_runs TO authenticated;
GRANT ALL ON public.pdf_import_golden_runs TO service_role;

DROP POLICY IF EXISTS "service role manages golden runs" ON public.pdf_import_golden_runs;
DROP POLICY IF EXISTS "Service role manages golden runs" ON public.pdf_import_golden_runs;
CREATE POLICY "Service role manages golden runs"
  ON public.pdf_import_golden_runs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "users read golden runs for their imports" ON public.pdf_import_golden_runs;
DROP POLICY IF EXISTS "Users can view golden runs for their imports" ON public.pdf_import_golden_runs;
CREATE POLICY "Users can view golden runs for their imports"
  ON public.pdf_import_golden_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.template_imports ti
      WHERE ti.id = pdf_import_golden_runs.import_id
        AND (ti.user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );
