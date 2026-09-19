-- Add sent_by column to report_qa_messages to track which user sent each message
ALTER TABLE public.report_qa_messages 
ADD COLUMN sent_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL;

-- Add sent_by_username as a denormalized column for fast display without joins
ALTER TABLE public.report_qa_messages 
ADD COLUMN sent_by_username text;