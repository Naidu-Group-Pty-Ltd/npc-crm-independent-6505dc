
CREATE OR REPLACE FUNCTION public.get_aml_roles_for_user(_user_id uuid)
RETURNS TABLE(role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, aml
AS $$
  SELECT ra.role::text
  FROM aml.role_assignments ra
  WHERE ra.user_id = _user_id
    AND ra.revoked_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_aml_roles_for_user(uuid) TO service_role, authenticated, anon;
