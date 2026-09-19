-- Drop the SECURITY DEFINER view and recreate as a regular view
-- The underlying table already has RLS, so the view will inherit those policies
DROP VIEW IF EXISTS public.activity_logs_with_user;

CREATE VIEW public.activity_logs_with_user AS
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
  COALESCE(al.username, cu.username, 'Unknown User') as display_username,
  cu.email as user_email,
  cu.role as user_role
FROM public.activity_logs al
LEFT JOIN public.custom_users cu ON al.user_id = cu.id;