-- Wave F8: security/compliance support for Docling diagnostics access.

CREATE TABLE IF NOT EXISTS public.pdf_import_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.pdf_import_jobs(id) ON DELETE SET NULL,
  actor_id uuid,
  action text NOT NULL,
  diagnostics_path text,
  file_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pdf_import_audit_log ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.pdf_import_audit_log TO authenticated;
GRANT ALL ON public.pdf_import_audit_log TO service_role;

DROP POLICY IF EXISTS "superadmins read pdf import audit" ON public.pdf_import_audit_log;
CREATE POLICY "superadmins read pdf import audit"
  ON public.pdf_import_audit_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'superadmin'::app_role));

DROP POLICY IF EXISTS "service writes pdf import audit" ON public.pdf_import_audit_log;
CREATE POLICY "service writes pdf import audit"
  ON public.pdf_import_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pdf_import_audit_job_created
  ON public.pdf_import_audit_log(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pdf_import_audit_actor_created
  ON public.pdf_import_audit_log(actor_id, created_at DESC);
