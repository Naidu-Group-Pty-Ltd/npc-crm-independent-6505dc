-- Drop the existing call_status check constraint
ALTER TABLE public.vapi_call_logs DROP CONSTRAINT IF EXISTS vapi_call_logs_call_status_check;

-- Add expanded check constraint with more Vapi statuses
ALTER TABLE public.vapi_call_logs ADD CONSTRAINT vapi_call_logs_call_status_check 
CHECK (call_status = ANY (ARRAY['queued'::text, 'ringing'::text, 'in-progress'::text, 'forwarding'::text, 'ended'::text, 'scheduled'::text]));

-- Delete the test record with dummy data
DELETE FROM public.vapi_call_logs WHERE vapi_call_id = 'test-123';