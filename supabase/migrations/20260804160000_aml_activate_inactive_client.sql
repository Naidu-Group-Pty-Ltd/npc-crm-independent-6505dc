-- AML/CTF activation pathway — inactive-client activation (single transaction).
--
-- The "Activate client for AML/CTF" form is the place an authorised user
-- confirms that an existing client is active and starts compliance. When the
-- selected client is still marked inactive, marking the client active and
-- opening the linked AML case must succeed or fail together: a client must
-- never be left active with no case because case creation failed, and a case
-- must never exist for a client the flip could not reach.
--
-- This function is called exclusively by the `aml-cases` edge function
-- (service role) AFTER it has verified:
--   * the caller holds an AML analyst/MLRO role,
--   * the activation event, reason and human confirmation are present,
--   * Model B legal-approval guardrails where applicable.
-- It is not a client-facing RPC — execute is revoked from anon/authenticated.
--
-- The partial unique index aml_cases_one_open_per_client still guards the
-- duplicate-open race: a 23505 raised by the INSERT aborts the whole
-- transaction, so the client's is_active flip rolls back with it.

CREATE OR REPLACE FUNCTION public.aml_activate_client_open_case(
  p_client_id uuid,
  p_case jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, aml
AS $$
DECLARE
  v_is_active boolean;
  v_was_inactive boolean;
  v_case aml.cases%ROWTYPE;
BEGIN
  -- Lock the client row so concurrent activations serialise here.
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

  RETURN jsonb_build_object(
    'case', to_jsonb(v_case),
    'client_was_inactive', v_was_inactive,
    'client_marked_active', v_was_inactive
  );
END;
$$;

-- Service-role only: the edge function performs all authorization first.
REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.aml_activate_client_open_case(uuid, jsonb) TO service_role;
