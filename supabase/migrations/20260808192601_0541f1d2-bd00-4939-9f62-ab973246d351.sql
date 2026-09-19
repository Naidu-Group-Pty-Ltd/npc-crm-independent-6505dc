CREATE TABLE IF NOT EXISTS public.report_default_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  data_uri TEXT NOT NULL,
  byte_length INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.report_default_assets TO service_role;

ALTER TABLE public.report_default_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages report default assets"
  ON public.report_default_assets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_report_default_assets_updated_at ON public.report_default_assets;
CREATE TRIGGER update_report_default_assets_updated_at
  BEFORE UPDATE ON public.report_default_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();