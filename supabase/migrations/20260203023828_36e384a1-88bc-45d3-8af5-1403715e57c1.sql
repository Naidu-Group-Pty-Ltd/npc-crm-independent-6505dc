-- Delete call logs with unknown/anonymous/empty contact names and no phone numbers
-- This cleans up legacy data that was captured before proper contact syncing was in place

DELETE FROM public.vapi_call_logs
WHERE (
  -- Match various forms of unknown/anonymous/empty names
  LOWER(TRIM(COALESCE(customer_name, ''))) IN ('unknown', 'anonymous', 'unknown caller', '')
  OR customer_name IS NULL
)
AND (
  -- Only delete if phone number is also missing/empty
  phone_number IS NULL 
  OR TRIM(phone_number) = ''
);