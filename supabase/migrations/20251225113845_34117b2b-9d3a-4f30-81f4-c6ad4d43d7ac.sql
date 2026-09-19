-- Add missing User Guide module
INSERT INTO public.dashboard_modules (module_key, module_name, description, category, icon, route, sort_order, is_active)
VALUES ('user_guide', 'User Guide', 'Help documentation and guides', 'settings', 'BookOpen', '/user-guide', 21, true)
ON CONFLICT (module_key) DO NOTHING;