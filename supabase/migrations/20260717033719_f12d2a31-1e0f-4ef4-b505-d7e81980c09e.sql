INSERT INTO public.feature_flags (key, value, description)
VALUES ('aml_ctf', '{"enabled": true}'::jsonb, 'Enables the AML/CTF compliance module')
ON CONFLICT (key) DO UPDATE
  SET value = jsonb_set(COALESCE(public.feature_flags.value, '{}'::jsonb), '{enabled}', 'true'::jsonb);

INSERT INTO aml.role_assignments (user_id, role, granted_by, granted_at)
SELECT ur.user_id, 'mlro'::aml.aml_role, ur.user_id, now()
FROM public.user_roles ur
WHERE ur.role = 'superadmin'
  AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = ur.user_id)
ON CONFLICT (user_id, role) DO UPDATE
  SET revoked_at = NULL;
