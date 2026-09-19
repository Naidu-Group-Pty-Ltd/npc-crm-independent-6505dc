-- Fix historical calls stuck with 'ringing' or 'in-progress' status
-- These calls have ended but their status was never updated

-- Update all calls that have ended_at timestamp but still show as ringing/in-progress
UPDATE public.vapi_call_logs 
SET call_status = 'ended'
WHERE call_status IN ('ringing', 'in-progress', 'queued')
  AND ended_at IS NOT NULL;

-- Update all remaining calls with these statuses that are older than 1 hour
-- (any call stuck in ringing/in-progress for over an hour is definitely ended)
UPDATE public.vapi_call_logs 
SET call_status = 'ended'
WHERE call_status IN ('ringing', 'in-progress', 'queued')
  AND started_at IS NOT NULL
  AND started_at < NOW() - INTERVAL '1 hour';