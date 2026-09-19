-- Phase 1: Add last_login_at, deleted_at to custom_users + register missing modules

-- Add last_login_at column
ALTER TABLE public.custom_users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Add deleted_at column for soft-delete
ALTER TABLE public.custom_users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Register missing modules in dashboard_modules
INSERT INTO public.dashboard_modules (module_key, module_name, description, category, sort_order, is_active)
VALUES
  ('reminders', 'Reminders', 'Task reminders and follow-up management', 'operations', 22, true),
  ('checklists', 'Checklists', 'Checklist templates and instances', 'operations', 23, true),
  ('agent', 'AI Agent', 'AI assistant and conversation management', 'admin', 24, true),
  ('agreements', 'Agreements', 'Agency agreements and document generation', 'operations', 25, true),
  ('borrowing_capacity', 'Borrowing Capacity', 'Borrowing capacity calculator and assessments', 'reports', 26, true),
  ('client_portal_admin', 'Client Portal Admin', 'Client portal user and access management', 'admin', 27, true),
  ('game_plans', 'Game Plans', 'Client game plan creation and management', 'operations', 28, true)
ON CONFLICT (module_key) DO NOTHING;