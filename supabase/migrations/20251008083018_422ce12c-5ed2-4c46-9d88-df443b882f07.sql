-- Create storage bucket for generated PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('investment-reports', 'investment-reports', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for the bucket
CREATE POLICY "Anyone can view investment reports"
ON storage.objects FOR SELECT
USING (bucket_id = 'investment-reports');

CREATE POLICY "Authenticated users can upload investment reports"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'investment-reports' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update their own reports"
ON storage.objects FOR UPDATE
USING (bucket_id = 'investment-reports' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete their own reports"
ON storage.objects FOR DELETE
USING (bucket_id = 'investment-reports' AND auth.role() = 'authenticated');

-- Add column to investment_reports table to store PDF URL
ALTER TABLE public.investment_reports 
ADD COLUMN IF NOT EXISTS pdf_url TEXT;