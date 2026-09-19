
-- Branching + approval columns on report_templates
ALTER TABLE public.report_templates
  ADD COLUMN IF NOT EXISTS parent_template_id uuid REFERENCES public.report_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_label text,
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS locked_for_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid;

CREATE INDEX IF NOT EXISTS idx_report_templates_parent ON public.report_templates(parent_template_id);

-- Approval requests
CREATE TABLE IF NOT EXISTS public.template_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.report_templates(id) ON DELETE CASCADE,
  version integer,
  requested_by uuid,
  requested_by_name text,
  reviewer_id uuid,
  reviewer_name text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | changes_requested | cancelled
  note text,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_approvals TO authenticated;
GRANT ALL ON public.template_approvals TO service_role;

ALTER TABLE public.template_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read approvals"
  ON public.template_approvals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert approvals"
  ON public.template_approvals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update approvals"
  ON public.template_approvals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_template_approvals_template ON public.template_approvals(template_id, created_at DESC);

-- Audit trail
CREATE TABLE IF NOT EXISTS public.template_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.report_templates(id) ON DELETE CASCADE,
  actor_id uuid,
  actor_name text,
  action text NOT NULL, -- e.g. schema_saved, version_created, branch_created, approval_requested, approved, locked, exported
  summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.template_audit_log TO authenticated;
GRANT ALL ON public.template_audit_log TO service_role;

ALTER TABLE public.template_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read audit"
  ON public.template_audit_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert audit"
  ON public.template_audit_log FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_template_audit_template ON public.template_audit_log(template_id, created_at DESC);
