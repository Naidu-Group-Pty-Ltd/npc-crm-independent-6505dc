
-- Game Plans feature tables

-- Main game plan container
CREATE TABLE public.game_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '🎯',
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed', 'archived')),
  color TEXT DEFAULT '#6366f1',
  created_by TEXT,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phases within a game plan
CREATE TABLE public.game_plan_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES public.game_plans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📌',
  color TEXT DEFAULT '#8b5cf6',
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  display_order INT NOT NULL DEFAULT 0,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Milestones within phases
CREATE TABLE public.game_plan_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id UUID NOT NULL REFERENCES public.game_plan_phases(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed', 'blocked')),
  owner TEXT,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- KPI targets per phase
CREATE TABLE public.game_plan_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id UUID NOT NULL REFERENCES public.game_plan_phases(id) ON DELETE CASCADE,
  metric_name TEXT NOT NULL,
  target_value NUMERIC NOT NULL DEFAULT 0,
  current_value NUMERIC NOT NULL DEFAULT 0,
  unit TEXT DEFAULT '',
  icon TEXT DEFAULT '📊',
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notes attached to phases
CREATE TABLE public.game_plan_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id UUID NOT NULL REFERENCES public.game_plan_phases(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  note_type TEXT NOT NULL DEFAULT 'general' CHECK (note_type IN ('general', 'decision', 'risk', 'idea')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Action items (lightweight tasks)
CREATE TABLE public.game_plan_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID REFERENCES public.game_plan_milestones(id) ON DELETE CASCADE,
  phase_id UUID NOT NULL REFERENCES public.game_plan_phases(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT false,
  assigned_to TEXT,
  due_date DATE,
  completed_at TIMESTAMPTZ,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.game_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_plan_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_plan_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_plan_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_plan_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_plan_actions ENABLE ROW LEVEL SECURITY;

-- RLS policies - service_role only (matches existing pattern)
CREATE POLICY "Service role full access" ON public.game_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.game_plan_phases FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.game_plan_milestones FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.game_plan_kpis FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.game_plan_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.game_plan_actions FOR ALL USING (true) WITH CHECK (true);

-- Auto-update timestamps
CREATE TRIGGER update_game_plans_updated_at BEFORE UPDATE ON public.game_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_game_plan_phases_updated_at BEFORE UPDATE ON public.game_plan_phases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_game_plan_milestones_updated_at BEFORE UPDATE ON public.game_plan_milestones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_game_plan_kpis_updated_at BEFORE UPDATE ON public.game_plan_kpis FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_game_plan_notes_updated_at BEFORE UPDATE ON public.game_plan_notes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_game_plan_actions_updated_at BEFORE UPDATE ON public.game_plan_actions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
