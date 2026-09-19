-- Create bulk generation jobs table
CREATE TABLE public.bulk_generation_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  total_reports INTEGER NOT NULL,
  completed_reports INTEGER NOT NULL DEFAULT 0,
  failed_reports INTEGER NOT NULL DEFAULT 0,
  property_ids TEXT[] NOT NULL,
  property_addresses TEXT[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT
);

-- Create bulk generation items table
CREATE TABLE public.bulk_generation_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.bulk_generation_jobs(id) ON DELETE CASCADE,
  property_listing_id TEXT NOT NULL,
  property_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  report_id UUID REFERENCES public.investment_reports(id) ON DELETE SET NULL,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  processing_time_seconds INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.bulk_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_generation_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for bulk_generation_jobs
CREATE POLICY "Users can view their own bulk jobs"
  ON public.bulk_generation_jobs
  FOR SELECT
  USING (created_by = auth.uid() OR created_by::text = auth.uid()::text);

CREATE POLICY "Users can create their own bulk jobs"
  ON public.bulk_generation_jobs
  FOR INSERT
  WITH CHECK (created_by = auth.uid() OR created_by::text = auth.uid()::text);

CREATE POLICY "Users can update their own bulk jobs"
  ON public.bulk_generation_jobs
  FOR UPDATE
  USING (created_by = auth.uid() OR created_by::text = auth.uid()::text);

CREATE POLICY "Service role can manage all bulk jobs"
  ON public.bulk_generation_jobs
  FOR ALL
  USING (true);

-- RLS Policies for bulk_generation_items
CREATE POLICY "Users can view items from their own jobs"
  ON public.bulk_generation_items
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bulk_generation_jobs
    WHERE bulk_generation_jobs.id = bulk_generation_items.job_id
    AND (bulk_generation_jobs.created_by = auth.uid() OR bulk_generation_jobs.created_by::text = auth.uid()::text)
  ));

CREATE POLICY "Users can create items for their own jobs"
  ON public.bulk_generation_items
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bulk_generation_jobs
    WHERE bulk_generation_jobs.id = bulk_generation_items.job_id
    AND (bulk_generation_jobs.created_by = auth.uid() OR bulk_generation_jobs.created_by::text = auth.uid()::text)
  ));

CREATE POLICY "Service role can manage all bulk items"
  ON public.bulk_generation_items
  FOR ALL
  USING (true);

-- Add trigger for updated_at on bulk_generation_jobs
CREATE TRIGGER update_bulk_generation_jobs_updated_at
  BEFORE UPDATE ON public.bulk_generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_bulk_jobs_created_by ON public.bulk_generation_jobs(created_by);
CREATE INDEX idx_bulk_jobs_status ON public.bulk_generation_jobs(status);
CREATE INDEX idx_bulk_jobs_created_at ON public.bulk_generation_jobs(created_at DESC);
CREATE INDEX idx_bulk_items_job_id ON public.bulk_generation_items(job_id);
CREATE INDEX idx_bulk_items_status ON public.bulk_generation_items(status);
CREATE INDEX idx_bulk_items_report_id ON public.bulk_generation_items(report_id);

-- Add comments for documentation
COMMENT ON TABLE public.bulk_generation_jobs IS 'Tracks bulk investment report generation jobs';
COMMENT ON TABLE public.bulk_generation_items IS 'Tracks individual reports within a bulk generation job';
COMMENT ON COLUMN public.bulk_generation_jobs.status IS 'Job status: pending, processing, completed, failed, cancelled';
COMMENT ON COLUMN public.bulk_generation_items.status IS 'Item status: pending, processing, completed, failed, skipped';