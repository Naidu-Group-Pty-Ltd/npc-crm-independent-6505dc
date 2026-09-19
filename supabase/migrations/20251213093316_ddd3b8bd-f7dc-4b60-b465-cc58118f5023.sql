-- Create table for Vapi call logs
CREATE TABLE public.vapi_call_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vapi_call_id TEXT UNIQUE NOT NULL,
  agent_id TEXT,
  agent_name TEXT,
  phone_number TEXT,
  customer_name TEXT,
  call_direction TEXT CHECK (call_direction IN ('inbound', 'outbound')),
  call_status TEXT CHECK (call_status IN ('queued', 'ringing', 'in-progress', 'forwarding', 'ended')),
  call_outcome TEXT CHECK (call_outcome IN ('completed', 'voicemail', 'no-answer', 'busy', 'failed', 'cancelled')),
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_seconds INTEGER,
  cost DECIMAL(10, 4),
  transcript TEXT,
  summary TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'mixed')),
  key_topics TEXT[],
  action_items TEXT[],
  recording_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.vapi_call_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Anyone can view call logs
CREATE POLICY "Anyone can view call logs"
ON public.vapi_call_logs
FOR SELECT
USING (true);

-- Service role can manage call logs (for webhook)
CREATE POLICY "Service role can insert call logs"
ON public.vapi_call_logs
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Service role can update call logs"
ON public.vapi_call_logs
FOR UPDATE
USING (true);

-- Create index for common queries
CREATE INDEX idx_vapi_call_logs_agent_id ON public.vapi_call_logs(agent_id);
CREATE INDEX idx_vapi_call_logs_phone_number ON public.vapi_call_logs(phone_number);
CREATE INDEX idx_vapi_call_logs_started_at ON public.vapi_call_logs(started_at DESC);
CREATE INDEX idx_vapi_call_logs_call_outcome ON public.vapi_call_logs(call_outcome);

-- Trigger for updated_at
CREATE TRIGGER update_vapi_call_logs_updated_at
BEFORE UPDATE ON public.vapi_call_logs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.vapi_call_logs;