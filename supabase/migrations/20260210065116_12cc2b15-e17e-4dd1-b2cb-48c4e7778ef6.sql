-- Remove restrictive check constraint on call_outcome to allow full VAPI endedReason values
ALTER TABLE vapi_call_logs DROP CONSTRAINT vapi_call_logs_call_outcome_check;

-- Backfill existing call_outcome values with raw VAPI endedReason from metadata
UPDATE vapi_call_logs 
SET call_outcome = metadata->>'endedReason' 
WHERE metadata->>'endedReason' IS NOT NULL 
  AND call_outcome IS DISTINCT FROM metadata->>'endedReason';