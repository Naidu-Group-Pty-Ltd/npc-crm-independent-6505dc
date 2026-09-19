-- Update existing pending reports that have content to completed status
UPDATE investment_reports 
SET status = 'completed'
WHERE status = 'pending' 
  AND report_content IS NOT NULL 
  AND LENGTH(report_content) > 100;

-- Create a trigger function to automatically set status to completed when report_content is added
CREATE OR REPLACE FUNCTION public.auto_complete_investment_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If report_content is being added/updated and has substantial content, mark as completed
  IF NEW.report_content IS NOT NULL 
     AND LENGTH(NEW.report_content) > 100 
     AND (OLD.status = 'pending' OR OLD.status IS NULL) 
  THEN
    NEW.status := 'completed';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to auto-complete reports when content is added
DROP TRIGGER IF EXISTS trigger_auto_complete_report ON investment_reports;
CREATE TRIGGER trigger_auto_complete_report
  BEFORE INSERT OR UPDATE ON investment_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_complete_investment_report();