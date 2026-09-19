-- ================================================
-- CRITICAL SECURITY FIX: Lock down sensitive tables
-- ================================================

-- 1. Fix custom_users table - contains password hashes
-- Drop any existing permissive policies
DROP POLICY IF EXISTS "Allow authenticated users to read their own data" ON public.custom_users;
DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.custom_users;
DROP POLICY IF EXISTS "Users can view their own data" ON public.custom_users;
DROP POLICY IF EXISTS "custom_users_select_policy" ON public.custom_users;

-- Create service_role only policies for custom_users
CREATE POLICY "custom_users_service_role_select" 
ON public.custom_users FOR SELECT 
TO service_role
USING (true);

CREATE POLICY "custom_users_service_role_insert" 
ON public.custom_users FOR INSERT 
TO service_role
WITH CHECK (true);

CREATE POLICY "custom_users_service_role_update" 
ON public.custom_users FOR UPDATE 
TO service_role
USING (true) 
WITH CHECK (true);

CREATE POLICY "custom_users_service_role_delete" 
ON public.custom_users FOR DELETE 
TO service_role
USING (true);

-- 2. Fix clients table - contains PII (names, emails, phones, addresses, financials)
-- Drop any existing permissive policies
DROP POLICY IF EXISTS "Anyone can read clients" ON public.clients;
DROP POLICY IF EXISTS "Allow select for all" ON public.clients;
DROP POLICY IF EXISTS "clients_select_policy" ON public.clients;
DROP POLICY IF EXISTS "Allow public read access" ON public.clients;

-- Create service_role only policies for clients
CREATE POLICY "clients_service_role_select" 
ON public.clients FOR SELECT 
TO service_role
USING (true);

CREATE POLICY "clients_service_role_insert" 
ON public.clients FOR INSERT 
TO service_role
WITH CHECK (true);

CREATE POLICY "clients_service_role_update" 
ON public.clients FOR UPDATE 
TO service_role
USING (true) 
WITH CHECK (true);

CREATE POLICY "clients_service_role_delete" 
ON public.clients FOR DELETE 
TO service_role
USING (true);

-- 3. Fix client_notes table - contains confidential business communications
-- Drop any existing permissive policies
DROP POLICY IF EXISTS "Anyone can read client_notes" ON public.client_notes;
DROP POLICY IF EXISTS "Allow select for all" ON public.client_notes;
DROP POLICY IF EXISTS "client_notes_select_policy" ON public.client_notes;
DROP POLICY IF EXISTS "Allow public read access" ON public.client_notes;

-- Create service_role only policies for client_notes
CREATE POLICY "client_notes_service_role_select" 
ON public.client_notes FOR SELECT 
TO service_role
USING (true);

CREATE POLICY "client_notes_service_role_insert" 
ON public.client_notes FOR INSERT 
TO service_role
WITH CHECK (true);

CREATE POLICY "client_notes_service_role_update" 
ON public.client_notes FOR UPDATE 
TO service_role
USING (true) 
WITH CHECK (true);

CREATE POLICY "client_notes_service_role_delete" 
ON public.client_notes FOR DELETE 
TO service_role
USING (true);