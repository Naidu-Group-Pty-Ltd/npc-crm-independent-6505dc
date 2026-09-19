DROP FUNCTION IF EXISTS public.consume_solicitor_portal_reset_attempt(text, integer);

CREATE FUNCTION public.consume_solicitor_portal_reset_attempt(
  p_email text, p_max integer
) RETURNS TABLE(
  status text, reset_token text, user_id uuid, firm_id uuid,
  invite_accepted_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_firm_id uuid;
  v_token text;
  v_expires_at timestamptz;
  v_attempts integer;
  v_invite_accepted timestamptz;
BEGIN
  UPDATE solicitor_portal_users AS s
     SET reset_attempts = COALESCE(s.reset_attempts, 0) + 1
   WHERE s.id = (
     SELECT u.id
       FROM solicitor_portal_users AS u
      WHERE u.email = lower(trim(p_email))
        AND u.reset_token IS NOT NULL
        AND u.is_active
        AND u.revoked_at IS NULL
      LIMIT 1
   )
  RETURNING s.id, s.firm_id, s.reset_token, s.reset_token_expires_at,
            s.reset_attempts, s.invite_accepted_at
       INTO v_id, v_firm_id, v_token, v_expires_at, v_attempts, v_invite_accepted;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF v_attempts > p_max THEN
    UPDATE solicitor_portal_users AS s
       SET reset_token = NULL, reset_token_expires_at = NULL
     WHERE s.id = v_id;
    RETURN QUERY SELECT 'too_many'::text, NULL::text, v_id, v_firm_id, v_invite_accepted;
    RETURN;
  END IF;

  IF v_expires_at IS NULL OR v_expires_at < now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, v_id, v_firm_id, v_invite_accepted;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'ok'::text, v_token, v_id, v_firm_id, v_invite_accepted;
END $$;

COMMENT ON FUNCTION public.consume_solicitor_portal_reset_attempt(text, integer) IS
  'Consumes one password-reset attempt and returns the stored code for comparison. Every column reference is qualified because status/reset_token/user_id/firm_id/invite_accepted_at are OUT parameters and therefore PL/pgSQL variables inside this body; an unqualified reference to any of them raises 42702 and, through the caller, becomes "Invalid or expired code" on a correct code.';

REVOKE EXECUTE ON FUNCTION public.consume_solicitor_portal_reset_attempt(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_solicitor_portal_reset_attempt(text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.consume_finance_portal_reset_attempt(
  p_email text, p_max integer
) RETURNS TABLE(status text, reset_token text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token text; v_exp timestamptz; v_attempts integer;
BEGIN
  UPDATE finance_portal_users AS f
     SET reset_token_attempts = COALESCE(f.reset_token_attempts, 0) + 1
   WHERE f.id = (
     SELECT u.id FROM finance_portal_users AS u
      WHERE u.email = lower(trim(p_email))
        AND u.reset_token IS NOT NULL
      LIMIT 1
   )
  RETURNING f.id, f.reset_token, f.reset_token_expires_at, f.reset_token_attempts
    INTO v_id, v_token, v_exp, v_attempts;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF v_attempts > p_max THEN
    UPDATE finance_portal_users AS f
       SET reset_token = NULL, reset_token_expires_at = NULL
     WHERE f.id = v_id;
    RETURN QUERY SELECT 'too_many'::text, NULL::text, v_id; RETURN;
  END IF;
  IF v_exp IS NULL OR v_exp < now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, v_id; RETURN;
  END IF;
  RETURN QUERY SELECT 'ok'::text, v_token, v_id;
END $$;

COMMENT ON FUNCTION public.consume_finance_portal_reset_attempt(text, integer) IS
  'Consumes one password-reset attempt and returns the stored token hash for comparison. Column references are qualified because reset_token is also an OUT parameter; see consume_solicitor_portal_reset_attempt.';

REVOKE EXECUTE ON FUNCTION public.consume_finance_portal_reset_attempt(text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_finance_portal_reset_attempt(text, integer)
  TO service_role;

DO $$
DECLARE
  v_status text;
  v_probe text := 'migration-probe-no-such-account@invalid.local';
BEGIN
  SELECT status INTO v_status
    FROM public.consume_solicitor_portal_reset_attempt(v_probe, 5);
  IF v_status IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: solicitor reset probe returned % for an address that cannot exist', v_status;
  END IF;

  SELECT status INTO v_status
    FROM public.consume_finance_portal_reset_attempt(v_probe, 5);
  IF v_status IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'POST-MIGRATION FAILURE: finance reset probe returned % for an address that cannot exist', v_status;
  END IF;

  RAISE NOTICE 'reset-attempt functions execute cleanly for solicitor and finance';
END $$;