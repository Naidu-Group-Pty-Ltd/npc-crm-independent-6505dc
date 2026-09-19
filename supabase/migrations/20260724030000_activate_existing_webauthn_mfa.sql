-- Passkeys are a phishing-resistant second factor. Accounts that registered a
-- passkey before the MFA activation fix must therefore be enrolled for MFA.
-- Never replace an existing MFA method (for example, TOTP).
UPDATE public.custom_users
SET
  mfa_enrolled_at = webauthn_enrolled_at,
  mfa_method = 'webauthn',
  mfa_required = true
WHERE webauthn_enrolled_at IS NOT NULL
  AND mfa_enrolled_at IS NULL;
