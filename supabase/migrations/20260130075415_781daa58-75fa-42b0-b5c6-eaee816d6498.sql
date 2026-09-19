-- Delete failed/pending condensed report attempts from recent days
DELETE FROM investment_reports 
WHERE report_tier IN ('briefing', 'snapshot') 
AND status IN ('pending', 'failed')
AND created_at > NOW() - INTERVAL '7 days';