-- Add the missing dashboard modules for depreciation comps and activity logs
INSERT INTO public.dashboard_modules (module_key, module_name, category, description, route, is_active, sort_order)
VALUES 
  ('depreciation_comps', 'Depreciation Comps', 'admin', 'Manage depreciation comparable properties for the calculator', '/admin/depreciation-comps', true, 110),
  ('activity_logs', 'Activity Logs', 'admin', 'View user activity and audit trail', '/admin/activity-logs', true, 115)
ON CONFLICT (module_key) DO UPDATE SET
  is_active = true,
  route = EXCLUDED.route;