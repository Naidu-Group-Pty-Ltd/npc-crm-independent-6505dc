-- Run history is written by the browser, which holds an authenticated JWT, not
-- the service role.
--
-- `workflow_runs` and `workflow_run_steps` were created with SELECT-only admin
-- policies because every write was expected to arrive through the
-- manage-templates broker under service_role. That routing has been removed —
-- it made the feature depend on a shared Edge Function being redeployed before
-- a new table could be used at all — so the client now writes directly and
-- needs the matching INSERT policies.
--
-- Same admin test as the SELECT policies here and as every policy on
-- `workflows`, so the access rule is unchanged; only who evaluates it moved
-- from the broker to Postgres.

BEGIN;

DROP POLICY IF EXISTS "Admins can record workflow runs" ON public.workflow_runs;
CREATE POLICY "Admins can record workflow runs" ON public.workflow_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

DROP POLICY IF EXISTS "Admins can record workflow run steps" ON public.workflow_run_steps;
CREATE POLICY "Admins can record workflow run steps" ON public.workflow_run_steps
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['superadmin'::public.app_role, 'admin'::public.app_role])
    )
  );

COMMIT;
