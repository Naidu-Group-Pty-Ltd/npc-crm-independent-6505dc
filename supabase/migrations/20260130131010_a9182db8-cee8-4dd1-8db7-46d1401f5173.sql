-- Add columns for negative call analysis
ALTER TABLE public.vapi_call_logs 
ADD COLUMN IF NOT EXISTS root_cause_category TEXT,
ADD COLUMN IF NOT EXISTS escalation_severity INTEGER CHECK (escalation_severity >= 1 AND escalation_severity <= 5),
ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'needs_review' CHECK (resolution_status IN ('needs_review', 'reviewed', 'resolved', 'escalated')),
ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
ADD COLUMN IF NOT EXISTS negative_sentiment_moment JSONB,
ADD COLUMN IF NOT EXISTS ai_recommendations TEXT[],
ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.custom_users(id),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS recovery_priority INTEGER CHECK (recovery_priority >= 1 AND recovery_priority <= 5);

-- Add index for filtering negative/mixed sentiment calls efficiently
CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_sentiment ON public.vapi_call_logs(sentiment);
CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_resolution_status ON public.vapi_call_logs(resolution_status);
CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_escalation_severity ON public.vapi_call_logs(escalation_severity);

-- Add comment to document root cause categories
COMMENT ON COLUMN public.vapi_call_logs.root_cause_category IS 'Categories: pricing_objection, service_complaint, agent_confusion, long_hold_time, unresolved_query, technical_issue, miscommunication, customer_frustration, wrong_transfer, information_gap';