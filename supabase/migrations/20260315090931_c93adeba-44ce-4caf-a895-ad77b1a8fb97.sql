ALTER TABLE public.report_qa_conversations
ADD COLUMN IF NOT EXISTS conversation_summary text;

ALTER TABLE public.report_qa_conversations
ADD COLUMN IF NOT EXISTS last_summarized_at timestamptz;

ALTER TABLE public.report_qa_conversations
ADD COLUMN IF NOT EXISTS summary_message_count integer DEFAULT 0;