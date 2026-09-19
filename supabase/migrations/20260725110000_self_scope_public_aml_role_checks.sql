-- Public AML role predicates are used by authenticated RLS policies, but must
-- not disclose another user's compliance roles through PostgREST. Edge
-- functions use the service role and retain the ability to check their subject.
CREATE OR REPLACE FUNCTION public.has_aml_role(_user_id uuid, _role aml.aml_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, aml
AS $$
  SELECT (_user_id = auth.uid() OR auth.role() = 'service_role')
    AND public.is_active_aml_role_identity(_user_id)
    AND EXISTS (
      SELECT 1
      FROM aml.role_assignments ra
      WHERE ra.user_id = _user_id
        AND ra.role = _role
        AND ra.revoked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.has_any_aml_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, aml
AS $$
  SELECT (_user_id = auth.uid() OR auth.role() = 'service_role')
    AND public.is_active_aml_role_identity(_user_id)
    AND EXISTS (
      SELECT 1
      FROM aml.role_assignments ra
      WHERE ra.user_id = _user_id
        AND ra.revoked_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.has_aml_role(uuid, aml.aml_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_any_aml_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_aml_role(uuid, aml.aml_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_aml_role(uuid) TO authenticated, service_role;
