-- Mark the stale report as failed since it's been stuck for over 24 hours
UPDATE investment_reports 
SET status = 'failed', 
    error_message = 'Generation timed out after 24+ hours. Please retry.',
    updated_at = NOW()
WHERE id = '5cd36513-0c36-460f-b6f3-4627c5d757b7'
AND status = 'processing';