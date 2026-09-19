-- Track processed Airtable records to avoid duplicate report generation
CREATE TABLE public.auto_report_processed_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id text NOT NULL UNIQUE,
  listing_address text,
  processed_at timestamp with time zone NOT NULL DEFAULT now(),
  switch_id uuid REFERENCES public.auto_report_switches(id),
  report_id uuid REFERENCES public.investment_reports(id),
  skipped boolean NOT NULL DEFAULT false,
  skip_reason text
);

-- Enable RLS
ALTER TABLE public.auto_report_processed_listings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view processed listings" ON public.auto_report_processed_listings FOR SELECT USING (true);
CREATE POLICY "Service role can manage processed listings" ON public.auto_report_processed_listings FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update processed listings" ON public.auto_report_processed_listings FOR UPDATE USING (true);

-- Index for fast lookups
CREATE INDEX idx_processed_listings_listing_id ON public.auto_report_processed_listings(listing_id);

COMMENT ON TABLE public.auto_report_processed_listings IS 'Tracks which Airtable listings have been processed by auto-generation to prevent duplicates';