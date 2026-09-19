-- Create table for storing portfolio analysis reports
CREATE TABLE public.portfolio_analysis_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  health_score integer,
  overall_health text,
  portfolio_value numeric,
  total_equity numeric,
  net_monthly_cashflow numeric,
  total_properties integer,
  average_lvr numeric,
  average_yield numeric,
  report_data jsonb NOT NULL,
  pdf_file_path text,
  status text NOT NULL DEFAULT 'completed',
  generated_by uuid REFERENCES public.custom_users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.portfolio_analysis_reports ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Anyone can view portfolio analysis reports"
  ON public.portfolio_analysis_reports
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create portfolio analysis reports"
  ON public.portfolio_analysis_reports
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update portfolio analysis reports"
  ON public.portfolio_analysis_reports
  FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete portfolio analysis reports"
  ON public.portfolio_analysis_reports
  FOR DELETE
  USING (true);

-- Create index for faster queries
CREATE INDEX idx_portfolio_analysis_client_id ON public.portfolio_analysis_reports(client_id);
CREATE INDEX idx_portfolio_analysis_created_at ON public.portfolio_analysis_reports(created_at DESC);
CREATE INDEX idx_portfolio_analysis_health_score ON public.portfolio_analysis_reports(health_score);