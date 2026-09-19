-- Add Client Tracker fields to clients table
ALTER TABLE public.clients 
ADD COLUMN IF NOT EXISTS pipeline_status TEXT DEFAULT 'New Lead',
ADD COLUMN IF NOT EXISTS follow_up_date DATE,
ADD COLUMN IF NOT EXISTS borrowing_capacity NUMERIC,
ADD COLUMN IF NOT EXISTS proposed_rental_income NUMERIC,
ADD COLUMN IF NOT EXISTS equity_release NUMERIC,
ADD COLUMN IF NOT EXISTS pipeline_notes TEXT,
ADD COLUMN IF NOT EXISTS pipeline_updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Create an index for pipeline status filtering
CREATE INDEX IF NOT EXISTS idx_clients_pipeline_status ON public.clients(pipeline_status);

-- Create an index for follow-up date sorting
CREATE INDEX IF NOT EXISTS idx_clients_follow_up_date ON public.clients(follow_up_date);

-- Create a function to update pipeline_updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_pipeline_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pipeline_status IS DISTINCT FROM OLD.pipeline_status 
     OR NEW.follow_up_date IS DISTINCT FROM OLD.follow_up_date
     OR NEW.pipeline_notes IS DISTINCT FROM OLD.pipeline_notes
     OR NEW.borrowing_capacity IS DISTINCT FROM OLD.borrowing_capacity
     OR NEW.proposed_rental_income IS DISTINCT FROM OLD.proposed_rental_income
     OR NEW.equity_release IS DISTINCT FROM OLD.equity_release THEN
    NEW.pipeline_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for automatic pipeline timestamp updates
DROP TRIGGER IF EXISTS update_clients_pipeline_updated_at ON public.clients;
CREATE TRIGGER update_clients_pipeline_updated_at
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.update_pipeline_updated_at();

-- Add comment for documentation
COMMENT ON COLUMN public.clients.pipeline_status IS 'Client pipeline stage: New Lead, Discovery Call, IFC, Finance Link Issued, FA Lodged, etc.';
COMMENT ON COLUMN public.clients.follow_up_date IS 'Next scheduled follow-up date';
COMMENT ON COLUMN public.clients.borrowing_capacity IS 'Maximum borrowing capacity amount';
COMMENT ON COLUMN public.clients.proposed_rental_income IS 'Expected weekly rental income';
COMMENT ON COLUMN public.clients.equity_release IS 'Available equity release amount';
COMMENT ON COLUMN public.clients.pipeline_notes IS 'Pipeline-specific notes and activity log';