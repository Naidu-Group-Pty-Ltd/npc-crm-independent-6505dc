-- Add depreciation_comps and activity_logs permissions for all existing users
INSERT INTO public.user_permissions (user_id, module_id, can_view, can_edit, can_delete, granted_by)
SELECT 
  cu.id as user_id,
  dm.id as module_id,
  true as can_view,
  true as can_edit,
  true as can_delete,
  'd4ffa794-7398-43be-a618-dff099dd2bcd'::uuid as granted_by -- super_admin user
FROM public.custom_users cu
CROSS JOIN public.dashboard_modules dm
WHERE dm.module_key IN ('depreciation_comps', 'activity_logs')
ON CONFLICT (user_id, module_id) DO UPDATE SET
  can_view = true,
  can_edit = true,
  can_delete = true,
  updated_at = now();