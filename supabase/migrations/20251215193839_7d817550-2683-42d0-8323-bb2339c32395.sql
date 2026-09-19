-- Add columns for Vapi Squads support
ALTER TABLE public.vapi_call_logs 
ADD COLUMN IF NOT EXISTS is_squad_call boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS squad_id text,
ADD COLUMN IF NOT EXISTS squad_name text,
ADD COLUMN IF NOT EXISTS call_intent text,
ADD COLUMN IF NOT EXISTS assistants_involved jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS handoff_sequence jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS structured_data_multi jsonb DEFAULT '[]'::jsonb;

-- Add index for squad filtering
CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_is_squad_call ON public.vapi_call_logs(is_squad_call);
CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_call_intent ON public.vapi_call_logs(call_intent);

-- Add comment for documentation
COMMENT ON COLUMN public.vapi_call_logs.is_squad_call IS 'Whether this call involved a Vapi Squad (multiple assistants)';
COMMENT ON COLUMN public.vapi_call_logs.squad_id IS 'ID of the Vapi Squad if applicable';
COMMENT ON COLUMN public.vapi_call_logs.squad_name IS 'Name of the Vapi Squad if applicable';
COMMENT ON COLUMN public.vapi_call_logs.call_intent IS 'Detected call intent (e.g., discovery_booking, strategy_booking, finance_consult)';
COMMENT ON COLUMN public.vapi_call_logs.assistants_involved IS 'Array of assistants that participated in the call with their details';
COMMENT ON COLUMN public.vapi_call_logs.handoff_sequence IS 'Array tracking the sequence of handoffs between assistants';
COMMENT ON COLUMN public.vapi_call_logs.structured_data_multi IS 'Structured data collected from each assistant in the squad';