
-- WebAuthn credentials
CREATE TABLE IF NOT EXISTS public.user_webauthn_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  credential_id TEXT NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  aaguid TEXT NULL,
  device_type TEXT NULL,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  device_name TEXT NULL,
  last_used_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_webauthn_credentials_credential_id_key UNIQUE (credential_id)
);
CREATE INDEX IF NOT EXISTS user_webauthn_credentials_user_idx ON public.user_webauthn_credentials(user_id);

GRANT ALL ON public.user_webauthn_credentials TO service_role;
ALTER TABLE public.user_webauthn_credentials ENABLE ROW LEVEL SECURITY;
-- No policies: service_role bypasses RLS; ordinary roles have no grants.

-- WebAuthn ceremony challenges (registration + assertion)
CREATE TABLE IF NOT EXISTS public.mfa_webauthn_challenges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  staff_session_id UUID NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration','assertion')),
  challenge_b64url TEXT NOT NULL,
  token_hash TEXT NULL,
  capability TEXT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_webauthn_challenges_user_idx ON public.mfa_webauthn_challenges(user_id, purpose);
CREATE INDEX IF NOT EXISTS mfa_webauthn_challenges_expiry_idx ON public.mfa_webauthn_challenges(expires_at);

GRANT ALL ON public.mfa_webauthn_challenges TO service_role;
ALTER TABLE public.mfa_webauthn_challenges ENABLE ROW LEVEL SECURITY;

-- custom_users: record webauthn enrolment separately from TOTP
ALTER TABLE public.custom_users
  ADD COLUMN IF NOT EXISTS webauthn_enrolled_at TIMESTAMPTZ NULL;

-- Allow mfa_method='webauthn' if a check constraint exists; replace it.
DO $$
DECLARE
  ck TEXT;
BEGIN
  SELECT conname INTO ck
  FROM pg_constraint
  WHERE conrelid = 'public.custom_users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%mfa_method%';
  IF ck IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.custom_users DROP CONSTRAINT %I', ck);
  END IF;
END $$;

ALTER TABLE public.custom_users
  ADD CONSTRAINT custom_users_mfa_method_check
  CHECK (mfa_method IS NULL OR mfa_method IN ('totp','webauthn'));

-- Updated-at trigger
CREATE OR REPLACE FUNCTION public.update_user_webauthn_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_user_webauthn_credentials_updated_at ON public.user_webauthn_credentials;
CREATE TRIGGER trg_user_webauthn_credentials_updated_at
BEFORE UPDATE ON public.user_webauthn_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_user_webauthn_credentials_updated_at();
