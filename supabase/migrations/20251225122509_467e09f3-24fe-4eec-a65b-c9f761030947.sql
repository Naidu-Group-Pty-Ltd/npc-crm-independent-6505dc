-- Add a new module for admin email access control
INSERT INTO public.dashboard_modules (module_key, module_name, description, category, icon, route, sort_order, is_active)
VALUES ('admin_email_access', 'Admin Email Access', 'Access to shared admin email inbox', 'operations', 'Inbox', NULL, 8, true)
ON CONFLICT (module_key) DO NOTHING;