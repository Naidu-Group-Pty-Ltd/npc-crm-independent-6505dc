-- This SECURITY DEFINER lookup is used only by service-role edge functions.
-- Revoke PUBLIC explicitly because PostgreSQL grants function execution to
-- PUBLIC by default, which also makes the RPC callable by anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.get_aml_roles_for_user(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_aml_roles_for_user(uuid) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_aml_roles_for_user(uuid) TO service_role;
