-- Backfill the tri-portal bootstrap grant for application superadmins. The
-- original rollout only selected IDs also present in auth.users, but staff
-- accounts are normally backed by public.custom_users.
INSERT INTO aml.role_assignments (user_id, role, tenant_id, granted_by, granted_at, notes)
SELECT
  user_role.user_id,
  'mlro'::aml.aml_role,
  'default',
  user_role.user_id,
  now(),
  'Bootstrap MLRO grant for tri-portal rollout'
FROM public.user_roles AS user_role
WHERE user_role.role = 'superadmin'
ON CONFLICT (user_id, role, tenant_id) DO NOTHING;
