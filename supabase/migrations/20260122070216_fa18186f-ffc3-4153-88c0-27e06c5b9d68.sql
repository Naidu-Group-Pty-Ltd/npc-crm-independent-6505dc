-- Fix the failed report's last_completed_section so it can resume properly
UPDATE investment_reports 
SET last_completed_section = 7
WHERE id = 'b3834810-8c10-4f83-a97a-997067652806' AND status = 'failed';