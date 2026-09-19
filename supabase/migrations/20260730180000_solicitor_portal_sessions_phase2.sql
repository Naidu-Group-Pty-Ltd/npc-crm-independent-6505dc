-- Solicitor cross-portal programme Phase 2: hashed, revocable multi-device sessions.
CREATE TABLE IF NOT EXISTS public.solicitor_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitor_user_id uuid NOT NULL REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  ip_hash text,
  user_agent_hash text,
  device_label text,
  legacy_migrated_at timestamptz,
  CONSTRAINT solicitor_portal_sessions_expiry_order CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS solicitor_portal_sessions_token_hash_key ON public.solicitor_portal_sessions(token_hash);
CREATE INDEX IF NOT EXISTS solicitor_portal_sessions_user_active_idx ON public.solicitor_portal_sessions(solicitor_user_id, revoked_at, absolute_expires_at DESC);
GRANT ALL ON public.solicitor_portal_sessions TO service_role;
REVOKE ALL ON public.solicitor_portal_sessions FROM anon, authenticated;
ALTER TABLE public.solicitor_portal_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS solicitor_portal_sessions_service_role_only ON public.solicitor_portal_sessions;
CREATE POLICY solicitor_portal_sessions_service_role_only ON public.solicitor_portal_sessions FOR ALL TO service_role USING (true) WITH CHECK (true);
COMMENT ON TABLE public.solicitor_portal_sessions IS 'Hash-only Solicitor Portal sessions. Raw tokens exist only during issuance and in HttpOnly cookies.';
-- Legacy user-row columns intentionally remain for one dual-read window. New issuers must never write them.
