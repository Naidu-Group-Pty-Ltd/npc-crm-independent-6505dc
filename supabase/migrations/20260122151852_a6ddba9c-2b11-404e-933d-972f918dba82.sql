-- Drop existing permissive policies on vapi_call_logs
DROP POLICY IF EXISTS "Anyone can view call logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Anyone can insert call logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Anyone can update call logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Anyone can delete call logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Public read access for vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Public insert access for vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Public update access for vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Public delete access for vapi_call_logs" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Allow public read access" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Allow public insert" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Allow public update" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "Allow public delete" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "service_role_only_read" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "service_role_only_insert" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "service_role_only_update" ON public.vapi_call_logs;
DROP POLICY IF EXISTS "service_role_only_delete" ON public.vapi_call_logs;

-- Create restrictive policies that only allow service role access
-- This forces all access through Edge Functions which validate session tokens

CREATE POLICY "Service role can read vapi_call_logs"
ON public.vapi_call_logs
FOR SELECT
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can insert vapi_call_logs"
ON public.vapi_call_logs
FOR INSERT
WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can update vapi_call_logs"
ON public.vapi_call_logs
FOR UPDATE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "Service role can delete vapi_call_logs"
ON public.vapi_call_logs
FOR DELETE
USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);