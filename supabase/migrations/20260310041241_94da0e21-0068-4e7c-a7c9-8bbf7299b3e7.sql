
-- Marketing reports table for weekly AI briefs and forecast snapshots
CREATE TABLE public.marketing_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_type TEXT NOT NULL DEFAULT 'weekly_brief', -- weekly_brief, forecast_snapshot, custom
  title TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  date_preset TEXT,
  content TEXT NOT NULL DEFAULT '',
  metrics_snapshot JSONB DEFAULT '{}',
  forecast_data JSONB DEFAULT '{}',
  anomalies_snapshot JSONB DEFAULT '[]',
  health_snapshot JSONB DEFAULT '[]',
  recommendations JSONB DEFAULT '[]',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.marketing_reports ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read/write
CREATE POLICY "Authenticated users can manage marketing reports"
  ON public.marketing_reports
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_marketing_reports_type_period ON public.marketing_reports (report_type, period_start DESC);
CREATE INDEX idx_marketing_reports_created ON public.marketing_reports (created_at DESC);

-- Updated_at trigger
CREATE TRIGGER update_marketing_reports_updated_at
  BEFORE UPDATE ON public.marketing_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
