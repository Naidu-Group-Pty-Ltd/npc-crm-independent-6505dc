-- Create enum for app roles
CREATE TYPE public.app_role AS ENUM ('superadmin', 'admin', 'user');

-- Create user_roles table for role assignments (security best practice - separate from custom_users)
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.custom_users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- Create dashboard_modules table listing all permissionable features
CREATE TABLE public.dashboard_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL UNIQUE,
  module_name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  icon text,
  route text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create user_permissions table mapping users to allowed modules
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.custom_users(id) ON DELETE CASCADE NOT NULL,
  module_id uuid REFERENCES public.dashboard_modules(id) ON DELETE CASCADE NOT NULL,
  can_view boolean NOT NULL DEFAULT true,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  granted_by uuid REFERENCES public.custom_users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_id)
);

-- Create password_reset_tokens table for OTP verification
CREATE TABLE public.password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.custom_users(id) ON DELETE CASCADE NOT NULL,
  otp_code text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create permission_invite_tokens table for email-based permission adjustments
CREATE TABLE public.permission_invite_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  username text,
  temporary_password text,
  invite_type text NOT NULL DEFAULT 'magic_link', -- 'magic_link' or 'temp_password'
  token text NOT NULL UNIQUE,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb, -- Array of module_keys with permissions
  invited_by uuid REFERENCES public.custom_users(id) NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_invite_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_roles
CREATE POLICY "Anyone can view user roles" ON public.user_roles FOR SELECT USING (true);
CREATE POLICY "Service role can manage user roles" ON public.user_roles FOR ALL USING (true);

-- RLS Policies for dashboard_modules
CREATE POLICY "Anyone can view dashboard modules" ON public.dashboard_modules FOR SELECT USING (true);
CREATE POLICY "Service role can manage dashboard modules" ON public.dashboard_modules FOR ALL USING (true);

-- RLS Policies for user_permissions
CREATE POLICY "Anyone can view user permissions" ON public.user_permissions FOR SELECT USING (true);
CREATE POLICY "Service role can manage user permissions" ON public.user_permissions FOR ALL USING (true);

-- RLS Policies for password_reset_tokens
CREATE POLICY "Service role can manage password reset tokens" ON public.password_reset_tokens FOR ALL USING (true);

-- RLS Policies for permission_invite_tokens
CREATE POLICY "Service role can manage invite tokens" ON public.permission_invite_tokens FOR ALL USING (true);

-- Security definer function to check if a user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Security definer function to check if user has access to a module
CREATE OR REPLACE FUNCTION public.has_module_access(_user_id uuid, _module_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_permissions up
    JOIN public.dashboard_modules dm ON up.module_id = dm.id
    WHERE up.user_id = _user_id
      AND dm.module_key = _module_key
      AND up.can_view = true
  )
  OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = 'superadmin'
  )
$$;

-- Insert default dashboard modules
INSERT INTO public.dashboard_modules (module_key, module_name, description, category, icon, route, sort_order) VALUES
('overview', 'Overview', 'Dashboard overview and KPIs', 'core', 'LayoutDashboard', '/', 1),
('listings', 'Listings', 'Property listings management', 'core', 'Building2', '/listings', 2),
('reports', 'Reports', 'Investment reports', 'reports', 'FileText', '/reports', 3),
('generated_reports', 'Generated Reports', 'View generated reports', 'reports', 'Files', '/generated-reports', 4),
('report_qa', 'Report Q&A', 'AI-powered report analysis', 'reports', 'MessageSquare', '/report-qa', 5),
('calendar', 'Calendar', 'Appointment scheduling', 'operations', 'Calendar', '/calendar', 6),
('call_logs', 'Call Logs', 'VAPI call logs and analytics', 'operations', 'Phone', '/call-logs', 7),
('email_copilot', 'Email Copilot', 'AI email management', 'operations', 'Mail', '/email-copilot', 8),
('automation', 'Automation', 'Auto-generation rules', 'automation', 'Zap', '/automation', 9),
('templates', 'Templates', 'Report templates management', 'settings', 'FileCode', '/templates', 10),
('sources', 'Sources', 'Data sources management', 'settings', 'Database', '/sources', 11),
('monitoring', 'Monitoring', 'System health monitoring', 'admin', 'Activity', '/monitoring', 12),
('error_logs', 'Error Logs', 'System error logs', 'admin', 'AlertTriangle', '/error-logs', 13),
('data_import', 'Data Import', 'Import external data', 'admin', 'Upload', '/data-import', 14),
('settings', 'Settings', 'Application settings', 'settings', 'Settings', '/settings', 15),
('white_label', 'White Label', 'Branding customization', 'settings', 'Palette', '/white-label', 16),
('user_management', 'User Management', 'Manage users and permissions', 'admin', 'Users', '/admin/users', 17),
('quality_assurance', 'Quality Assurance', 'QA dashboard', 'reports', 'CheckCircle', '/quality-assurance', 18),
('charts', 'Charts', 'Chart analysis', 'reports', 'BarChart', '/charts', 19),
('cash_flow', 'Cash Flow Analysis', 'Cash flow comparisons', 'reports', 'DollarSign', '/cash-flow-analysis', 20);

-- Add email column to custom_users for password recovery
ALTER TABLE public.custom_users ADD COLUMN IF NOT EXISTS email text;