-- Preserve the import owner on templates created through the service-role
-- finalization RPC. The Edge Function separately verifies that the caller owns
-- the import and has templates:edit permission before invoking this function.
CREATE OR REPLACE FUNCTION public.template_finalize_v2(
  p_import_id uuid,
  p_name text,
  p_description text,
  p_schema jsonb,
  p_page_count integer DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE(id uuid, name text, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_created_by uuid;
BEGIN
  SELECT template_imports.user_id
  INTO v_created_by
  FROM public.template_imports
  WHERE template_imports.id = p_import_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template import % not found', p_import_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.report_templates (
    name, description, config, schema, version, is_active, is_default, created_by
  )
  VALUES (
    COALESCE(p_name, 'Imported template'), p_description, '{}'::jsonb,
    p_schema, 1, false, false, v_created_by
  )
  RETURNING report_templates.id, report_templates.name, report_templates.version
  INTO id, name, version;

  INSERT INTO public.report_template_versions (template_id, version, schema, note)
  VALUES (id, version, p_schema, 'Imported from PDF')
  ON CONFLICT (template_id, version) DO NOTHING;

  UPDATE public.template_imports
  SET status = 'completed',
      created_template_id = id,
      page_count = p_page_count,
      meta = COALESCE(p_meta, '{}'::jsonb)
  WHERE template_imports.id = p_import_id;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.template_finalize_v2(uuid, text, text, jsonb, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.template_finalize_v2(uuid, text, text, jsonb, integer, jsonb) TO service_role;
