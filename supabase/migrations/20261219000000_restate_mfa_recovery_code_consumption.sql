-- Restates `20260724050000`: the RPC that spends one MFA recovery code.
--
-- `security-step-up` spends a recovery code through
-- `admin.rpc('consume_mfa_recovery_code', …)`. The prime applied that function
-- on 21 Sep 2026 and still holds it, and the CRM clone received it. The three
-- mirror clones (`npc-client-dashboard`, `npc-test-76b3b3`,
-- `preflight-property-group`) never ran it, so on them a recovery code cannot
-- be spent. Measured 23 Sep 2026 against each catalogue, not against a ledger.
--
-- Why a new version and not the old one: each mirror's ledger carries a
-- Mission Control stamp for `20260724050000`, written on 2 and 12 Sep, which
-- says the prime lacked the file too and so no clone may be sent it. The
-- prime's 21 Sep apply made that note false, but Mission Control treats a
-- stamp as permanent and will never send the file. A version no ledger has
-- seen is the one route that reaches every clone, and it needs nobody to edit
-- a stamp by hand.
--
-- The definition, grants and comments are exactly those of `20260724050000`,
-- the file `check-mfa-recovery-code-lifecycle.mjs` reads. On the prime and the
-- CRM clone this re-creates what they already run. Every statement is
-- idempotent. The file creates a function, so `migration-drift` checks it by
-- object and it declares no `@effect` probe.
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
