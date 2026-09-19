-- WP-11C P1: recent-reauth proofs are valid only for the staff session that
-- issued them. Existing unbound proofs intentionally fail closed at runtime.
ALTER TABLE public.step_up_sessions
  ADD COLUMN IF NOT EXISTS bound_session_id uuid
  REFERENCES public.user_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_step_up_sessions_bound_active
  ON public.step_up_sessions(bound_session_id, expires_at)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_step_up_session_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_sessions session
    WHERE session.id = NEW.bound_session_id
      AND session.user_id = NEW.user_id
      AND session.portal_scope = 'staff'
  ) THEN
    RAISE EXCEPTION 'step-up session must be bound to the owning staff session';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_step_up_session_owner ON public.step_up_sessions;
CREATE TRIGGER enforce_step_up_session_owner
  BEFORE INSERT OR UPDATE OF user_id, bound_session_id ON public.step_up_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_step_up_session_owner();

REVOKE ALL ON FUNCTION public.enforce_step_up_session_owner() FROM PUBLIC;
