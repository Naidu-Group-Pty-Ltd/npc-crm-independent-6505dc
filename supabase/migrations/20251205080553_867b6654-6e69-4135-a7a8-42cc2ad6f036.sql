-- First clear the generation log that references the reports
TRUNCATE TABLE auto_report_generation_log;

-- Then delete all auto-generated investment reports
DELETE FROM investment_reports WHERE property_listing_id IS NOT NULL;