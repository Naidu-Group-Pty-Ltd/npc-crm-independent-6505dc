-- Reset the stuck report to pending status so it can be regenerated
UPDATE investment_reports 
SET status = 'pending', 
    error_message = NULL,
    updated_at = now() 
WHERE id = 'a75fd64f-b8dc-4f57-9648-46a48e6f9515';