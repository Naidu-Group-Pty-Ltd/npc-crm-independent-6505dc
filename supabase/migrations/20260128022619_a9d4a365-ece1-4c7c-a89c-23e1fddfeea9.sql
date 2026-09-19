-- Add missing client-related modules to dashboard_modules table
INSERT INTO public.dashboard_modules (module_key, module_name, description, category, route, sort_order, is_active)
VALUES 
  ('client_tracker', 'Client Tracker', 'Track and manage client pipeline stages', 'operations', '/client-tracker', 5, true),
  ('client_management', 'Client Management', 'Manage client profiles and data', 'operations', '/clients', 4, true)
ON CONFLICT (module_key) DO NOTHING;