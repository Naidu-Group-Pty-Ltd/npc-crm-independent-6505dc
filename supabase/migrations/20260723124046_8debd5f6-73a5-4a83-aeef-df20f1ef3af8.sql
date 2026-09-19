
-- Step-up sessions (short-lived recent-reauth proofs)
CREATE TABLE IF NOT EXISTS public.step_up_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  capability TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'password',
  assurance_level SMALLINT NOT NULL DEFAULT 1,
  ip_address TEXT,
  user_agent TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step_up_sessions_user_cap
  ON public.step_up_sessions(user_id, capability, token_hash);
CREATE INDEX IF NOT EXISTS idx_step_up_sessions_expires
  ON public.step_up_sessions(expires_at);

GRANT ALL ON public.step_up_sessions TO service_role;
ALTER TABLE public.step_up_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "step_up_sessions_service_only"
  ON public.step_up_sessions FOR ALL
  USING (false) WITH CHECK (false);

-- MFA columns on custom_users (additive, all nullable / off by default)
ALTER TABLE public.custom_users
  ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mfa_method TEXT,
  ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS mfa_recovery_codes_hash TEXT[],
  ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_last_verified_at TIMESTAMPTZ;
