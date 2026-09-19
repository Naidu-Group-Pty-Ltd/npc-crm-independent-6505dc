
-- Checklist Templates: the reusable blueprints
CREATE TABLE public.checklist_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📋',
  created_by TEXT,
  is_active BOOLEAN DEFAULT true,
  -- Cron scheduling
  cron_enabled BOOLEAN DEFAULT false,
  cron_expression TEXT, -- e.g. '0 6 * * 1-5' for weekdays at 6am
  cron_description TEXT, -- human-readable e.g. 'Every weekday at 6:00 AM'
  last_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sections within a template
CREATE TABLE public.checklist_template_sections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  icon TEXT DEFAULT '▶️',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Items within a section
CREATE TABLE public.checklist_template_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES public.checklist_template_sections(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_pre_checked BOOLEAN DEFAULT false,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Generated checklist instances (from templates or cron)
CREATE TABLE public.checklist_instances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📋',
  generated_by TEXT, -- 'manual' | 'cron' | user_id
  status TEXT NOT NULL DEFAULT 'in_progress', -- 'in_progress' | 'completed' | 'archived'
  completed_at TIMESTAMPTZ,
  progress_percent INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Items within an instance (flattened with section info)
CREATE TABLE public.checklist_instance_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id UUID NOT NULL REFERENCES public.checklist_instances(id) ON DELETE CASCADE,
  section_title TEXT NOT NULL,
  section_icon TEXT DEFAULT '▶️',
  section_order INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  is_checked BOOLEAN DEFAULT false,
  checked_at TIMESTAMPTZ,
  checked_by TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_instance_items ENABLE ROW LEVEL SECURITY;

-- RLS policies (service_role bypass pattern - all access mediated via edge functions)
CREATE POLICY "Service role full access" ON public.checklist_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.checklist_template_sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.checklist_template_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.checklist_instances FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.checklist_instance_items FOR ALL USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_checklist_templates_updated_at BEFORE UPDATE ON public.checklist_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_checklist_template_sections_updated_at BEFORE UPDATE ON public.checklist_template_sections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_checklist_template_items_updated_at BEFORE UPDATE ON public.checklist_template_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_checklist_instances_updated_at BEFORE UPDATE ON public.checklist_instances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_checklist_template_sections_template_id ON public.checklist_template_sections(template_id);
CREATE INDEX idx_checklist_template_items_section_id ON public.checklist_template_items(section_id);
CREATE INDEX idx_checklist_instances_template_id ON public.checklist_instances(template_id);
CREATE INDEX idx_checklist_instances_status ON public.checklist_instances(status);
CREATE INDEX idx_checklist_instance_items_instance_id ON public.checklist_instance_items(instance_id);
