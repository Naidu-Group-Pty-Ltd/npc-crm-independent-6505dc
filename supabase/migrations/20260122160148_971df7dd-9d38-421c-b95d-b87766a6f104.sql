-- Fix SECURITY DEFINER View issue: Recreate activity_logs_with_user with SECURITY INVOKER
-- This ensures the view uses the permissions of the querying user, not the view creator

-- Drop existing view
DROP VIEW IF EXISTS public.activity_logs_with_user;

-- Recreate with security_invoker = on (the secure default)
CREATE VIEW public.activity_logs_with_user 
WITH (security_invoker = on)
AS 
SELECT 
    al.id,
    al.user_id,
    al.username,
    al.action_type,
    al.entity_type,
    al.entity_id,
    al.entity_name,
    al.metadata,
    al.ip_address,
    al.user_agent,
    al.created_at,
    COALESCE(al.username, cu.username, 'Unknown User'::text) AS display_username,
    cu.email AS user_email,
    cu.role AS user_role
FROM public.activity_logs al
LEFT JOIN public.custom_users cu ON al.user_id = cu.id;

-- Grant appropriate permissions (service_role only since underlying tables are protected)
REVOKE ALL ON public.activity_logs_with_user FROM PUBLIC;
REVOKE ALL ON public.activity_logs_with_user FROM anon;
REVOKE ALL ON public.activity_logs_with_user FROM authenticated;
GRANT SELECT ON public.activity_logs_with_user TO service_role;