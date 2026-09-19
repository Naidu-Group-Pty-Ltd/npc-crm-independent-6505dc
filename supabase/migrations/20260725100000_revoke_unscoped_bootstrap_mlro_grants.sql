-- Revoke the erroneous MLRO grants made to non-superadmins by the tri-portal
-- bootstrap migration. Legitimate AML staff retain their explicitly managed roles.
UPDATE aml.role_assignments AS assignment
SET
  revoked_at = now(),
  notes = CONCAT_WS(' — ', assignment.notes, 'Revoked: bootstrap grant limited to superadmins')
WHERE assignment.role = 'mlro'::aml.aml_role
  AND assignment.revoked_at IS NULL
  AND assignment.notes = 'Bootstrap MLRO grant for tri-portal rollout'
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles AS user_role
    WHERE user_role.user_id = assignment.user_id
      AND user_role.role = 'superadmin'
  );
