
-- Create marketing_intelligence_reports table
CREATE TABLE public.marketing_intelligence_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  generated_by UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_data JSONB,
  pdf_storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'completed', 'failed')),
  report_period TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.marketing_intelligence_reports ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own marketing reports"
  ON public.marketing_intelligence_reports FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create marketing reports"
  ON public.marketing_intelligence_reports FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update their own marketing reports"
  ON public.marketing_intelligence_reports FOR UPDATE
  TO authenticated
  USING (true);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('marketing-reports', 'marketing-reports', false);

-- Storage policies
CREATE POLICY "Authenticated users can upload marketing reports"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'marketing-reports');

CREATE POLICY "Authenticated users can read marketing reports"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'marketing-reports');
