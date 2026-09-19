-- Restrict custom_users table to service_role only
-- This prevents public access to password hashes, usernames, and emails
-- Edge functions use service_role key and will continue to work

-- First, drop existing permissive policies on custom_users
DROP POLICY IF EXISTS "Anyone can view custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Allow authenticated users to read their own data" ON public.custom_users;
DROP POLICY IF EXISTS "Allow public read access to custom_users" ON public.custom_users;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.custom_users;
DROP POLICY IF EXISTS "Users can read their own data" ON public.custom_users;
DROP POLICY IF EXISTS "Allow read custom_users" ON public.custom_users;

-- Ensure RLS is enabled
ALTER TABLE public.custom_users ENABLE ROW LEVEL SECURITY;

-- Create policy that only allows service_role access (for edge functions)
-- No direct access from anon or authenticated roles
CREATE POLICY "Service role only access to custom_users"
ON public.custom_users
FOR ALL
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');