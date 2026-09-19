-- WP-11C P1: MFA recovery codes are peppered hashes and each code is consumed
-- atomically. The RPC is service-role only; browser clients never read or write
-- recovery-code metadata directly.
CREATE OR REPLACE FUNCTION public.consume_mfa_recovery_code(
  p_user_id uuid,
  p_code_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_hashes text[];
BEGIN
  IF p_code_hash IS NULL OR length(p_code_hash) <> 64 OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  SELECT mfa_recovery_codes_hash
    INTO current_hashes
    FROM public.custom_users
   WHERE id = p_user_id
   FOR UPDATE;

  IF current_hashes IS NULL OR NOT (p_code_hash = ANY(current_hashes)) THEN
    RETURN false;
  END IF;

  UPDATE public.custom_users
     SET mfa_recovery_codes_hash = array_remove(current_hashes, p_code_hash),
         mfa_last_verified_at = now()
   WHERE id = p_user_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_mfa_recovery_code(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_mfa_recovery_code(uuid, text) TO service_role;

COMMENT ON COLUMN public.custom_users.mfa_recovery_codes_hash IS
  'One-time SHA-256 recovery-code hashes bound to the user and MFA_RECOVERY_CODE_PEPPER; plaintext codes are never persisted.';
COMMENT ON FUNCTION public.consume_mfa_recovery_code(uuid, text) IS
  'Atomically consumes exactly one MFA recovery-code hash. Service-role Edge Function use only.';
