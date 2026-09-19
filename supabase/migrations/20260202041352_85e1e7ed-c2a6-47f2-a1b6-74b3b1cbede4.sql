-- Add ghl_contact_id column to vapi_call_logs for GHL contact caching
ALTER TABLE public.vapi_call_logs 
ADD COLUMN IF NOT EXISTS ghl_contact_id text;

-- Create index for faster lookups by phone number and ghl_contact_id
CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_ghl_contact_id 
ON public.vapi_call_logs (ghl_contact_id) 
WHERE ghl_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vapi_call_logs_phone_number 
ON public.vapi_call_logs (phone_number) 
WHERE phone_number IS NOT NULL;