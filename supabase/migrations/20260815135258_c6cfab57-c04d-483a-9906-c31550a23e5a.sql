DO $$
DECLARE
  v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM aml.case_events e
  WHERE e.actor_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.custom_users u WHERE u.id = e.actor_id
    );

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      'aml.case_events has % row(s) whose actor ids are not in public.custom_users; resolve them before retargeting the actor foreign key',
      v_orphans;
  END IF;
END $$;

ALTER TABLE aml.case_events
  DROP CONSTRAINT IF EXISTS case_events_actor_id_fkey;

ALTER TABLE aml.case_events
  ADD CONSTRAINT case_events_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES public.custom_users(id);

CREATE OR REPLACE FUNCTION public.aml_activate_client_open_case(
  p_client_id uuid,
  p_case jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, aml, extensions
AS $$
DECLARE
  v_is_active boolean;
  v_was_inactive boolean;
  v_case aml.cases%ROWTYPE;
  v_event aml.case_events%ROWTYPE;
  v_event_input jsonb;
  v_event_created_at timestamptz;
  v_event_canonical text;
BEGIN
  SELECT is_active INTO v_is_active
  FROM public.clients
  WHERE id = p_client_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0002';
  END IF;

  v_was_inactive := (v_is_active IS DISTINCT FROM true);

  IF v_was_inactive THEN
    UPDATE public.clients
    SET is_active = true
    WHERE id = p_client_id;
  END IF;

  INSERT INTO aml.cases (
    case_reference,
    subject_display_name,
    subject_type,
    client_id,
    purchase_file_id,
    risk_rating,
    assigned_analyst_id,
    created_by,
    metadata,
    case_stage,
    client_portal_status,
    finance_portal_status,
    service_gate_status,
    activation_timing,
    agreement_state,
    activation_policy_version,
    legacy_activation_model
  ) VALUES (
    p_case->>'case_reference',
    p_case->>'subject_display_name',
    COALESCE(p_case->>'subject_type', 'individual'),
    p_client_id,
    NULLIF(p_case->>'purchase_file_id', '')::uuid,
    NULL,
    NULLIF(p_case->>'assigned_analyst_id', '')::uuid,
    NULLIF(p_case->>'created_by', '')::uuid,
    COALESCE(p_case->'metadata', '{}'::jsonb),
    p_case->>'case_stage',
    p_case->>'client_portal_status',
    p_case->>'finance_portal_status',
    p_case->>'service_gate_status',
    p_case->>'activation_timing',
    p_case->>'agreement_state',
    p_case->>'activation_policy_version',
    p_case->>'legacy_activation_model'
  )
  RETURNING * INTO v_case;

  v_event_input := p_case->'activation_audit_event';
  IF v_event_input IS NULL OR jsonb_typeof(v_event_input) <> 'object' THEN
    RAISE EXCEPTION 'activation_audit_event is required' USING ERRCODE = '22023';
  END IF;

  v_event_created_at := now();
  v_event_canonical := jsonb_build_object(
    'case_id', v_case.id,
    'category', COALESCE(v_event_input->>'category', 'case_created'),
    'summary', v_event_input->>'summary',
    'payload', COALESCE(v_event_input->'payload', '{}'::jsonb),
    'actor_id', NULLIF(v_event_input->>'actor_id', '')::uuid,
    'actor_label', NULLIF(v_event_input->>'actor_label', ''),
    'prev_hash', NULL,
    'created_at', v_event_created_at
  )::text;

  INSERT INTO aml.case_events (
    case_id,
    category,
    summary,
    payload,
    actor_id,
    actor_label,
    prev_hash,
    row_hash,
    created_at
  ) VALUES (
    v_case.id,
    COALESCE(v_event_input->>'category', 'case_created')::aml.event_category,
    v_event_input->>'summary',
    COALESCE(v_event_input->'payload', '{}'::jsonb),
    NULLIF(v_event_input->>'actor_id', '')::uuid,
    NULLIF(v_event_input->>'actor_label', ''),
    NULL,
    encode(extensions.digest(v_event_canonical::bytea, 'sha256'), 'hex'),
    v_event_created_at
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'case', to_jsonb(v_case),
    'activation_event', to_jsonb(v_event),
    'client_was_inactive', v_was_inactive,
    'client_marked_active', v_was_inactive
  );
END;
$$;

REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) TO service_role;