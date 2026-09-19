-- Create table for cash flow comparison analyses
CREATE TABLE public.cash_flow_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  primary_report_id UUID NOT NULL REFERENCES public.investment_reports(id) ON DELETE CASCADE,
  comparison_report_ids UUID[] NOT NULL DEFAULT '{}',
  analysis_data JSONB NOT NULL,
  investor_profile TEXT DEFAULT 'balanced',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.custom_users(id)
);

-- Enable RLS
ALTER TABLE public.cash_flow_analyses ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Anyone can view cash flow analyses" 
ON public.cash_flow_analyses 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can create cash flow analyses" 
ON public.cash_flow_analyses 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update cash flow analyses" 
ON public.cash_flow_analyses 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete cash flow analyses" 
ON public.cash_flow_analyses 
FOR DELETE 
USING (true);

-- Add index for faster lookups
CREATE INDEX idx_cash_flow_analyses_primary_report ON public.cash_flow_analyses(primary_report_id);

-- Trigger for updated_at
CREATE TRIGGER update_cash_flow_analyses_updated_at
BEFORE UPDATE ON public.cash_flow_analyses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();