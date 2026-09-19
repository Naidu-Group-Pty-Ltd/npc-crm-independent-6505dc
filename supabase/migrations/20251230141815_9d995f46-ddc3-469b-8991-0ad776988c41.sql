-- Create table for global report settings (contact details, disclaimers, etc.)
CREATE TABLE public.global_report_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key text NOT NULL UNIQUE,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.global_report_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for access
CREATE POLICY "Anyone can view global report settings" 
ON public.global_report_settings 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can insert global report settings" 
ON public.global_report_settings 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update global report settings" 
ON public.global_report_settings 
FOR UPDATE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_global_report_settings_updated_at
BEFORE UPDATE ON public.global_report_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings
INSERT INTO public.global_report_settings (setting_key, setting_value) VALUES
('contact_details', '{
  "company_name": "",
  "phone": "",
  "email": "",
  "website": "",
  "address": "",
  "abn": ""
}'::jsonb),
('professional_disclaimer', '{
  "text": "This report is provided for general information purposes only and does not constitute financial, legal, or professional advice. The information contained herein has been obtained from sources believed to be reliable, but accuracy cannot be guaranteed. Readers should seek independent professional advice before making any investment decisions.",
  "is_enabled": true
}'::jsonb);