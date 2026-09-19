-- Add CC and BCC columns to email_copilot_emails
ALTER TABLE public.email_copilot_emails 
ADD COLUMN IF NOT EXISTS cc_recipients text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS bcc_recipients text[] DEFAULT '{}';