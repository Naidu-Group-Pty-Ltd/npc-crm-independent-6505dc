-- Add mailbox_source column to email_copilot_emails
ALTER TABLE public.email_copilot_emails 
ADD COLUMN IF NOT EXISTS mailbox_source TEXT DEFAULT 'admin';

-- Add mailbox_source column to email_copilot_sent_replies
ALTER TABLE public.email_copilot_sent_replies 
ADD COLUMN IF NOT EXISTS mailbox_source TEXT DEFAULT 'admin';

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_email_copilot_emails_mailbox_source 
ON public.email_copilot_emails(mailbox_source);

CREATE INDEX IF NOT EXISTS idx_email_copilot_sent_replies_mailbox_source 
ON public.email_copilot_sent_replies(mailbox_source);