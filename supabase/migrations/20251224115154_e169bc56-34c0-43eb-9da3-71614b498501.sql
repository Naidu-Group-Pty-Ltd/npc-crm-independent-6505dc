-- Update existing admin accounts to super_admin role
-- This ensures the original account(s) are marked as super admins

UPDATE public.custom_users
SET role = 'super_admin'
WHERE role = 'admin' 
  AND id IN (
    SELECT user_id FROM public.user_roles WHERE role = 'superadmin'
  );

-- Also update any accounts that might still have the old 'admin' role 
-- but have the superadmin role in user_roles table
UPDATE public.custom_users
SET role = 'super_admin'
WHERE role = 'admin'
  AND EXISTS (
    SELECT 1 FROM public.user_roles ur 
    WHERE ur.user_id = custom_users.id 
    AND ur.role = 'superadmin'
  );