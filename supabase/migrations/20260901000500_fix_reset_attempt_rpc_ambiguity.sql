-- Password reset has never worked in the Solicitor Portal, and does not work in
-- the Finance Portal either. Both `consume_*_portal_reset_attempt` functions
-- raise on every call:
--
--   ERROR:  42702: column reference "reset_token" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- `RETURNS TABLE(status text, reset_token text, ...)` declares `reset_token` as
-- an OUT parameter, which inside the body is a PL/pgSQL variable with exactly
-- the name of the column the statement filters on. The RETURNING list was
-- qualified — `solicitor_portal_users.reset_token` — but the sub-select's
-- `WHERE ... AND reset_token IS NOT NULL` was not, so Postgres cannot tell
-- which one is meant and refuses the whole statement.
--
-- The failure is invisible from the outside because of what the caller does
-- with it: the edge function treats any RPC error the same as an unknown
-- account and answers "Invalid or expired code". So a solicitor who types a
-- correct code, seconds after receiving it, is told the code is wrong. The
-- attempt counter never moves either — the raise happens before the UPDATE
-- commits — which is what proves no verification has ever reached the
-- comparison: rugesh@npcservices.com.au had reset_attempts = 0 after two
-- requested codes and a run of failed verifications.
--
-- The Client Portal's function is unaffected (its column is
-- `password_reset_token`, so no name collides) and the Builder Portal's is
-- already fully aliased. Both are left alone.
--
-- The fix is to alias the table and qualify every column reference, the shape
-- the Builder function already uses. `#variable_conflict use_column` would also
-- silence it, but silencing an ambiguity is not the same as removing it: the
-- next OUT parameter that collides would resolve quietly and wrongly instead of
-- raising.

-- ===========================================================================
-- 1. Solicitor Portal
--
-- The return type gains `invite_accepted_at`, which the reset endpoint has been
-- reading off this result all along — `user.invite_accepted_at` was always
-- undefined, so every completed reset rewrote the invite columns as though the
-- invitation had just been accepted. Changing a RETURNS TABLE shape needs a
-- DROP; nothing depends on this function.
-- ===========================================================================
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
  -- Every reference is qualified. `s.reset_token`, `s.firm_id` and
  -- `s.invite_accepted_at` all share a name with an OUT parameter above.
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

-- ===========================================================================
-- 2. Finance Portal — same defect, same fix, unchanged signature
-- ===========================================================================
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

-- ===========================================================================
-- 3. Prove both functions can actually be called
--
-- The defect was a runtime parse error inside the body, so it was invisible to
-- everything except an execution. An address that matches no account exercises
-- the ambiguous statement and returns 'not_found' without touching a row, so
-- this is safe to run against production and would have caught the bug on the
-- day it shipped.
-- ===========================================================================
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
