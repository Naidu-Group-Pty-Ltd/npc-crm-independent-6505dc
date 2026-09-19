-- Create email_copilot_emails table for storing emails and AI outputs
CREATE TABLE public.email_copilot_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  received_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- AI-generated content (only populated when admin triggers action)
  summary JSONB DEFAULT NULL,
  draft_reply TEXT DEFAULT NULL,
  urgency_level TEXT DEFAULT NULL CHECK (urgency_level IN ('low', 'medium', 'high', NULL)),
  
  -- Optional linking to existing entities
  linked_property_address TEXT DEFAULT NULL,
  linked_report_id UUID DEFAULT NULL REFERENCES public.investment_reports(id) ON DELETE SET NULL,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'summarized', 'drafted', 'archived')),
  
  -- Metadata
  created_by UUID DEFAULT NULL REFERENCES public.custom_users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.email_copilot_emails ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Allow public read (required for custom auth system)
CREATE POLICY "Allow public read access to emails"
ON public.email_copilot_emails
FOR SELECT
TO anon, authenticated
USING (true);

-- RLS Policy: Allow public insert (for edge functions and frontend with custom auth)
CREATE POLICY "Allow public insert access to emails"
ON public.email_copilot_emails
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

-- RLS Policy: Allow public update
CREATE POLICY "Allow public update access to emails"
ON public.email_copilot_emails
FOR UPDATE
TO anon, authenticated
USING (true);

-- RLS Policy: Allow public delete
CREATE POLICY "Allow public delete access to emails"
ON public.email_copilot_emails
FOR DELETE
TO anon, authenticated
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_email_copilot_emails_updated_at
BEFORE UPDATE ON public.email_copilot_emails
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster queries
CREATE INDEX idx_email_copilot_emails_status ON public.email_copilot_emails(status);
CREATE INDEX idx_email_copilot_emails_created_at ON public.email_copilot_emails(created_at DESC);