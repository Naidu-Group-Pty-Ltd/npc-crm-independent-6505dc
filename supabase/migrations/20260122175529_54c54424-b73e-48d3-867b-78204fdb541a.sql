-- ================================================
-- SECURITY FIX: Lock down critical tables to service_role only
-- Phase 1: Auth, PII, and Audit tables (with existing policy cleanup)
-- ================================================

-- ========== PASSWORD RESET TOKENS ==========
DROP POLICY IF EXISTS "Allow all to view password_reset_tokens" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "Allow all to create password_reset_tokens" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "Allow all to update password_reset_tokens" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "Allow all to delete password_reset_tokens" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "Service role can manage password_reset_tokens" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "password_reset_tokens_service_role_select" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "password_reset_tokens_service_role_insert" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "password_reset_tokens_service_role_update" ON public.password_reset_tokens;
DROP POLICY IF EXISTS "password_reset_tokens_service_role_delete" ON public.password_reset_tokens;

CREATE POLICY "password_reset_tokens_service_role_select" ON public.password_reset_tokens FOR SELECT TO service_role USING (true);
CREATE POLICY "password_reset_tokens_service_role_insert" ON public.password_reset_tokens FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "password_reset_tokens_service_role_update" ON public.password_reset_tokens FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "password_reset_tokens_service_role_delete" ON public.password_reset_tokens FOR DELETE TO service_role USING (true);

-- ========== PERMISSION INVITE TOKENS ==========
DROP POLICY IF EXISTS "Allow all to view permission_invite_tokens" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "Allow all to create permission_invite_tokens" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "Allow all to update permission_invite_tokens" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "Allow all to delete permission_invite_tokens" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "Service role can manage permission_invite_tokens" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "permission_invite_tokens_service_role_select" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "permission_invite_tokens_service_role_insert" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "permission_invite_tokens_service_role_update" ON public.permission_invite_tokens;
DROP POLICY IF EXISTS "permission_invite_tokens_service_role_delete" ON public.permission_invite_tokens;

CREATE POLICY "permission_invite_tokens_service_role_select" ON public.permission_invite_tokens FOR SELECT TO service_role USING (true);
CREATE POLICY "permission_invite_tokens_service_role_insert" ON public.permission_invite_tokens FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "permission_invite_tokens_service_role_update" ON public.permission_invite_tokens FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "permission_invite_tokens_service_role_delete" ON public.permission_invite_tokens FOR DELETE TO service_role USING (true);

-- ========== USER ROLES ==========
DROP POLICY IF EXISTS "Allow all to view user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow all to create user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow all to update user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Allow all to delete user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "Service role can manage user_roles" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_select" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_insert" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_service_role_delete" ON public.user_roles;

CREATE POLICY "user_roles_service_role_select" ON public.user_roles FOR SELECT TO service_role USING (true);
CREATE POLICY "user_roles_service_role_insert" ON public.user_roles FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "user_roles_service_role_update" ON public.user_roles FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "user_roles_service_role_delete" ON public.user_roles FOR DELETE TO service_role USING (true);

-- ========== USER PERMISSIONS ==========
DROP POLICY IF EXISTS "Allow all to view user_permissions" ON public.user_permissions;
DROP POLICY IF EXISTS "Allow all to create user_permissions" ON public.user_permissions;
DROP POLICY IF EXISTS "Allow all to update user_permissions" ON public.user_permissions;
DROP POLICY IF EXISTS "Allow all to delete user_permissions" ON public.user_permissions;
DROP POLICY IF EXISTS "Service role can manage user_permissions" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_select" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_insert" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_update" ON public.user_permissions;
DROP POLICY IF EXISTS "user_permissions_service_role_delete" ON public.user_permissions;

CREATE POLICY "user_permissions_service_role_select" ON public.user_permissions FOR SELECT TO service_role USING (true);
CREATE POLICY "user_permissions_service_role_insert" ON public.user_permissions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "user_permissions_service_role_update" ON public.user_permissions FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "user_permissions_service_role_delete" ON public.user_permissions FOR DELETE TO service_role USING (true);

-- ========== USER SESSIONS ==========
DROP POLICY IF EXISTS "Allow all to view user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Allow all to create user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Allow all to update user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Allow all to delete user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Service role can read user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Service role can insert user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Service role can update user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "Service role can delete user_sessions" ON public.user_sessions;
DROP POLICY IF EXISTS "user_sessions_service_role_select" ON public.user_sessions;
DROP POLICY IF EXISTS "user_sessions_service_role_insert" ON public.user_sessions;
DROP POLICY IF EXISTS "user_sessions_service_role_update" ON public.user_sessions;
DROP POLICY IF EXISTS "user_sessions_service_role_delete" ON public.user_sessions;

CREATE POLICY "user_sessions_service_role_select" ON public.user_sessions FOR SELECT TO service_role USING (true);
CREATE POLICY "user_sessions_service_role_insert" ON public.user_sessions FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "user_sessions_service_role_update" ON public.user_sessions FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "user_sessions_service_role_delete" ON public.user_sessions FOR DELETE TO service_role USING (true);

