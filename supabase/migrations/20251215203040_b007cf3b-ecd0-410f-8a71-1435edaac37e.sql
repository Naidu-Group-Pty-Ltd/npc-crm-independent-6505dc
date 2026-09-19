-- Add tags column to vapi_call_logs
ALTER TABLE public.vapi_call_logs 
ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

-- Create call_tags table for predefined tags
CREATE TABLE IF NOT EXISTS public.call_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT 'gray',
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create call_alert_rules table
CREATE TABLE IF NOT EXISTS public.call_alert_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  condition_type text NOT NULL, -- 'sentiment', 'duration', 'outcome', 'cost'
  condition_operator text NOT NULL, -- 'equals', 'greater_than', 'less_than', 'contains'
  condition_value text NOT NULL,
  is_positive boolean NOT NULL DEFAULT false, -- true for positive alerts, false for negative
  is_enabled boolean NOT NULL DEFAULT true,
  notification_type text NOT NULL DEFAULT 'toast', -- 'toast', 'email', 'both'
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create call_alert_history table
CREATE TABLE IF NOT EXISTS public.call_alert_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id uuid REFERENCES public.call_alert_rules(id) ON DELETE CASCADE,
  call_id uuid REFERENCES public.vapi_call_logs(id) ON DELETE CASCADE,
  rule_name text NOT NULL,
  message text NOT NULL,
  is_positive boolean NOT NULL DEFAULT false,
  is_read boolean NOT NULL DEFAULT false,
  triggered_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.call_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_alert_history ENABLE ROW LEVEL SECURITY;

-- RLS policies for call_tags
CREATE POLICY "Anyone can view call tags" ON public.call_tags FOR SELECT USING (true);
CREATE POLICY "Anyone can manage call tags" ON public.call_tags FOR ALL USING (true);

-- RLS policies for call_alert_rules
CREATE POLICY "Anyone can view alert rules" ON public.call_alert_rules FOR SELECT USING (true);
CREATE POLICY "Anyone can manage alert rules" ON public.call_alert_rules FOR ALL USING (true);

-- RLS policies for call_alert_history
CREATE POLICY "Anyone can view alert history" ON public.call_alert_history FOR SELECT USING (true);
CREATE POLICY "Anyone can manage alert history" ON public.call_alert_history FOR ALL USING (true);

-- Insert default tags
INSERT INTO public.call_tags (name, color, description) VALUES
  ('High Priority', 'red', 'Calls requiring immediate attention'),
  ('Follow Up', 'amber', 'Calls that need follow-up'),
  ('VIP', 'purple', 'Important VIP customers'),
  ('Sales Lead', 'green', 'Potential sales opportunities'),
  ('Support', 'blue', 'Support-related calls'),
  ('Complaint', 'orange', 'Customer complaints')
ON CONFLICT (name) DO NOTHING;

-- Create index for tags search
CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_tags ON public.vapi_call_logs USING GIN(tags);