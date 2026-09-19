-- =====================================================
-- SECURE CLIENTS TABLE RLS POLICIES
-- =====================================================
-- This migration restricts direct access to the clients table
-- and forces all access through authenticated Edge Functions
-- using the service role key.
-- =====================================================

-- Drop existing permissive policies
DROP POLICY IF EXISTS "Anyone can view clients" ON public.clients;
DROP POLICY IF EXISTS "Anyone can create clients" ON public.clients;
DROP POLICY IF EXISTS "Anyone can update clients" ON public.clients;
DROP POLICY IF EXISTS "Anyone can delete clients" ON public.clients;

-- Create restrictive policies that only allow service role access
-- This ensures all client data access goes through Edge Functions

-- SELECT: Only service role can read clients
CREATE POLICY "Service role can read clients"
ON public.clients
FOR SELECT
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- INSERT: Only service role can create clients
CREATE POLICY "Service role can create clients"
ON public.clients
FOR INSERT
WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- UPDATE: Only service role can update clients
CREATE POLICY "Service role can update clients"
ON public.clients
FOR UPDATE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- DELETE: Only service role can delete clients
CREATE POLICY "Service role can delete clients"
ON public.clients
FOR DELETE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

-- Also secure client_properties table (contains addresses, values, loan info)
DROP POLICY IF EXISTS "Anyone can view client properties" ON public.client_properties;
DROP POLICY IF EXISTS "Anyone can create client properties" ON public.client_properties;
DROP POLICY IF EXISTS "Anyone can update client properties" ON public.client_properties;
DROP POLICY IF EXISTS "Anyone can delete client properties" ON public.client_properties;

CREATE POLICY "Service role can read client_properties"
ON public.client_properties
FOR SELECT
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can create client_properties"
ON public.client_properties
FOR INSERT
WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can update client_properties"
ON public.client_properties
FOR UPDATE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can delete client_properties"
ON public.client_properties
FOR DELETE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);