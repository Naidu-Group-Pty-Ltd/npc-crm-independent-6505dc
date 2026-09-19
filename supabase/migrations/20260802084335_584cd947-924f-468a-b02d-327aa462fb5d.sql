ALTER TABLE public.borrowing_capacity_assessments
  ADD COLUMN IF NOT EXISTS audit_trail jsonb,
  ADD COLUMN IF NOT EXISTS explanation jsonb;

COMMENT ON COLUMN public.borrowing_capacity_assessments.audit_trail IS
  'AuditTrailData from calculate-borrowing-capacity: every value the lender adjusted, what it started as, and the rule that moved it. Read by the report renderer; see supabase/functions/_shared/reports/borrowingCapacity/audit.pure.ts for the unit and polarity of each entry.';
COMMENT ON COLUMN public.borrowing_capacity_assessments.explanation IS
  'ExplanationReport from calculate-borrowing-capacity: the assessment step by step, in plain terms.';

CREATE TABLE IF NOT EXISTS public.borrowing_capacity_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid REFERENCES public.borrowing_capacity_assessments(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  file_name text NOT NULL DEFAULT '',
  storage_bucket text NOT NULL DEFAULT 'client-files',
  storage_path text,
  bytes integer,
  brand_snapshot_id uuid REFERENCES public.report_brand_snapshots(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS borrowing_capacity_renders_failed_idx
  ON public.borrowing_capacity_renders (created_at DESC)
  WHERE status = 'failed';

ALTER TABLE public.borrowing_capacity_renders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS borrowing_capacity_renders_select ON public.borrowing_capacity_renders;
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