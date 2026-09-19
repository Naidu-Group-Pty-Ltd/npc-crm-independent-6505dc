-- WP-11C P1: pending TOTP enrollment secrets are encrypted, short lived,
-- session-bound, and accessible only to service-role Edge Function code.
CREATE TABLE IF NOT EXISTS public.mfa_totp_enrollment_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  staff_session_id uuid NOT NULL REFERENCES public.user_sessions(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  encrypted_secret text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mfa_totp_enrollment_user_key
  ON public.mfa_totp_enrollment_challenges(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_totp_enrollment_token_key
  ON public.mfa_totp_enrollment_challenges(token_hash);
CREATE INDEX IF NOT EXISTS mfa_totp_enrollment_expiry_idx
  ON public.mfa_totp_enrollment_challenges(expires_at);

GRANT ALL ON TABLE public.mfa_totp_enrollment_challenges TO service_role;
REVOKE ALL ON TABLE public.mfa_totp_enrollment_challenges FROM anon, authenticated, PUBLIC;
ALTER TABLE public.mfa_totp_enrollment_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mfa_totp_enrollment_service_only"
  ON public.mfa_totp_enrollment_challenges FOR ALL
  USING (false) WITH CHECK (false);
