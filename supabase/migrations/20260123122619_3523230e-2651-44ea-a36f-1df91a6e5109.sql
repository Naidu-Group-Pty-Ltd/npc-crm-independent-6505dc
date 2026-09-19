-- Add client_id column to email_copilot_emails for email-to-client assignment
ALTER TABLE public.email_copilot_emails 
ADD COLUMN client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;

-- Create index for efficient querying of emails by client
CREATE INDEX idx_email_copilot_emails_client_id ON public.email_copilot_emails(client_id);

-- Add comment for documentation
COMMENT ON COLUMN public.email_copilot_emails.client_id IS 'Optional link to a client for tracking email threads per client';