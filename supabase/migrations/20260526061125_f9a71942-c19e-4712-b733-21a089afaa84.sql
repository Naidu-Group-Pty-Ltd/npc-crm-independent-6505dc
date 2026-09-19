
ALTER TABLE public.finance_portal_handoff_tokens ALTER COLUMN finance_user_id DROP NOT NULL;
ALTER TABLE public.finance_portal_handoff_tokens ADD COLUMN IF NOT EXISTS staff_user_id uuid;
ALTER TABLE public.finance_portal_handoff_tokens DROP CONSTRAINT IF EXISTS handoff_actor_check;
ALTER TABLE public.finance_portal_handoff_tokens ADD CONSTRAINT handoff_actor_check
  CHECK ((finance_user_id IS NOT NULL AND staff_user_id IS NULL) OR (finance_user_id IS NULL AND staff_user_id IS NOT NULL));
ALTER TABLE public.client_portal_sessions ADD COLUMN IF NOT EXISTS impersonator_staff_user_id uuid;
