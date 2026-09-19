-- WP-11C P1: each RFC 6238 counter is accepted only once per user, preventing
-- replay across concurrent Edge Function instances.
ALTER TABLE public.custom_users
  ADD COLUMN IF NOT EXISTS mfa_last_totp_counter bigint;

COMMENT ON COLUMN public.custom_users.mfa_secret_encrypted IS
  'AES-256-GCM sealed RFC 6238 Base32 secret: v1:<base64url-iv>:<base64url-ciphertext>. Key is MFA_TOTP_ENCRYPTION_KEY Edge secret.';
COMMENT ON COLUMN public.custom_users.mfa_last_totp_counter IS
  'Last accepted RFC 6238 30-second counter. Conditional update prevents TOTP replay.';
