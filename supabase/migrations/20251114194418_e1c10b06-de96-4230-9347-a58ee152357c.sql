-- Create comparison analysis templates table
CREATE TABLE public.comparison_analysis_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings JSONB NOT NULL,
  created_by UUID REFERENCES public.custom_users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.comparison_analysis_templates ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view all templates
CREATE POLICY "All users can view all comparison templates"
  ON public.comparison_analysis_templates
  FOR SELECT
  TO authenticated
  USING (true);

-- All authenticated users can create templates
CREATE POLICY "All users can create comparison templates"
  ON public.comparison_analysis_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Users can update their own templates
CREATE POLICY "Users can update their own comparison templates"
  ON public.comparison_analysis_templates
  FOR UPDATE
  TO authenticated
  USING (created_by IS NOT NULL AND created_by IN (SELECT id FROM public.custom_users WHERE id::text = auth.uid()::text))
  WITH CHECK (created_by IS NOT NULL AND created_by IN (SELECT id FROM public.custom_users WHERE id::text = auth.uid()::text));

-- Users can delete their own templates
CREATE POLICY "Users can delete their own comparison templates"
  ON public.comparison_analysis_templates
  FOR DELETE
  TO authenticated
  USING (created_by IS NOT NULL AND created_by IN (SELECT id FROM public.custom_users WHERE id::text = auth.uid()::text));

-- Add trigger to auto-update updated_at
CREATE TRIGGER update_comparison_analysis_templates_updated_at
  BEFORE UPDATE ON public.comparison_analysis_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries
CREATE INDEX idx_comparison_templates_created_by ON public.comparison_analysis_templates(created_by);
CREATE INDEX idx_comparison_templates_created_at ON public.comparison_analysis_templates(created_at DESC);