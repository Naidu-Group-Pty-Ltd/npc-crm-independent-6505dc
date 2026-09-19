CREATE OR REPLACE FUNCTION public.template_finalize(
  p_import_id uuid,
  p_name text,
  p_description text,
  p_schema jsonb,
  p_page_count integer DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS public.report_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_tpl public.report_templates%ROWTYPE;
BEGIN
  INSERT INTO public.report_templates (name, description, config, schema, version, is_active, is_default)
  VALUES (COALESCE(p_name, 'Imported template'), p_description, '{}'::jsonb, p_schema, 1, false, false)
  RETURNING * INTO v_tpl;

  INSERT INTO public.report_template_versions (template_id, version, schema, note)
  VALUES (v_tpl.id, 1, p_schema, 'Imported from PDF')
  ON CONFLICT (template_id, version) DO NOTHING;

  IF p_import_id IS NOT NULL THEN
    UPDATE public.template_imports
    SET status = 'completed',
        created_template_id = v_tpl.id,
        page_count = p_page_count,
        meta = COALESCE(p_meta, '{}'::jsonb)
    WHERE id = p_import_id;
  END IF;

  RETURN v_tpl;
END;
$$;

REVOKE ALL ON FUNCTION public.template_finalize(uuid, text, text, jsonb, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.template_finalize(uuid, text, text, jsonb, integer, jsonb) TO service_role;