-- ========== CUSTOM USERS ==========
DROP POLICY IF EXISTS "Allow all to view custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Allow all to create custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Allow all to update custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Allow all to delete custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Service role can read custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Service role can insert custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Service role can update custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Service role can delete custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "custom_users_service_role_select" ON public.custom_users;
DROP POLICY IF EXISTS "custom_users_service_role_insert" ON public.custom_users;
DROP POLICY IF EXISTS "custom_users_service_role_update" ON public.custom_users;
DROP POLICY IF EXISTS "custom_users_service_role_delete" ON public.custom_users;

CREATE POLICY "custom_users_service_role_select" ON public.custom_users FOR SELECT TO service_role USING (true);
CREATE POLICY "custom_users_service_role_insert" ON public.custom_users FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "custom_users_service_role_update" ON public.custom_users FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "custom_users_service_role_delete" ON public.custom_users FOR DELETE TO service_role USING (true);

-- ========== CLIENTS ==========
DROP POLICY IF EXISTS "Allow all to view clients" ON public.clients;
DROP POLICY IF EXISTS "Allow all to create clients" ON public.clients;
DROP POLICY IF EXISTS "Allow all to update clients" ON public.clients;
DROP POLICY IF EXISTS "Allow all to delete clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can read clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can insert clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can update clients" ON public.clients;
DROP POLICY IF EXISTS "Service role can delete clients" ON public.clients;
DROP POLICY IF EXISTS "clients_service_role_select" ON public.clients;
DROP POLICY IF EXISTS "clients_service_role_insert" ON public.clients;
DROP POLICY IF EXISTS "clients_service_role_update" ON public.clients;
DROP POLICY IF EXISTS "clients_service_role_delete" ON public.clients;

CREATE POLICY "clients_service_role_select" ON public.clients FOR SELECT TO service_role USING (true);
CREATE POLICY "clients_service_role_insert" ON public.clients FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "clients_service_role_update" ON public.clients FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "clients_service_role_delete" ON public.clients FOR DELETE TO service_role USING (true);

-- ========== CLIENT PROPERTIES ==========
DROP POLICY IF EXISTS "Allow all to view client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "Allow all to create client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "Allow all to update client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "Allow all to delete client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "Service role can read client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "Service role can insert client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "Service role can update client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "Service role can delete client_properties" ON public.client_properties;
DROP POLICY IF EXISTS "client_properties_service_role_select" ON public.client_properties;
DROP POLICY IF EXISTS "client_properties_service_role_insert" ON public.client_properties;
DROP POLICY IF EXISTS "client_properties_service_role_update" ON public.client_properties;
DROP POLICY IF EXISTS "client_properties_service_role_delete" ON public.client_properties;

CREATE POLICY "client_properties_service_role_select" ON public.client_properties FOR SELECT TO service_role USING (true);
CREATE POLICY "client_properties_service_role_insert" ON public.client_properties FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "client_properties_service_role_update" ON public.client_properties FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "client_properties_service_role_delete" ON public.client_properties FOR DELETE TO service_role USING (true);

-- ========== BORROWING CAPACITY ASSESSMENTS ==========
DROP POLICY IF EXISTS "Allow all to view borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "Allow all to create borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "Allow all to update borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "Allow all to delete borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "Service role can manage borrowing_capacity_assessments" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_select" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_insert" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_update" ON public.borrowing_capacity_assessments;
DROP POLICY IF EXISTS "borrowing_capacity_assessments_service_role_delete" ON public.borrowing_capacity_assessments;

CREATE POLICY "borrowing_capacity_assessments_service_role_select" ON public.borrowing_capacity_assessments FOR SELECT TO service_role USING (true);
CREATE POLICY "borrowing_capacity_assessments_service_role_insert" ON public.borrowing_capacity_assessments FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "borrowing_capacity_assessments_service_role_update" ON public.borrowing_capacity_assessments FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "borrowing_capacity_assessments_service_role_delete" ON public.borrowing_capacity_assessments FOR DELETE TO service_role USING (true);

-- ========== ACTIVITY LOGS ==========
DROP POLICY IF EXISTS "Allow all to view activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow all to create activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow all to update activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow all to delete activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Service role can read activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Service role can insert activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Service role can update activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Service role can delete activity_logs" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_service_role_select" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_service_role_insert" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_service_role_update" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_service_role_delete" ON public.activity_logs;

CREATE POLICY "activity_logs_service_role_select" ON public.activity_logs FOR SELECT TO service_role USING (true);
CREATE POLICY "activity_logs_service_role_insert" ON public.activity_logs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "activity_logs_service_role_update" ON public.activity_logs FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "activity_logs_service_role_delete" ON public.activity_logs FOR DELETE TO service_role USING (true);

-- ========== VAPI CALL LOGS ==========
DROP POLICY IF EXISTS "Allow all to view vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Allow all to create vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Allow all to update vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Allow all to delete vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Service role can read vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Service role can insert vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Service role can update vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Service role can delete vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "vapi_call_logs_service_role_select" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "vapi_call_logs_service_role_insert" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "vapi_call_logs_service_role_update" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "vapi_call_logs_service_role_delete" ON public.vapi_call_logs;

CREATE POLICY "vapi_call_logs_service_role_select" ON public.vapi_call_logs FOR SELECT TO service_role USING (true);
CREATE POLICY "vapi_call_logs_service_role_insert" ON public.vapi_call_logs FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "vapi_call_logs_service_role_update" ON public.vapi_call_logs FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "vapi_call_logs_service_role_delete" ON public.vapi_call_logs FOR DELETE TO service_role USING (true);