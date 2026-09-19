CREATE TABLE public.property_scrape_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  url TEXT NOT NULL,
  property_category TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  result JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_property_scrape_jobs_user_created ON public.property_scrape_jobs(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.property_scrape_jobs TO authenticated;
GRANT ALL ON public.property_scrape_jobs TO service_role;

ALTER TABLE public.property_scrape_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own scrape jobs"
  ON public.property_scrape_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scrape jobs"
  ON public.property_scrape_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_property_scrape_jobs_updated_at
  BEFORE UPDATE ON public.property_scrape_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();