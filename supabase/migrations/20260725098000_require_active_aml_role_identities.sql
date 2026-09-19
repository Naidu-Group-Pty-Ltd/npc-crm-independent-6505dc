-- AML role grants may be assigned to either native Auth users or custom users.
-- Do not treat a grant as effective once its identity has been deleted or disabled.
CREATE OR REPLACE FUNCTION public.is_active_aml_role_identity(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.custom_users cu
    WHERE cu.id = _user_id
      AND cu.is_active
      AND cu.deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM auth.users au
    WHERE au.id = _user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_aml_role_identity(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.has_aml_role(_user_id uuid, _role aml.aml_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, aml
AS $$
  SELECT public.is_active_aml_role_identity(_user_id)
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
  SELECT public.is_active_aml_role_identity(_user_id)
    AND EXISTS (
      SELECT 1
      FROM aml.role_assignments ra
      WHERE ra.user_id = _user_id
        AND ra.revoked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.has_aml_write_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, aml
AS $$
  SELECT public.is_active_aml_role_identity(_user_id)
    AND EXISTS (
      SELECT 1
      FROM aml.role_assignments ra
      WHERE ra.user_id = _user_id
        AND ra.revoked_at IS NULL
        AND ra.role IN ('analyst', 'reviewer', 'mlro')
    );
$$;

CREATE OR REPLACE FUNCTION aml.has_aml_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = aml, public
AS $$
  SELECT public.is_active_aml_role_identity(_user_id)
    AND EXISTS (
      SELECT 1
      FROM aml.role_assignments ra
      WHERE ra.user_id = _user_id
        AND ra.role::text = _role
        AND ra.revoked_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION aml.has_any_aml_role(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = aml, public
AS $$
  SELECT public.is_active_aml_role_identity(_user_id)
    AND EXISTS (
      SELECT 1
      FROM aml.role_assignments ra
      WHERE ra.user_id = _user_id
        AND ra.revoked_at IS NULL
    );
$$;

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
    AND ra.revoked_at IS NULL
    AND public.is_active_aml_role_identity(_user_id);
$$;

CREATE OR REPLACE FUNCTION public.get_aml_roles_for_users(_user_ids uuid[])
RETURNS TABLE(user_id uuid, role_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, aml
AS $$
  SELECT ra.user_id, ra.role::text
  FROM aml.role_assignments ra
  WHERE ra.revoked_at IS NULL
    AND ra.user_id = ANY(_user_ids)
    AND public.is_active_aml_role_identity(ra.user_id)
  ORDER BY ra.user_id, ra.role::text;
$$;
