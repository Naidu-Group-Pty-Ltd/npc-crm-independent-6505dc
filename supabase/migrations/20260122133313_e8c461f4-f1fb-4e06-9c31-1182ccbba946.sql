-- Restrict user_sessions table to service_role only
-- This prevents session hijacking since all session operations go through Edge Functions
-- Edge functions use service_role key and will continue to work

-- Drop the existing permissive policy
DROP POLICY IF EXISTS "Users can access their own sessions" ON public.user_sessions;

-- Ensure RLS is enabled
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Create policy that only allows service_role access (for edge functions)
-- No direct access from anon or authenticated roles
CREATE POLICY "Service role only access to user_sessions"
ON public.user_sessions
FOR ALL
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');