-- P1 WP-11C: one-time proof consumption for highly sensitive capabilities.
ALTER TABLE public.step_up_sessions ADD COLUMN IF NOT EXISTS consumed_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_step_up_sessions_active ON public.step_up_sessions(user_id, capability, expires_at) WHERE revoked_at IS NULL AND consumed_at IS NULL;
