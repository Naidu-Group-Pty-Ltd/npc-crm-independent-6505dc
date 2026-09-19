-- Register the `integrations` module in dashboard_modules.
--
-- `requireModulePermission` (supabase/functions/_shared/authz.ts) is
-- deny-by-default: a module_key with no active row in dashboard_modules cannot
-- be authorised at all, and returns `module_not_registered` rather than falling
-- through to the user's permission row.
--
--   if (!moduleData) return { ok: false, reason_code: 'module_not_registered' };
--
-- Superadmins return earlier and never reach that check, which is why nothing
-- has failed: every user carrying a role today is a superadmin. The moment a
-- non-superadmin is granted access, both the Integrations page and every
-- workflow read/write through the manage-templates broker (which maps
-- `workflows`, `workflow_runs` and `workflow_run_steps` onto this module) would
-- 403 — with a message about authorisation, for what is actually a missing
-- registration row.
--
-- Registering the module makes the deny-by-default gate reachable as intended:
-- access still requires an explicit user_permissions row, which is granted from
-- User Management like every other module.

BEGIN;

INSERT INTO public.dashboard_modules (module_key, module_name, description, category, icon, route, is_active, sort_order)
VALUES (
  'integrations',
  'Integrations',
  'Third-party API credentials and the Workflow Playground automation canvas.',
  'administration',
  'Plug',
  '/integrations',
  true,
  -- Sits with the other administration modules; the sidebar orders itself from
  -- its own list, so this only affects permission-management screens.
  (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.dashboard_modules WHERE category = 'administration')
)
ON CONFLICT (module_key) DO NOTHING;

COMMIT;
