-- Add structured_report column to cache AI-generated conversation summaries
ALTER TABLE public.report_qa_conversations
ADD COLUMN structured_report TEXT DEFAULT NULL;

-- Add edited_content column to report_qa_messages for per-message editor persistence
ALTER TABLE public.report_qa_messages
ADD COLUMN edited_content TEXT DEFAULT NULL;