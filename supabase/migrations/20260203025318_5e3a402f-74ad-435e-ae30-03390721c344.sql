-- Add model_provider column to track which AI model generated each message
ALTER TABLE public.report_qa_messages 
ADD COLUMN IF NOT EXISTS model_provider text DEFAULT NULL;

-- Add a comment explaining the column
COMMENT ON COLUMN public.report_qa_messages.model_provider IS 'Tracks which AI provider generated this message: openai, perplexity, or null for user messages';