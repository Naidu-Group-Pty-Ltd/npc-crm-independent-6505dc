-- Security: tenant-scoped AML roles are effective only for active identities.
CREATE OR REPLACE FUNCTION aml.has_tenant_aml_role(
  _user_id uuid,
  _tenant_id text,
  _role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = aml, public
AS $$
  SELECT public.is_active_aml_role_identity(_user_id)
    AND (
      aml.is_superadmin(_user_id)
      OR EXISTS (
        SELECT 1
        FROM aml.role_assignments ra
        WHERE ra.user_id = _user_id
          AND ra.tenant_id = _tenant_id
          AND ra.role::text = _role
          AND ra.revoked_at IS NULL
      )
    );
$$;

CREATE OR REPLACE FUNCTION aml.has_any_tenant_aml_role(
  _user_id uuid,
  _tenant_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = aml, public
AS $$
  SELECT public.is_active_aml_role_identity(_user_id)
    AND (
      aml.is_superadmin(_user_id)
      OR EXISTS (
        SELECT 1
        FROM aml.role_assignments ra
        WHERE ra.user_id = _user_id
          AND ra.tenant_id = _tenant_id
          AND ra.revoked_at IS NULL
      )
    );
$$;
