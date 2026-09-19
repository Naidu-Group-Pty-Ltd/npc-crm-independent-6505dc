-- Fix the most recent Wyndham Vale suburb report that was misclassified as 'address'
UPDATE investment_reports 
SET report_scope = 'suburb' 
WHERE id = '40bbe0db-bcaa-4af4-b644-42a1d5a586cc' 
AND report_scope = 'address';