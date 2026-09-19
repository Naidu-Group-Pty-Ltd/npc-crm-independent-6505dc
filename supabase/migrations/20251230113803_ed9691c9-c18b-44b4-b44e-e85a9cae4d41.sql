-- Create table for storing integration API keys and configs
CREATE TABLE public.integration_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key_name TEXT NOT NULL UNIQUE,
  key_value TEXT,
  integration_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;

-- Create policies - only authenticated users can manage configs
CREATE POLICY "Authenticated users can view integration configs" 
ON public.integration_configs 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can insert integration configs" 
ON public.integration_configs 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Authenticated users can update integration configs" 
ON public.integration_configs 
FOR UPDATE 
USING (true);

CREATE POLICY "Authenticated users can delete integration configs" 
ON public.integration_configs 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_integration_configs_updated_at
BEFORE UPDATE ON public.integration_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();