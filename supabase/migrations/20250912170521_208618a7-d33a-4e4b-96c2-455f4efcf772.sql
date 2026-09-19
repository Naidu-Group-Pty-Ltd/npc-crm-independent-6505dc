-- Create investment reports table
CREATE TABLE public.investment_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_address TEXT NOT NULL,
  property_listing_id TEXT,
  report_content TEXT NOT NULL,
  generated_by UUID REFERENCES auth.users,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.investment_reports ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own investment reports" 
ON public.investment_reports 
FOR SELECT 
USING (auth.uid() = generated_by);

CREATE POLICY "Users can create their own investment reports" 
ON public.investment_reports 
FOR INSERT 
WITH CHECK (auth.uid() = generated_by);

CREATE POLICY "Users can update their own investment reports" 
ON public.investment_reports 
FOR UPDATE 
USING (auth.uid() = generated_by);

CREATE POLICY "Users can delete their own investment reports" 
ON public.investment_reports 
FOR DELETE 
USING (auth.uid() = generated_by);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_investment_reports_updated_at
BEFORE UPDATE ON public.investment_reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();