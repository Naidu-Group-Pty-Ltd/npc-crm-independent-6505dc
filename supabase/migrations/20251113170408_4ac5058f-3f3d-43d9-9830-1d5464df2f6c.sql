-- Create property_comparisons table to store multi-property analysis results
CREATE TABLE IF NOT EXISTS public.property_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_ids TEXT[] NOT NULL,
  property_count INTEGER NOT NULL,
  created_by UUID REFERENCES custom_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Comparison results
  analysis_summary TEXT,
  executive_summary TEXT,
  rankings JSONB,
  financial_comparison JSONB,
  location_comparison JSONB,
  risk_comparison JSONB,
  investor_matches JSONB,
  recommendations JSONB,
  red_flags JSONB,
  
  -- Metadata
  analysis_depth TEXT DEFAULT 'comprehensive',
  investor_profile TEXT,
  model_used TEXT DEFAULT 'google/gemini-2.5-flash',
  processing_time_ms INTEGER
);

-- Enable RLS
ALTER TABLE public.property_comparisons ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own comparisons"
  ON public.property_comparisons
  FOR SELECT
  USING (auth.uid() = created_by OR created_by IS NULL);

CREATE POLICY "Users can create comparisons"
  ON public.property_comparisons
  FOR INSERT
  WITH CHECK (auth.uid() = created_by OR created_by IS NULL);

CREATE POLICY "Users can update their own comparisons"
  ON public.property_comparisons
  FOR UPDATE
  USING (auth.uid() = created_by OR created_by IS NULL);

CREATE POLICY "Users can delete their own comparisons"
  ON public.property_comparisons
  FOR DELETE
  USING (auth.uid() = created_by OR created_by IS NULL);

-- Create index for faster queries
CREATE INDEX idx_property_comparisons_created_by ON public.property_comparisons(created_by);
CREATE INDEX idx_property_comparisons_created_at ON public.property_comparisons(created_at DESC);

-- Add trigger for updated_at
CREATE TRIGGER update_property_comparisons_updated_at
  BEFORE UPDATE ON public.property_comparisons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.property_comparisons IS 'Stores AI-powered qualitative comparisons of multiple investment properties';