-- Secure activity_logs table: restrict all access to service_role only
-- This protects sensitive user tracking data (IP addresses, user agents, behavior patterns)

-- Drop existing permissive RLS policies
DROP POLICY IF EXISTS "Allow public read access to activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow public insert access to activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow read access to activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Allow insert access to activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_select_policy" ON public.activity_logs;
DROP POLICY IF EXISTS "activity_logs_insert_policy" ON public.activity_logs;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.activity_logs;
DROP POLICY IF EXISTS "Enable insert for all users" ON public.activity_logs;

-- Ensure RLS is enabled
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Create service_role only policies for all operations
CREATE POLICY "service_role_select_activity_logs" ON public.activity_logs
FOR SELECT USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_insert_activity_logs" ON public.activity_logs
FOR INSERT WITH CHECK (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_update_activity_logs" ON public.activity_logs
FOR UPDATE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);

CREATE POLICY "service_role_delete_activity_logs" ON public.activity_logs
FOR DELETE USING (
  (current_setting('request.jwt.claims', true)::json->>'role') = 'service_role'
);