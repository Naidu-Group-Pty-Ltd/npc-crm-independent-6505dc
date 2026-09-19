-- Phase 6 (ABUSE-003 follow-up): make password-reset abuse controls robust.
--
-- 1. Atomic attempt consumption. The edge functions previously did a
--    read-then-write (SELECT attempts; if < max verify; on failure UPDATE
--    attempts+1). Two concurrent guesses could both read the same count and
--    slip past the limit. These functions increment and evaluate the limit in a
--    single statement, so the Nth attempt is authoritative regardless of
--    concurrency. The OTP itself is still verified in the edge function (it is
--    hashed with a server pepper the DB does not hold); the DB returns the
--    stored token only while the caller is under the attempt limit and the
--    token is unexpired.
--
-- 2. A generic fixed-window rate-limit store for the forgot-password REQUEST
--    endpoints (per-IP and per-account), so an attacker cannot pump unlimited
--    reset emails / OTP rotations.
--
-- All functions are SECURITY DEFINER, EXECUTE-restricted to service_role (the
-- edge functions call them with the service client); anon/authenticated cannot
-- invoke them directly.

-- ── Rate-limit store ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  bucket_key   text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (which bypasses RLS) touches this table.
REVOKE ALL ON public.auth_rate_limits FROM anon, authenticated;

-- Atomic fixed-window check-and-increment. Returns TRUE when the request is
-- within the limit for the current window, FALSE when it should be rejected.
CREATE OR REPLACE FUNCTION public.check_and_bump_rate_limit(
  p_key text, p_max integer, p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO auth_rate_limits (bucket_key, window_start, count, updated_at)
    VALUES (p_key, now(), 1, now())
  ON CONFLICT (bucket_key) DO UPDATE
    SET count = CASE WHEN auth_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                     THEN 1 ELSE auth_rate_limits.count + 1 END,
        window_start = CASE WHEN auth_rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
                     THEN now() ELSE auth_rate_limits.window_start END,
        updated_at = now()
  RETURNING count INTO v_count;
  RETURN v_count <= p_max;
END $$;

-- ── Atomic reset-attempt consumers ──────────────────────────────────────────
-- status: 'ok' | 'not_found' | 'too_many' | 'expired'
CREATE OR REPLACE FUNCTION public.consume_client_portal_reset_attempt(
  p_email text, p_max integer
) RETURNS TABLE(status text, reset_token text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token text; v_exp timestamptz; v_attempts integer;
BEGIN
  UPDATE client_portal_users
     SET password_reset_attempts = COALESCE(password_reset_attempts, 0) + 1
   WHERE id = (SELECT id FROM client_portal_users
                WHERE email = lower(trim(p_email)) AND password_reset_token IS NOT NULL
                LIMIT 1)
  RETURNING id, password_reset_token, password_reset_expires_at, password_reset_attempts
    INTO v_id, v_token, v_exp, v_attempts;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF v_attempts > p_max THEN
    UPDATE client_portal_users SET password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = v_id;
    RETURN QUERY SELECT 'too_many'::text, NULL::text, v_id; RETURN;
  END IF;
  IF v_exp IS NULL OR v_exp < now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, v_id; RETURN;
  END IF;
  RETURN QUERY SELECT 'ok'::text, v_token, v_id;
END $$;

CREATE OR REPLACE FUNCTION public.consume_finance_portal_reset_attempt(
  p_email text, p_max integer
) RETURNS TABLE(status text, reset_token text, user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token text; v_exp timestamptz; v_attempts integer;
BEGIN
  UPDATE finance_portal_users
     SET reset_token_attempts = COALESCE(reset_token_attempts, 0) + 1
   WHERE id = (SELECT id FROM finance_portal_users
                WHERE email = lower(trim(p_email)) AND reset_token IS NOT NULL
                LIMIT 1)
  RETURNING id, reset_token, reset_token_expires_at, reset_token_attempts
    INTO v_id, v_token, v_exp, v_attempts;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid; RETURN;
  END IF;
  IF v_attempts > p_max THEN
    UPDATE finance_portal_users SET reset_token = NULL, reset_token_expires_at = NULL WHERE id = v_id;
    RETURN QUERY SELECT 'too_many'::text, NULL::text, v_id; RETURN;
  END IF;
  IF v_exp IS NULL OR v_exp < now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, v_id; RETURN;
  END IF;
  RETURN QUERY SELECT 'ok'::text, v_token, v_id;
END $$;

-- Lock down EXECUTE: service_role only (edge functions), never client roles.
REVOKE EXECUTE ON FUNCTION public.check_and_bump_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_client_portal_reset_attempt(text,integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_finance_portal_reset_attempt(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_bump_rate_limit(text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_client_portal_reset_attempt(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_finance_portal_reset_attempt(text,integer) TO service_role;
