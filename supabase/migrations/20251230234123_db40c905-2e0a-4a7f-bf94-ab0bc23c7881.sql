-- Phase 1-5: All new tables for client management enhancements

-- Client Tags table
CREATE TABLE public.client_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.custom_users(id)
);

-- Client to Tags junction table
CREATE TABLE public.client_tag_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.client_tags(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES public.custom_users(id),
  UNIQUE(client_id, tag_id)
);

-- Client Reminders table
CREATE TABLE public.client_reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'snoozed', 'cancelled')),
  reminder_type TEXT NOT NULL DEFAULT 'follow_up' CHECK (reminder_type IN ('follow_up', 'review', 'call', 'meeting', 'document', 'other')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES public.custom_users(id)
);

-- Client Scores table (for smart scoring)
CREATE TABLE public.client_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE UNIQUE,
  overall_score INTEGER NOT NULL DEFAULT 0 CHECK (overall_score >= 0 AND overall_score <= 100),
  portfolio_health INTEGER NOT NULL DEFAULT 0 CHECK (portfolio_health >= 0 AND portfolio_health <= 100),
  cash_flow_score INTEGER NOT NULL DEFAULT 0 CHECK (cash_flow_score >= 0 AND cash_flow_score <= 100),
  growth_potential INTEGER NOT NULL DEFAULT 0 CHECK (growth_potential >= 0 AND growth_potential <= 100),
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  risk_factors JSONB DEFAULT '[]'::jsonb,
  last_calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  calculation_notes TEXT
);

-- Client Files table
CREATE TABLE public.client_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'contract', 'id', 'financial', 'property', 'correspondence', 'other')),
  description TEXT,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES public.custom_users(id)
);

-- Client Activity Timeline (extends activity_logs concept)
CREATE TABLE public.client_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('note_added', 'file_uploaded', 'reminder_created', 'reminder_completed', 'tag_added', 'tag_removed', 'property_added', 'property_updated', 'score_updated', 'contact_made', 'meeting', 'email_sent', 'status_changed', 'custom')),
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.custom_users(id)
);

-- Enable RLS on all tables
ALTER TABLE public.client_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_activities ENABLE ROW LEVEL SECURITY;

-- RLS Policies for client_tags
CREATE POLICY "Allow all access to client_tags" ON public.client_tags FOR ALL USING (true);

-- RLS Policies for client_tag_assignments
CREATE POLICY "Allow all access to client_tag_assignments" ON public.client_tag_assignments FOR ALL USING (true);

-- RLS Policies for client_reminders
CREATE POLICY "Allow all access to client_reminders" ON public.client_reminders FOR ALL USING (true);

-- RLS Policies for client_scores
CREATE POLICY "Allow all access to client_scores" ON public.client_scores FOR ALL USING (true);

-- RLS Policies for client_files
CREATE POLICY "Allow all access to client_files" ON public.client_files FOR ALL USING (true);

-- RLS Policies for client_activities
CREATE POLICY "Allow all access to client_activities" ON public.client_activities FOR ALL USING (true);

-- Indexes for performance
CREATE INDEX idx_client_tag_assignments_client ON public.client_tag_assignments(client_id);
CREATE INDEX idx_client_tag_assignments_tag ON public.client_tag_assignments(tag_id);
CREATE INDEX idx_client_reminders_client ON public.client_reminders(client_id);
CREATE INDEX idx_client_reminders_due_date ON public.client_reminders(due_date);
CREATE INDEX idx_client_reminders_status ON public.client_reminders(status);
CREATE INDEX idx_client_scores_client ON public.client_scores(client_id);
CREATE INDEX idx_client_files_client ON public.client_files(client_id);
CREATE INDEX idx_client_activities_client ON public.client_activities(client_id);
CREATE INDEX idx_client_activities_created ON public.client_activities(created_at DESC);

-- Triggers for updated_at
CREATE TRIGGER update_client_reminders_updated_at
  BEFORE UPDATE ON public.client_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert some default tags
INSERT INTO public.client_tags (name, color, description) VALUES
  ('VIP', '#EF4444', 'High-value priority clients'),
  ('New Lead', '#3B82F6', 'Recently acquired leads'),
  ('Active Investor', '#10B981', 'Currently investing clients'),
  ('Under Review', '#F59E0B', 'Clients under portfolio review'),
  ('High Potential', '#8B5CF6', 'High growth potential clients');