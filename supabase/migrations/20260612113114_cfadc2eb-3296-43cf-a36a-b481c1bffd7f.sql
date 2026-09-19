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
BEGIN
  INSERT INTO public.report_templates (name, description, config, schema, version, is_active, is_default)
  VALUES (COALESCE(p_name, 'Imported template'), p_description, '{}'::jsonb, p_schema, 1, false, false)
  RETURNING report_templates.id, report_templates.name, report_templates.version
  INTO id, name, version;

  INSERT INTO public.report_template_versions (template_id, version, schema, note)
  VALUES (id, version, p_schema, 'Imported from PDF')
  ON CONFLICT (template_id, version) DO NOTHING;

  IF p_import_id IS NOT NULL THEN
    UPDATE public.template_imports
    SET status = 'completed',
        created_template_id = id,
        page_count = p_page_count,
        meta = COALESCE(p_meta, '{}'::jsonb)
    WHERE template_imports.id = p_import_id;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.template_finalize_v2(uuid, text, text, jsonb, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.template_finalize_v2(uuid, text, text, jsonb, integer, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.template_resync_v2(
  p_template_id uuid,
  p_schema jsonb,
  p_note text DEFAULT 'Re-synced from PDF'
)
RETURNS TABLE(id uuid, name text, version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '300s'
AS $$
DECLARE
  v_existing_version integer;
  v_existing_schema jsonb;
  v_next_version integer;
BEGIN
  SELECT report_templates.version, report_templates.schema
  INTO v_existing_version, v_existing_schema
  FROM public.report_templates
  WHERE report_templates.id = p_template_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template % not found', p_template_id USING ERRCODE = 'P0002';
  END IF;

  v_next_version := COALESCE(v_existing_version, 1) + 1;

  INSERT INTO public.report_template_versions (template_id, version, schema, note)
  VALUES (p_template_id, COALESCE(v_existing_version, 1), v_existing_schema, 'Pre-resync snapshot')
  ON CONFLICT (template_id, version) DO NOTHING;

  UPDATE public.report_templates
  SET schema = p_schema,
      version = v_next_version,
      updated_at = now()
  WHERE report_templates.id = p_template_id
  RETURNING report_templates.id, report_templates.name, report_templates.version
  INTO id, name, version;

  INSERT INTO public.report_template_versions (template_id, version, schema, note)
  VALUES (p_template_id, v_next_version, p_schema, p_note)
  ON CONFLICT (template_id, version) DO NOTHING;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.template_resync_v2(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.template_resync_v2(uuid, jsonb, text) TO service_role;