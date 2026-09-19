-- Clean up duplicate roles: for users with both admin and superadmin, remove the admin role
-- and keep only superadmin (since they were promoted)
DELETE FROM public.user_roles 
WHERE role = 'admin' 
AND user_id IN (
  SELECT user_id FROM public.user_roles WHERE role = 'superadmin'
);

-- Fix custom_users.role for users who have superadmin in user_roles
UPDATE public.custom_users 
SET role = 'super_admin', updated_at = now()
WHERE id IN (
  SELECT user_id FROM public.user_roles WHERE role = 'superadmin'
)
AND role != 'super_admin'