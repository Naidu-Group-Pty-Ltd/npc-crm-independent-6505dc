
-- WP-11A: additive session-hardening columns. All columns are nullable so
-- existing rows (plaintext-only sessions) keep working during the migration
-- window. Backfill happens on next successful verify.

ALTER TABLE public.user_sessions
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS idle_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text,
  ADD COLUMN IF NOT EXISTS rotated_from_session_id uuid,
  ADD COLUMN IF NOT EXISTS portal_scope text NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text;

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_key
  ON public.user_sessions (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_sessions_user_active_idx
  ON public.user_sessions (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.client_portal_sessions
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS idle_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text,
  ADD COLUMN IF NOT EXISTS rotated_from_session_id uuid,
  ADD COLUMN IF NOT EXISTS portal_scope text NOT NULL DEFAULT 'client_portal',
  ADD COLUMN IF NOT EXISTS ip_address text,
  ADD COLUMN IF NOT EXISTS user_agent text;

CREATE UNIQUE INDEX IF NOT EXISTS client_portal_sessions_token_hash_key
  ON public.client_portal_sessions (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS client_portal_sessions_user_active_idx
  ON public.client_portal_sessions (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE public.finance_portal_users
  ADD COLUMN IF NOT EXISTS session_token_hash text,
  ADD COLUMN IF NOT EXISTS session_idle_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS session_revocation_reason text,
  ADD COLUMN IF NOT EXISTS session_ip_address text,
  ADD COLUMN IF NOT EXISTS session_user_agent text;

CREATE UNIQUE INDEX IF NOT EXISTS finance_portal_users_session_token_hash_key
  ON public.finance_portal_users (session_token_hash)
  WHERE session_token_hash IS NOT NULL;

COMMENT ON COLUMN public.user_sessions.token_hash IS
  'WP-11A: HMAC-SHA256(pepper, session_token). Dual-read window; plaintext session_token to be dropped after WP-11B frontend migration.';
COMMENT ON COLUMN public.client_portal_sessions.token_hash IS
  'WP-11A: HMAC-SHA256(pepper, session_token). Dual-read window; plaintext to be dropped in WP-11B.';
COMMENT ON COLUMN public.finance_portal_users.session_token_hash IS
  'WP-11A: HMAC-SHA256(pepper, session_token). Dual-read window; plaintext to be dropped in WP-11B.';
