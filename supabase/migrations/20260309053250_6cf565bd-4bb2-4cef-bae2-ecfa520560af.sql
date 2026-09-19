
-- Client Portal Users table
CREATE TABLE public.client_portal_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  invite_token TEXT,
  invite_expires_at TIMESTAMPTZ,
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(email),
  UNIQUE(client_id)
);

-- Client Portal Sessions table
CREATE TABLE public.client_portal_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.client_portal_users(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.client_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_sessions ENABLE ROW LEVEL SECURITY;

-- RLS: service_role only (all access through edge functions)
CREATE POLICY "Service role only" ON public.client_portal_users FOR ALL USING (false);
CREATE POLICY "Service role only" ON public.client_portal_sessions FOR ALL USING (false);

-- Indexes
CREATE INDEX idx_client_portal_users_email ON public.client_portal_users(email);
CREATE INDEX idx_client_portal_users_invite_token ON public.client_portal_users(invite_token);
CREATE INDEX idx_client_portal_users_reset_token ON public.client_portal_users(password_reset_token);
CREATE INDEX idx_client_portal_sessions_token ON public.client_portal_sessions(session_token);
CREATE INDEX idx_client_portal_sessions_expires ON public.client_portal_sessions(expires_at);

-- Updated at trigger
CREATE TRIGGER update_client_portal_users_updated_at
  BEFORE UPDATE ON public.client_portal_users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Cleanup function for expired portal sessions
CREATE OR REPLACE FUNCTION public.cleanup_expired_portal_sessions()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  DELETE FROM public.client_portal_sessions 
  WHERE expires_at < now();
$$;
