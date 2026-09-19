-- Add to_recipients column to store email TO recipients
ALTER TABLE public.email_copilot_emails 
ADD COLUMN to_recipients text[] DEFAULT ARRAY[]::text[];