
-- Create client_portal_reports table for publishing reports to client portal
CREATE TABLE public.client_portal_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  report_title TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'investment',
  report_tier TEXT,
  storage_path TEXT,
  file_size_bytes BIGINT,
  source_report_id UUID,
  published_by TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.client_portal_reports ENABLE ROW LEVEL SECURITY;

-- Index for fast client lookups
CREATE INDEX idx_client_portal_reports_client_id ON public.client_portal_reports(client_id);
CREATE INDEX idx_client_portal_reports_published_at ON public.client_portal_reports(published_at DESC);

-- Updated_at trigger
CREATE TRIGGER update_client_portal_reports_updated_at
  BEFORE UPDATE ON public.client_portal_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
