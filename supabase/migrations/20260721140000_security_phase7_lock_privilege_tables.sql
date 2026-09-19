-- Applied to production 2026-07-21 via MCP (security_phase7_lock_privilege_tables).
--
-- CRITICAL (F-07): anon + authenticated held full INSERT/UPDATE/DELETE grants
-- on the role/permission tables, combined with {public} qual=true RLS policies.
-- A request carrying only the publishable anon key could insert
-- role='superadmin' for any user id — unauthenticated privilege escalation.
-- Verified live before the fix: an anon INSERT reached the foreign-key check
-- (23503), i.e. grants + RLS permitted the write. After the fix it returns
-- 42501 permission denied.
--
-- Writes to these tables happen ONLY through service-role edge functions
-- (admin-user-management); the frontend never accesses them directly, so
-- revoking anon/authenticated grants has no application impact. service_role
-- retains all grants and its dedicated *_service_role_* policies.

-- 1) Revoke write grants (and anon read on the sensitive role/permission tables)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_roles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_permissions FROM anon, authenticated;
REVOKE ALL ON public.permission_invite_tokens FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.dashboard_modules FROM anon, authenticated;
REVOKE SELECT ON public.user_roles FROM anon;
REVOKE SELECT ON public.user_permissions FROM anon;

-- 2) Drop the mis-scoped {public} qual=true policies (service_role_* policies remain)
DROP POLICY IF EXISTS "Service role can manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Service role can manage user permissions" ON public.user_permissions;
DROP POLICY IF EXISTS "Service role can manage invite tokens" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "Service role can manage dashboard modules" ON public.dashboard_modules;

-- 3) Scope authenticated SELECT to own rows (was "Anyone can view")
DROP POLICY IF EXISTS "Anyone can view user roles" ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Anyone can view user permissions" ON public.user_permissions;
CREATE POLICY user_permissions_select_own ON public.user_permissions FOR SELECT TO authenticated USING (user_id = auth.uid());
