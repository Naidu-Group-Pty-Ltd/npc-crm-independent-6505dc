-- Create portfolio analysis templates table for storing configuration presets
CREATE TABLE public.portfolio_analysis_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_by UUID REFERENCES public.custom_users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add comment describing the settings structure
COMMENT ON COLUMN public.portfolio_analysis_templates.settings IS 'JSON structure: { riskTolerance, investmentStrategy, timeHorizon, projectionPeriod, growthRateAssumption, interestRateScenario, equityStrategy, debtReductionPriority, nextPropertyPreference, taxOptimizationPriority, retirementTimeline, marketOutlook }';

-- Enable RLS
ALTER TABLE public.portfolio_analysis_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies (service_role only pattern)
CREATE POLICY "Service role has full access to portfolio_analysis_templates"
  ON public.portfolio_analysis_templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_portfolio_analysis_templates_created_by ON public.portfolio_analysis_templates(created_by);
CREATE INDEX idx_portfolio_analysis_templates_is_default ON public.portfolio_analysis_templates(is_default) WHERE is_default = true;

-- Create trigger for updated_at
CREATE TRIGGER update_portfolio_analysis_templates_updated_at
  BEFORE UPDATE ON public.portfolio_analysis_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();