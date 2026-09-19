INSERT INTO public.dashboard_modules (module_key, module_name, description, icon, is_active, sort_order)
VALUES ('conversations', 'Conversations', 'GoHighLevel conversation sync and messaging', 'MessageSquare', true, 25)
ON CONFLICT (module_key) DO NOTHING;