-- Clear all related records first
DELETE FROM auto_report_processed_listings 
WHERE report_id IN (
  SELECT id FROM investment_reports 
  WHERE status IN ('pending', 'processing')
);

DELETE FROM auto_report_generation_log 
WHERE report_id IN (
  SELECT id FROM investment_reports 
  WHERE status IN ('pending', 'processing')
);

DELETE FROM bulk_generation_items 
WHERE report_id IN (
  SELECT id FROM investment_reports 
  WHERE status IN ('pending', 'processing')
);

-- Now delete the pending/processing investment reports
DELETE FROM investment_reports 
WHERE status IN ('pending', 'processing');