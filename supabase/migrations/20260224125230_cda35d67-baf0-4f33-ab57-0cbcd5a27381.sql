-- Create api_usage_log table for tracking external API token/cost consumption
CREATE TABLE public.api_usage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_name TEXT NOT NULL,
  endpoint TEXT,
  request_count INTEGER NOT NULL DEFAULT 1,
  tokens_used INTEGER DEFAULT 0,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  cost_estimate_usd NUMERIC(10, 6) DEFAULT 0,
  response_time_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'success',
  model_used TEXT,
  metadata JSONB DEFAULT '{}',
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for common queries
CREATE INDEX idx_api_usage_log_service ON public.api_usage_log(service_name);
CREATE INDEX idx_api_usage_log_created_at ON public.api_usage_log(created_at DESC);
CREATE INDEX idx_api_usage_log_service_date ON public.api_usage_log(service_name, created_at DESC);
CREATE INDEX idx_api_usage_log_model ON public.api_usage_log(model_used) WHERE model_used IS NOT NULL;

-- Enable RLS (service_role only access via edge functions)
ALTER TABLE public.api_usage_log ENABLE ROW LEVEL SECURITY;

-- Service role has full access (edge functions write to this)
CREATE POLICY "Service role full access on api_usage_log"
  ON public.api_usage_log
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.api_usage_log IS 'Tracks external API usage including token consumption, costs, and model usage for OpenAI, Perplexity, Gemini, Vapi, Twilio, etc.';
