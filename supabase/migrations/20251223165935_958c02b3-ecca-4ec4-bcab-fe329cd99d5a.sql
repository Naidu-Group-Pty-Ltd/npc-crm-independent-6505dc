-- Create enums for template management
CREATE TYPE template_type AS ENUM ('ai_structure', 'pdf_layout', 'client_branding');
CREATE TYPE report_tier_enum AS ENUM ('compass', 'executive', 'snapshot');
CREATE TYPE report_category_enum AS ENUM ('investment', 'comparison', 'suburb_snapshot', 'cash_flow');

-- Main templates table for AI structure and PDF layouts
CREATE TABLE public.report_structure_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  template_type template_type NOT NULL,
  report_tier report_tier_enum,
  report_category report_category_enum,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  parsed_content TEXT,
  is_active BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.custom_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Client branding profiles table
CREATE TABLE public.client_branding_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL,
  logo_path TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  accent_color TEXT,
  header_style JSONB DEFAULT '{}'::jsonb,
  footer_style JSONB DEFAULT '{}'::jsonb,
  font_family TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.custom_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.report_structure_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_branding_profiles ENABLE ROW LEVEL SECURITY;

-- RLS policies for report_structure_templates (admin only for write, all can read)
CREATE POLICY "Anyone can view templates"
  ON public.report_structure_templates
  FOR SELECT
  USING (true);

CREATE POLICY "Admin can insert templates"
  ON public.report_structure_templates
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.custom_users
      WHERE id = created_by AND role = 'admin'
    )
  );

CREATE POLICY "Admin can update templates"
  ON public.report_structure_templates
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.custom_users
      WHERE id = created_by AND role = 'admin'
    )
  );

CREATE POLICY "Admin can delete templates"
  ON public.report_structure_templates
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.custom_users
      WHERE id = created_by AND role = 'admin'
    )
  );

-- RLS policies for client_branding_profiles (admin only for write, all can read)
CREATE POLICY "Anyone can view branding profiles"
  ON public.client_branding_profiles
  FOR SELECT
  USING (true);

CREATE POLICY "Admin can insert branding profiles"
  ON public.client_branding_profiles
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.custom_users
      WHERE id = created_by AND role = 'admin'
    )
  );

CREATE POLICY "Admin can update branding profiles"
  ON public.client_branding_profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.custom_users
      WHERE id = created_by AND role = 'admin'
    )
  );

CREATE POLICY "Admin can delete branding profiles"
  ON public.client_branding_profiles
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.custom_users
      WHERE id = created_by AND role = 'admin'
    )
  );

-- Create updated_at trigger for both tables
CREATE TRIGGER update_report_structure_templates_updated_at
  BEFORE UPDATE ON public.report_structure_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_client_branding_profiles_updated_at
  BEFORE UPDATE ON public.client_branding_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for templates
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'report-templates',
  'report-templates',
  true,
  52428800,
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/svg+xml', 'application/json']
);

-- Storage policies for report-templates bucket
CREATE POLICY "Anyone can view template files"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'report-templates');

CREATE POLICY "Authenticated users can upload template files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'report-templates');

CREATE POLICY "Authenticated users can update template files"
  ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'report-templates');

CREATE POLICY "Authenticated users can delete template files"
  ON storage.objects
  FOR DELETE
  USING (bucket_id = 'report-templates');

-- Create indexes for performance
CREATE INDEX idx_templates_type_tier ON public.report_structure_templates(template_type, report_tier);
CREATE INDEX idx_templates_active ON public.report_structure_templates(is_active) WHERE is_active = true;
CREATE INDEX idx_branding_active ON public.client_branding_profiles(is_active) WHERE is_active = true;