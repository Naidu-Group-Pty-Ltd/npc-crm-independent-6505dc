INSERT INTO aml.role_assignments (user_id, role, notes)
SELECT ur.user_id, 'mlro'::aml.aml_role, 'Bootstrap MLRO grant for tri-portal rollout'
FROM public.user_roles ur
WHERE ur.role = 'superadmin'
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id)
ON CONFLICT (user_id, role) DO UPDATE
  SET revoked_at = NULL;

INSERT INTO public.feature_flags (key, value, description)
VALUES ('aml_ctf', jsonb_build_object('enabled', true), 'AML/CTF tri-portal module')
ON CONFLICT (key) DO UPDATE SET value = jsonb_build_object('enabled', true);
