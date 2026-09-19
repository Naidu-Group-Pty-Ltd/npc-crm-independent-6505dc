INSERT INTO public.dashboard_modules (module_key, module_name, description, is_active)
VALUES ('report_requests', 'Report Requests', 'Client portal report request management queue', true)
ON CONFLICT (module_key) DO NOTHING;