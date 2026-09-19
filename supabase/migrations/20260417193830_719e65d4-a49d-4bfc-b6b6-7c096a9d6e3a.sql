-- ============================================================================
-- PHASE 1: Finance Portal foundation
-- ============================================================================

-- 1. finance_portal_users
CREATE TABLE public.finance_portal_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  finance_contact_id UUID NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  has_accepted_terms BOOLEAN NOT NULL DEFAULT false,
  has_completed_onboarding BOOLEAN NOT NULL DEFAULT false,
  terms_accepted_at TIMESTAMPTZ,
  invite_token TEXT,
  invite_token_expires_at TIMESTAMPTZ,
  invite_sent_at TIMESTAMPTZ,
  invite_accepted_at TIMESTAMPTZ,
  reset_token TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  session_token TEXT,
  session_expires_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,
  invited_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_finance_portal_users_finance_contact_id ON public.finance_portal_users(finance_contact_id);
CREATE INDEX idx_finance_portal_users_email ON public.finance_portal_users(email);
CREATE INDEX idx_finance_portal_users_invite_token ON public.finance_portal_users(invite_token) WHERE invite_token IS NOT NULL;
CREATE INDEX idx_finance_portal_users_reset_token ON public.finance_portal_users(reset_token) WHERE reset_token IS NOT NULL;
CREATE INDEX idx_finance_portal_users_session_token ON public.finance_portal_users(session_token) WHERE session_token IS NOT NULL;

ALTER TABLE public.finance_portal_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages finance_portal_users"
  ON public.finance_portal_users
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 2. finance_portal_client_assignments
CREATE TABLE public.finance_portal_client_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  finance_user_id UUID NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  permissions JSONB NOT NULL DEFAULT '{
    "properties":  {"view": true,  "edit": false, "delete": false},
    "income":      {"view": true,  "edit": false, "delete": false},
    "expenses":    {"view": true,  "edit": false, "delete": false},
    "assets":      {"view": true,  "edit": false, "delete": false},
    "liabilities": {"view": true,  "edit": false, "delete": false},
    "employment":  {"view": true,  "edit": false, "delete": false},
    "notes":       {"view": true,  "edit": false, "delete": false},
    "contacts":    {"view": true,  "edit": false, "delete": false}
  }'::jsonb,
  auto_linked BOOLEAN NOT NULL DEFAULT false,
  auto_link_source TEXT,
  assigned_by UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(finance_user_id, client_id),
  CONSTRAINT finance_portal_assignments_source_check
    CHECK (auto_link_source IS NULL OR auto_link_source IN ('client_field', 'deal', 'manual'))
);

CREATE INDEX idx_finance_assignments_finance_user_id ON public.finance_portal_client_assignments(finance_user_id);
CREATE INDEX idx_finance_assignments_client_id ON public.finance_portal_client_assignments(client_id);

ALTER TABLE public.finance_portal_client_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages finance_portal_client_assignments"
  ON public.finance_portal_client_assignments
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.finance_portal_client_assignments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_client_assignments;

-- 3. finance_portal_default_permissions
CREATE TABLE public.finance_portal_default_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  permissions JSONB NOT NULL DEFAULT '{
    "properties":  {"view": true,  "edit": false, "delete": false},
    "income":      {"view": true,  "edit": false, "delete": false},
    "expenses":    {"view": true,  "edit": false, "delete": false},
    "assets":      {"view": true,  "edit": false, "delete": false},
    "liabilities": {"view": true,  "edit": false, "delete": false},
    "employment":  {"view": true,  "edit": false, "delete": false},
    "notes":       {"view": true,  "edit": false, "delete": false},
    "contacts":    {"view": true,  "edit": false, "delete": false}
  }'::jsonb,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_portal_default_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages finance_portal_default_permissions"
  ON public.finance_portal_default_permissions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO public.finance_portal_default_permissions (id) VALUES (gen_random_uuid());

-- 4. finance_portal_activity_log
CREATE TABLE public.finance_portal_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  finance_user_id UUID,
  actor_user_id UUID,
  actor_type TEXT NOT NULL DEFAULT 'finance_user',
  action TEXT NOT NULL,
  client_id UUID,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_portal_activity_actor_type_check
    CHECK (actor_type IN ('finance_user', 'staff', 'system'))
);

CREATE INDEX idx_finance_activity_finance_user_id ON public.finance_portal_activity_log(finance_user_id);
CREATE INDEX idx_finance_activity_client_id ON public.finance_portal_activity_log(client_id);
CREATE INDEX idx_finance_activity_created_at ON public.finance_portal_activity_log(created_at DESC);

ALTER TABLE public.finance_portal_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages finance_portal_activity_log"
  ON public.finance_portal_activity_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 5. updated_at triggers
CREATE OR REPLACE FUNCTION public.set_finance_portal_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_finance_portal_users_updated_at
  BEFORE UPDATE ON public.finance_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.set_finance_portal_updated_at();

CREATE TRIGGER trg_finance_portal_assignments_updated_at
  BEFORE UPDATE ON public.finance_portal_client_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_finance_portal_updated_at();

CREATE TRIGGER trg_finance_portal_default_perms_updated_at
  BEFORE UPDATE ON public.finance_portal_default_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_finance_portal_updated_at();

-- 6. Register finance_portal_admin module (uses module_name, not name)
INSERT INTO public.dashboard_modules (module_key, module_name, description, icon, category, is_active, sort_order)
VALUES (
  'finance_portal_admin',
  'Finance Portal Access',
  'Manage which finance contacts can log into the finance portal and which clients they can access.',
  'Briefcase',
  'admin',
  true,
  100
)
ON CONFLICT (module_key) DO NOTHING;