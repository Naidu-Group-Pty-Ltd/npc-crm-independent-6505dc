CREATE OR REPLACE FUNCTION public.admin_set_aml_roles_for_user(
  _target_user_id uuid,
  _roles text[],
  _granted_by uuid
)
RETURNS TABLE(role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, aml
AS $$
DECLARE
  _role text;
  _valid_roles text[] := ARRAY['analyst','reviewer','mlro','auditor'];
BEGIN
  IF _target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user id is required';
  END IF;

  IF _roles IS NULL THEN
    _roles := ARRAY[]::text[];
  END IF;

  FOREACH _role IN ARRAY _roles LOOP
    IF NOT (_role = ANY(_valid_roles)) THEN
      RAISE EXCEPTION 'Invalid AML role: %', _role;
    END IF;
  END LOOP;

  UPDATE aml.role_assignments
  SET revoked_at = now(), updated_at = now(), notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END || 'Revoked from User Management'
  WHERE user_id = _target_user_id
    AND revoked_at IS NULL
    AND NOT (role::text = ANY(_roles));

  FOREACH _role IN ARRAY _roles LOOP
    INSERT INTO aml.role_assignments (user_id, role, granted_by, granted_at, revoked_at, notes)
    VALUES (_target_user_id, _role::aml.aml_role, _granted_by, now(), NULL, 'Granted from User Management')
    ON CONFLICT (user_id, role)
    DO UPDATE SET
      revoked_at = NULL,
      granted_by = EXCLUDED.granted_by,
      granted_at = now(),
      updated_at = now(),
      notes = 'Granted from User Management';
  END LOOP;

  RETURN QUERY
  SELECT ra.role::text
  FROM aml.role_assignments ra
  WHERE ra.user_id = _target_user_id
    AND ra.revoked_at IS NULL
  ORDER BY ra.role::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_aml_roles_for_user(uuid, text[], uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_aml_roles_for_users(_user_ids uuid[])
RETURNS TABLE(user_id uuid, role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, aml
AS $$
  SELECT ra.user_id, ra.role::text
  FROM aml.role_assignments ra
  WHERE ra.revoked_at IS NULL
    AND ra.user_id = ANY(_user_ids)
  ORDER BY ra.user_id, ra.role::text;
$$;

GRANT EXECUTE ON FUNCTION public.get_aml_roles_for_users(uuid[]) TO service_role, authenticated, anon;