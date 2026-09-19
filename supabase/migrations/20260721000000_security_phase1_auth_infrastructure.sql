-- Security Remediation Phase 1/6 supporting infrastructure (additive only)
-- - internal_request_nonces: replay defence for the internal HMAC envelope (AUTH-002)
-- - security_events: attributable privileged-action audit log (LOG-001)
-- - lockout columns for staff + client portal logins (ABUSE-001 / F-05)
-- - attempt counters for reset tokens (ABUSE-003 / F-06)
-- - owner binding for synced personal emails (MAIL-003 / F-03)

-- Internal request nonce store (single-use, short-lived)
CREATE TABLE IF NOT EXISTS public.internal_request_nonces (
  nonce text PRIMARY KEY,
  caller_function text,
  seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.internal_request_nonces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS internal_request_nonces_service_only ON public.internal_request_nonces;
CREATE POLICY internal_request_nonces_service_only
  ON public.internal_request_nonces FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.internal_request_nonces FROM anon, authenticated;

-- Security events audit log (no secrets / tokens / message bodies)
CREATE TABLE IF NOT EXISTS public.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  correlation_id text,
  actor_type text NOT NULL DEFAULT 'unknown',
  actor_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  decision text NOT NULL CHECK (decision IN ('allow','deny')),
  reason_code text,
  metadata_redacted jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS security_events_occurred_at_idx ON public.security_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS security_events_action_idx ON public.security_events (action, decision);
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_events_service_only ON public.security_events;
CREATE POLICY security_events_service_only
  ON public.security_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.security_events FROM anon, authenticated;

-- Staff login lockout (parity with finance portal)
ALTER TABLE public.custom_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- Client portal login lockout + reset attempt limiting
ALTER TABLE public.client_portal_users
  ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_attempts integer NOT NULL DEFAULT 0;

-- Staff OTP reset attempt limiting (tokens become hashed at rest in code)
ALTER TABLE public.password_reset_tokens
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

-- Finance portal OTP reset attempt limiting
ALTER TABLE public.finance_portal_users
  ADD COLUMN IF NOT EXISTS reset_token_attempts integer NOT NULL DEFAULT 0;

-- Owner binding for synced emails (personal mailbox isolation)
ALTER TABLE public.email_copilot_emails
  ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE public.email_copilot_sent_replies
  ADD COLUMN IF NOT EXISTS owner_user_id uuid;

-- Backfill: attribute existing personal-mailbox emails to their syncing user
UPDATE public.email_copilot_emails
   SET owner_user_id = created_by
 WHERE owner_user_id IS NULL
   AND mailbox_source = 'personal'
   AND created_by IS NOT NULL;
