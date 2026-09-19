-- Create table to store sent email replies
CREATE TABLE public.email_copilot_sent_replies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  original_email_id UUID REFERENCES public.email_copilot_emails(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  cc_recipients TEXT[] DEFAULT '{}',
  bcc_recipients TEXT[] DEFAULT '{}',
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by TEXT
);

-- Enable RLS
ALTER TABLE public.email_copilot_sent_replies ENABLE ROW LEVEL SECURITY;

-- Allow anon and authenticated to read sent replies
CREATE POLICY "Allow read access to sent replies"
ON public.email_copilot_sent_replies
FOR SELECT
TO anon, authenticated
USING (true);

-- Allow anon and authenticated to insert sent replies
CREATE POLICY "Allow insert access to sent replies"
ON public.email_copilot_sent_replies
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- Create index for faster lookups by original email
CREATE INDEX idx_sent_replies_original_email ON public.email_copilot_sent_replies(original_email_id);

-- Create index for sent_at ordering
CREATE INDEX idx_sent_replies_sent_at ON public.email_copilot_sent_replies(sent_at DESC);