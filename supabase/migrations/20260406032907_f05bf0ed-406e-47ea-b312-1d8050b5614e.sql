
-- Create marketing_report_schedules table
CREATE TABLE public.marketing_report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  pipeline_id TEXT NOT NULL,
  pipeline_name TEXT,
  stage_id TEXT,
  stage_name TEXT,
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'fortnightly', 'monthly', 'ad_hoc')),
  mailbox_source TEXT NOT NULL DEFAULT 'admin' CHECK (mailbox_source IN ('admin', 'personal')),
  sender_mailbox_email TEXT,
  email_subject_template TEXT NOT NULL DEFAULT 'Your Market Intelligence Report — {{report_period}}',
  email_body_template TEXT NOT NULL DEFAULT 'Please find attached the latest Market Intelligence Report, providing a comprehensive analysis of the Australian property market including interest rate movements, housing market data, economic indicators, and strategic outlook.',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  next_scheduled_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.custom_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create marketing_report_distribution_log table
CREATE TABLE public.marketing_report_distribution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID REFERENCES public.marketing_report_schedules(id) ON DELETE SET NULL,
  report_id UUID REFERENCES public.marketing_intelligence_reports(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  ghl_contact_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.marketing_report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_report_distribution_log ENABLE ROW LEVEL SECURITY;

-- Service role only policies (consistent with existing pattern)
CREATE POLICY "Service role full access on schedules"
  ON public.marketing_report_schedules FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on distribution log"
  ON public.marketing_report_distribution_log FOR ALL
  USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_schedules_enabled ON public.marketing_report_schedules(is_enabled, next_scheduled_at);
CREATE INDEX idx_distribution_log_schedule ON public.marketing_report_distribution_log(schedule_id, created_at DESC);
CREATE INDEX idx_distribution_log_status ON public.marketing_report_distribution_log(status, created_at DESC);

-- Updated at trigger
CREATE TRIGGER update_marketing_report_schedules_updated_at
  BEFORE UPDATE ON public.marketing_report_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
