-- Atomically consume solicitor password-reset attempts so parallel OTP guesses
-- cannot bypass the per-token cap. The service-role edge function is the only
-- caller allowed to receive the stored token.
CREATE OR REPLACE FUNCTION public.consume_solicitor_portal_reset_attempt(
  p_email text, p_max integer
) RETURNS TABLE(status text, reset_token text, user_id uuid, firm_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_firm_id uuid;
  v_token text;
  v_expires_at timestamptz;
  v_attempts integer;
BEGIN
  UPDATE solicitor_portal_users
     SET reset_attempts = COALESCE(reset_attempts, 0) + 1
   WHERE id = (
     SELECT id
       FROM solicitor_portal_users
      WHERE email = lower(trim(p_email))
        AND reset_token IS NOT NULL
        AND is_active
        AND revoked_at IS NULL
      LIMIT 1
   )
  RETURNING id, solicitor_portal_users.firm_id, solicitor_portal_users.reset_token,
            reset_token_expires_at, reset_attempts
       INTO v_id, v_firm_id, v_token, v_expires_at, v_attempts;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF v_attempts > p_max THEN
    UPDATE solicitor_portal_users
       SET reset_token = NULL, reset_token_expires_at = NULL
     WHERE id = v_id;
    RETURN QUERY SELECT 'too_many'::text, NULL::text, v_id, v_firm_id;
    RETURN;
  END IF;

  IF v_expires_at IS NULL OR v_expires_at < now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, v_id, v_firm_id;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_token, v_id, v_firm_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.consume_solicitor_portal_reset_attempt(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_solicitor_portal_reset_attempt(text, integer)
  TO service_role;
