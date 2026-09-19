-- Add attachments column to email_copilot_sent_replies table
ALTER TABLE public.email_copilot_sent_replies 
ADD COLUMN attachments jsonb DEFAULT '[]'::jsonb;