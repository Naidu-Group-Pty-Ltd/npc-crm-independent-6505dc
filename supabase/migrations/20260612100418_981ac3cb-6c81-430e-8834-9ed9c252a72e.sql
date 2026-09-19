
CREATE OR REPLACE FUNCTION public.template_resync(
  p_template_id uuid,
  p_schema jsonb,
  p_note text DEFAULT 'Re-synced from PDF'
)
RETURNS public.report_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_existing public.report_templates%ROWTYPE;
  v_next_version integer;
  v_updated public.report_templates%ROWTYPE;
BEGIN
  SELECT * INTO v_existing FROM public.report_templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template % not found', p_template_id USING ERRCODE = 'P0002';
  END IF;

  v_next_version := COALESCE(v_existing.version, 1) + 1;

  -- Snapshot OLD schema (idempotent on (template_id, version))
  INSERT INTO public.report_template_versions (template_id, version, schema, note)
  VALUES (p_template_id, COALESCE(v_existing.version, 1), v_existing.schema, 'Pre-resync snapshot')
  ON CONFLICT (template_id, version) DO NOTHING;

  UPDATE public.report_templates
  SET schema = p_schema,
      version = v_next_version,
      updated_at = now()
  WHERE id = p_template_id
  RETURNING * INTO v_updated;

  -- Snapshot NEW schema (idempotent)
  INSERT INTO public.report_template_versions (template_id, version, schema, note)
  VALUES (p_template_id, v_next_version, p_schema, p_note)
  ON CONFLICT (template_id, version) DO NOTHING;

  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.template_resync(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.template_resync(uuid, jsonb, text) TO service_role;
