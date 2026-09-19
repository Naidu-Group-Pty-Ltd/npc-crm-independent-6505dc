-- Reset the stuck report to pending so it can be retried with progressive saving
UPDATE investment_reports 
SET status = 'pending', 
    report_content = 'Generating...',
    error_message = NULL,
    updated_at = now() 
WHERE id = 'a75fd64f-b8dc-4f57-9648-46a48e6f9515';