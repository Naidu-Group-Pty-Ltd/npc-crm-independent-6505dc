ALTER TABLE public.finance_portal_users
  ADD COLUMN IF NOT EXISTS global_permissions jsonb;

COMMENT ON COLUMN public.finance_portal_users.global_permissions IS
  'Optional baseline permission template applied to every client assigned to this finance partner. Effective permissions = OR-merge(global_permissions, finance_portal_client_assignments.permissions). NULL means no global baseline (legacy behaviour).';