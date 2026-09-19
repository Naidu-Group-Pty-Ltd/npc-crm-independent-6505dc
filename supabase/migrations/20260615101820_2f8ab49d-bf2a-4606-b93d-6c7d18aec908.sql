ALTER TABLE public.pdf_import_jobs
  ADD COLUMN IF NOT EXISTS bytes_in BIGINT,
  ADD COLUMN IF NOT EXISTS bytes_out BIGINT,
  ADD COLUMN IF NOT EXISTS attempts JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.append_pdf_import_attempt(p_job_id uuid, p_attempt jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pdf_import_jobs
     SET attempts = COALESCE(attempts, '[]'::jsonb) || jsonb_build_array(p_attempt),
         updated_at = now()
   WHERE id = p_job_id;
$$;

GRANT EXECUTE ON FUNCTION public.append_pdf_import_attempt(uuid, jsonb) TO service_role, authenticated;