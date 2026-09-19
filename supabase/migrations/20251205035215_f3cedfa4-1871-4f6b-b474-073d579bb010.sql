-- Auto Report Master Settings (single row for master toggle)
CREATE TABLE public.auto_report_master_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.custom_users(id)
);

-- Auto Report Switches (individual filter rules)
CREATE TABLE public.auto_report_switches (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  is_enabled boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 0,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.custom_users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Auto Report Generation Log (audit trail)
CREATE TABLE public.auto_report_generation_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id text NOT NULL,
  listing_address text NOT NULL,
  switch_id uuid REFERENCES public.auto_report_switches(id),
  switch_name text,
  report_id uuid REFERENCES public.investment_reports(id),
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone
);

-- Enable RLS
ALTER TABLE public.auto_report_master_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_report_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_report_generation_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for master settings
CREATE POLICY "Anyone can view master settings" ON public.auto_report_master_settings FOR SELECT USING (true);
CREATE POLICY "Service role can manage master settings" ON public.auto_report_master_settings FOR ALL USING (true);

-- RLS Policies for switches
CREATE POLICY "Anyone can view switches" ON public.auto_report_switches FOR SELECT USING (true);
CREATE POLICY "Anyone can create switches" ON public.auto_report_switches FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update switches" ON public.auto_report_switches FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete switches" ON public.auto_report_switches FOR DELETE USING (true);

-- RLS Policies for generation log
CREATE POLICY "Anyone can view generation log" ON public.auto_report_generation_log FOR SELECT USING (true);
CREATE POLICY "Service role can manage generation log" ON public.auto_report_generation_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update generation log" ON public.auto_report_generation_log FOR UPDATE USING (true);

-- Trigger for updated_at on switches
CREATE TRIGGER update_auto_report_switches_updated_at
  BEFORE UPDATE ON public.auto_report_switches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default master settings row (disabled by default)
INSERT INTO public.auto_report_master_settings (is_enabled) VALUES (false);

-- Add comments for documentation
COMMENT ON TABLE public.auto_report_master_settings IS 'Master toggle for the auto-generation switchbot system';
COMMENT ON TABLE public.auto_report_switches IS 'Individual filter switches with criteria for auto-generating investment reports';
COMMENT ON TABLE public.auto_report_generation_log IS 'Audit log tracking which listings triggered auto-generation and by which switch';
COMMENT ON COLUMN public.auto_report_switches.criteria IS 'JSONB containing filter criteria: propertyTypes, priceMin, priceMax, bedsMin, bedsMax, bathsMin, bathsMax, states, categories, confidenceMin, hasPrice, sourceHosts';