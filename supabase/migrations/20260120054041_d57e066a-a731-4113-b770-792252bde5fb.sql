-- Drop the existing check constraint and recreate with 'sent' added
ALTER TABLE public.email_copilot_emails DROP CONSTRAINT email_copilot_emails_status_check;

ALTER TABLE public.email_copilot_emails ADD CONSTRAINT email_copilot_emails_status_check 
CHECK (status = ANY (ARRAY['unread'::text, 'read'::text, 'summarized'::text, 'drafted'::text, 'archived'::text, 'sent'::text]));