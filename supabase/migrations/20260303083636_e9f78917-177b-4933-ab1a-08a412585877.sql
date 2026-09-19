
-- ============================================================
-- BATCH 3: Saved Playbooks & Scheduled Tasks tables
-- ============================================================

-- Saved Playbooks: reusable multi-step sequences
CREATE TABLE public.agent_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📋',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_public BOOLEAN DEFAULT false,
  run_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own and public playbooks"
  ON public.agent_playbooks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR is_public = true);

CREATE POLICY "Users can create own playbooks"
  ON public.agent_playbooks FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own playbooks"
  ON public.agent_playbooks FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own playbooks"
  ON public.agent_playbooks FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_agent_playbooks_updated_at
  BEFORE UPDATE ON public.agent_playbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Scheduled Tasks: run playbooks or single tools on a schedule
CREATE TABLE public.agent_scheduled_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL DEFAULT 'playbook', -- 'playbook' | 'single_tool'
  playbook_id UUID REFERENCES public.agent_playbooks(id) ON DELETE SET NULL,
  tool_name TEXT,
  tool_arguments JSONB,
  schedule_cron TEXT NOT NULL, -- cron expression
  schedule_description TEXT, -- human readable
  is_enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT, -- 'success' | 'error' | 'partial'
  last_run_result JSONB,
  next_run_at TIMESTAMPTZ,
  run_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_scheduled_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own scheduled tasks"
  ON public.agent_scheduled_tasks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own scheduled tasks"
  ON public.agent_scheduled_tasks FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own scheduled tasks"
  ON public.agent_scheduled_tasks FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own scheduled tasks"
  ON public.agent_scheduled_tasks FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_agent_scheduled_tasks_updated_at
  BEFORE UPDATE ON public.agent_scheduled_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
