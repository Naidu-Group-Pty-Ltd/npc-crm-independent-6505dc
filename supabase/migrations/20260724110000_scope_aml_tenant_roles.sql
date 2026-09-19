-- Security: bind AML commercialisation roles and tenant-scoped configuration to a tenant.
-- Existing AML assignments remain valid for the legacy/default tenant.
ALTER TABLE aml.role_assignments
  ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'default';

ALTER TABLE aml.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_tenant_id_fkey;
ALTER TABLE aml.role_assignments
  ADD CONSTRAINT role_assignments_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES aml.tenant_settings(tenant_id) ON DELETE CASCADE;

ALTER TABLE aml.role_assignments
  DROP CONSTRAINT IF EXISTS role_assignments_user_id_role_key;
ALTER TABLE aml.role_assignments
  ADD CONSTRAINT role_assignments_user_id_role_tenant_id_key UNIQUE (user_id, role, tenant_id);

CREATE INDEX IF NOT EXISTS role_assignments_active_tenant_idx
  ON aml.role_assignments (user_id, tenant_id)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION aml.is_superadmin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, aml AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = 'superadmin'
  );
$$;

CREATE OR REPLACE FUNCTION aml.has_tenant_aml_role(_user_id uuid, _tenant_id text, _role text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, aml AS $$
  SELECT aml.is_superadmin(_user_id) OR EXISTS (
    SELECT 1 FROM aml.role_assignments
    WHERE user_id = _user_id
      AND tenant_id = _tenant_id
      AND role::text = _role
      AND revoked_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION aml.has_any_tenant_aml_role(_user_id uuid, _tenant_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, aml AS $$
  SELECT aml.is_superadmin(_user_id) OR EXISTS (
    SELECT 1 FROM aml.role_assignments
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND revoked_at IS NULL
  );
$$;

GRANT EXECUTE ON FUNCTION aml.is_superadmin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION aml.has_tenant_aml_role(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION aml.has_any_tenant_aml_role(uuid, text) TO authenticated;

-- Tenant role assignments are provisioned by the control plane/service role.
-- A tenant MLRO must not be able to grant themselves access to another tenant.
DROP POLICY IF EXISTS "MLRO manages AML role assignments" ON aml.role_assignments;
CREATE POLICY "Superadmins manage AML role assignments"
  ON aml.role_assignments FOR ALL TO authenticated
  USING (aml.is_superadmin(auth.uid()))
  WITH CHECK (aml.is_superadmin(auth.uid()));

DROP POLICY IF EXISTS tenant_settings_read ON aml.tenant_settings;
DROP POLICY IF EXISTS tenant_settings_mlro_write ON aml.tenant_settings;
CREATE POLICY tenant_settings_read ON aml.tenant_settings FOR SELECT TO authenticated
  USING (aml.has_any_tenant_aml_role(auth.uid(), tenant_id));
CREATE POLICY tenant_settings_mlro_write ON aml.tenant_settings FOR ALL TO authenticated
  USING (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'))
  WITH CHECK (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'));

DROP POLICY IF EXISTS tenant_ent_read ON aml.tenant_entitlement_overrides;
DROP POLICY IF EXISTS tenant_ent_mlro_write ON aml.tenant_entitlement_overrides;
CREATE POLICY tenant_ent_read ON aml.tenant_entitlement_overrides FOR SELECT TO authenticated
  USING (aml.has_any_tenant_aml_role(auth.uid(), tenant_id));
CREATE POLICY tenant_ent_mlro_write ON aml.tenant_entitlement_overrides FOR ALL TO authenticated
  USING (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'))
  WITH CHECK (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'));

DROP POLICY IF EXISTS provider_configs_read ON aml.provider_configs;
DROP POLICY IF EXISTS provider_configs_mlro_write ON aml.provider_configs;
CREATE POLICY provider_configs_read ON aml.provider_configs FOR SELECT TO authenticated
  USING (aml.has_any_tenant_aml_role(auth.uid(), tenant_id));
CREATE POLICY provider_configs_mlro_write ON aml.provider_configs FOR ALL TO authenticated
  USING (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'))
  WITH CHECK (aml.has_tenant_aml_role(auth.uid(), tenant_id, 'mlro'));

DROP POLICY IF EXISTS provider_metrics_read ON aml.provider_metrics_daily;
CREATE POLICY provider_metrics_read ON aml.provider_metrics_daily FOR SELECT TO authenticated
  USING (aml.has_any_tenant_aml_role(auth.uid(), tenant_id));

-- Preserve the existing user-management RPC contract for the legacy/default tenant.
CREATE OR REPLACE FUNCTION public.admin_set_aml_roles_for_user(
  _target_user_id uuid,
  _roles text[],
  _granted_by uuid
)
RETURNS TABLE(role_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, aml
AS $$
DECLARE
  _role text;
  _valid_roles text[] := ARRAY['analyst','reviewer','mlro','auditor'];
BEGIN
  IF _target_user_id IS NULL THEN RAISE EXCEPTION 'Target user id is required'; END IF;
  _roles := COALESCE(_roles, ARRAY[]::text[]);
  FOREACH _role IN ARRAY _roles LOOP
    IF NOT (_role = ANY(_valid_roles)) THEN RAISE EXCEPTION 'Invalid AML role: %', _role; END IF;
  END LOOP;

  UPDATE aml.role_assignments
  SET revoked_at = now(), updated_at = now()
  WHERE user_id = _target_user_id AND tenant_id = 'default' AND revoked_at IS NULL
    AND NOT (role::text = ANY(_roles));

  FOREACH _role IN ARRAY _roles LOOP
    INSERT INTO aml.role_assignments (user_id, role, tenant_id, granted_by, granted_at, revoked_at, notes)
    VALUES (_target_user_id, _role::aml.aml_role, 'default', _granted_by, now(), NULL, 'Granted from User Management')
    ON CONFLICT (user_id, role, tenant_id) DO UPDATE SET
      revoked_at = NULL, granted_by = EXCLUDED.granted_by, granted_at = now(), updated_at = now(),
      notes = 'Granted from User Management';
  END LOOP;

  RETURN QUERY SELECT ra.role::text FROM aml.role_assignments ra
    WHERE ra.user_id = _target_user_id AND ra.tenant_id = 'default' AND ra.revoked_at IS NULL
    ORDER BY ra.role::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_aml_roles_for_user(uuid, text[], uuid) TO service_role;
