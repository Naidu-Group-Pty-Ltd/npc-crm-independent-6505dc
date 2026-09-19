-- =====================================================================
-- SOLICITOR PORTAL — PHASE 1: Foundation & Auth
-- Mirrors the Finance Portal auth architecture (opaque session token on
-- the user row, service-role-only RLS, edge-function mediated access).
-- =====================================================================

-- ---------- Enums ----------
DO $$ BEGIN
  CREATE TYPE public.solicitor_portal_role AS ENUM (
    'principal', 'solicitor', 'conveyancer', 'paralegal', 'assistant'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Firms ----------
CREATE TABLE IF NOT EXISTS public.solicitor_firms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  trading_name TEXT,
  abn TEXT,
  licence_number TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  website TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  suburb TEXT,
  state TEXT,
  postcode TEXT,
  practising_states TEXT[] NOT NULL DEFAULT ARRAY['NSW','VIC','QLD']::TEXT[],
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.solicitor_firms TO service_role;
ALTER TABLE public.solicitor_firms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solicitor_firms_service_role_only"
  ON public.solicitor_firms FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------- Portal users ----------
CREATE TABLE IF NOT EXISTS public.solicitor_portal_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  firm_id UUID NOT NULL REFERENCES public.solicitor_firms(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  position TEXT,
  portal_role public.solicitor_portal_role NOT NULL DEFAULT 'solicitor',

  password_hash TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT false,

  invite_token TEXT,
  invite_token_expires_at TIMESTAMPTZ,
  invite_accepted_at TIMESTAMPTZ,
  invited_by UUID,
  invited_at TIMESTAMPTZ,

  reset_token TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  reset_attempts INTEGER NOT NULL DEFAULT 0,

  session_token TEXT,
  session_expires_at TIMESTAMPTZ,

  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,

  has_accepted_terms BOOLEAN NOT NULL DEFAULT false,
  terms_accepted_at TIMESTAMPTZ,
  has_completed_onboarding BOOLEAN NOT NULL DEFAULT false,

  is_active BOOLEAN NOT NULL DEFAULT true,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID,

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT solicitor_portal_users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT solicitor_portal_users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS solicitor_portal_users_email_key
  ON public.solicitor_portal_users (email);
CREATE UNIQUE INDEX IF NOT EXISTS solicitor_portal_users_session_token_key
  ON public.solicitor_portal_users (session_token) WHERE session_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS solicitor_portal_users_invite_token_key
  ON public.solicitor_portal_users (invite_token) WHERE invite_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS solicitor_portal_users_reset_token_key
  ON public.solicitor_portal_users (reset_token) WHERE reset_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS solicitor_portal_users_firm_idx
  ON public.solicitor_portal_users (firm_id);

GRANT ALL ON public.solicitor_portal_users TO service_role;
ALTER TABLE public.solicitor_portal_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solicitor_portal_users_service_role_only"
  ON public.solicitor_portal_users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------- Default (global) permission baseline ----------
CREATE TABLE IF NOT EXISTS public.solicitor_portal_default_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitor_user_id UUID REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE,
  permissions JSONB NOT NULL DEFAULT '{
    "matters":        {"view": true,  "edit": true,  "delete": false},
    "critical_dates": {"view": true,  "edit": true,  "delete": false},
    "documents":      {"view": true,  "edit": true,  "delete": false},
    "searches":       {"view": true,  "edit": true,  "delete": false},
    "disbursements":  {"view": true,  "edit": true,  "delete": false},
    "parties":        {"view": true,  "edit": true,  "delete": false},
    "contract":       {"view": true,  "edit": true,  "delete": false},
    "messages":       {"view": true,  "edit": true,  "delete": false},
    "client_tasks":   {"view": true,  "edit": true,  "delete": false},
    "settlement":     {"view": true,  "edit": true,  "delete": false},
    "finance_status": {"view": true,  "edit": false, "delete": false},
    "audit":          {"view": true,  "edit": false, "delete": false}
  }'::jsonb,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS solicitor_portal_default_permissions_user_key
  ON public.solicitor_portal_default_permissions (solicitor_user_id);

GRANT ALL ON public.solicitor_portal_default_permissions TO service_role;
ALTER TABLE public.solicitor_portal_default_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solicitor_portal_default_permissions_service_role_only"
  ON public.solicitor_portal_default_permissions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------- Client assignments ----------
CREATE TABLE IF NOT EXISTS public.solicitor_portal_client_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitor_user_id UUID NOT NULL REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  legal_matter_id UUID,
  permissions JSONB,
  assigned_by UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS solicitor_portal_client_assignments_unique
  ON public.solicitor_portal_client_assignments (solicitor_user_id, client_id);
CREATE INDEX IF NOT EXISTS solicitor_portal_client_assignments_client_idx
  ON public.solicitor_portal_client_assignments (client_id);

GRANT ALL ON public.solicitor_portal_client_assignments TO service_role;
ALTER TABLE public.solicitor_portal_client_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solicitor_portal_client_assignments_service_role_only"
  ON public.solicitor_portal_client_assignments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------- Activity log ----------
CREATE TABLE IF NOT EXISTS public.solicitor_portal_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitor_user_id UUID,
  firm_id UUID,
  actor_user_id UUID,
  actor_type TEXT NOT NULL DEFAULT 'solicitor_user',
  action TEXT NOT NULL,
  client_id UUID,
  legal_matter_id UUID,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  ip_address TEXT,
  user_agent TEXT,
  visible_to_client BOOLEAN NOT NULL DEFAULT false,
  visible_to_solicitor BOOLEAN NOT NULL DEFAULT true,
  visible_to_command_centre BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solicitor_portal_activity_log_user_idx
  ON public.solicitor_portal_activity_log (solicitor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS solicitor_portal_activity_log_client_idx
  ON public.solicitor_portal_activity_log (client_id, created_at DESC);

GRANT ALL ON public.solicitor_portal_activity_log TO service_role;
ALTER TABLE public.solicitor_portal_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "solicitor_portal_activity_log_service_role_only"
  ON public.solicitor_portal_activity_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION public.solicitor_portal_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_solicitor_firms_updated_at ON public.solicitor_firms;
CREATE TRIGGER trg_solicitor_firms_updated_at
  BEFORE UPDATE ON public.solicitor_firms
  FOR EACH ROW EXECUTE FUNCTION public.solicitor_portal_touch_updated_at();

DROP TRIGGER IF EXISTS trg_solicitor_portal_users_updated_at ON public.solicitor_portal_users;
CREATE TRIGGER trg_solicitor_portal_users_updated_at
  BEFORE UPDATE ON public.solicitor_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.solicitor_portal_touch_updated_at();

DROP TRIGGER IF EXISTS trg_solicitor_default_perms_updated_at ON public.solicitor_portal_default_permissions;
CREATE TRIGGER trg_solicitor_default_perms_updated_at
  BEFORE UPDATE ON public.solicitor_portal_default_permissions
  FOR EACH ROW EXECUTE FUNCTION public.solicitor_portal_touch_updated_at();

DROP TRIGGER IF EXISTS trg_solicitor_assignments_updated_at ON public.solicitor_portal_client_assignments;
CREATE TRIGGER trg_solicitor_assignments_updated_at
  BEFORE UPDATE ON public.solicitor_portal_client_assignments
  FOR EACH ROW EXECUTE FUNCTION public.solicitor_portal_touch_updated_at();
