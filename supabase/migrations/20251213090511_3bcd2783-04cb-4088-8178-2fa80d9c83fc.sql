-- Add attachments column to email_copilot_emails table
ALTER TABLE public.email_copilot_emails 
ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

-- Create storage bucket for email attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('email-attachments', 'email-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for email attachments bucket
CREATE POLICY "Anyone can view email attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'email-attachments');

CREATE POLICY "Service role can upload email attachments"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'email-attachments');

CREATE POLICY "Service role can delete email attachments"
ON storage.objects FOR DELETE
USING (bucket_id = 'email-attachments');