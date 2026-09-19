
-- 1. Handoff tokens table
CREATE TABLE IF NOT EXISTS public.finance_portal_handoff_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  finance_user_id UUID NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  finance_contact_id UUID,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  target_portal_user_id UUID REFERENCES public.client_portal_users(id) ON DELETE SET NULL,
  is_readonly BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 minutes'),
  consumed_at TIMESTAMPTZ,
  consumed_session_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fp_handoff_token ON public.finance_portal_handoff_tokens(token);
CREATE INDEX IF NOT EXISTS idx_fp_handoff_finance_user ON public.finance_portal_handoff_tokens(finance_user_id);
CREATE INDEX IF NOT EXISTS idx_fp_handoff_client ON public.finance_portal_handoff_tokens(client_id);
CREATE INDEX IF NOT EXISTS idx_fp_handoff_expires ON public.finance_portal_handoff_tokens(expires_at);

ALTER TABLE public.finance_portal_handoff_tokens ENABLE ROW LEVEL SECURITY;

-- Service-role only (mediated by edge functions)
CREATE POLICY "service_role_all_fp_handoff"
ON public.finance_portal_handoff_tokens
FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. Impersonation columns on client_portal_sessions
ALTER TABLE public.client_portal_sessions
  ADD COLUMN IF NOT EXISTS impersonator_finance_user_id UUID REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS impersonator_finance_contact_id UUID,
  ADD COLUMN IF NOT EXISTS is_readonly BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_cps_impersonator
  ON public.client_portal_sessions(impersonator_finance_user_id)
  WHERE impersonator_finance_user_id IS NOT NULL;
