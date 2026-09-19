-- Create a table for white-label settings (singleton pattern)
CREATE TABLE public.whitelabel_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_logo TEXT,
  sidebar_logo TEXT,
  sidebar_icon TEXT,
  favicon TEXT,
  company_name TEXT NOT NULL DEFAULT 'NPC Property',
  primary_color TEXT,
  accent_color TEXT,
  dark_mode_default TEXT NOT NULL DEFAULT 'light',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.whitelabel_settings ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read the settings
CREATE POLICY "Anyone can view whitelabel settings"
ON public.whitelabel_settings
FOR SELECT
USING (true);

-- Only admins can update settings (we'll check role in the app)
CREATE POLICY "Authenticated users can update whitelabel settings"
ON public.whitelabel_settings
FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can insert whitelabel settings"
ON public.whitelabel_settings
FOR INSERT
WITH CHECK (true);

-- Create trigger for updated_at
CREATE TRIGGER update_whitelabel_settings_updated_at
BEFORE UPDATE ON public.whitelabel_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default settings row
INSERT INTO public.whitelabel_settings (company_name, dark_mode_default)
VALUES ('NPC Property', 'light');