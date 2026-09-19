
ALTER TABLE public.report_qa_conversations
  ADD COLUMN IF NOT EXISTS agent_mode boolean NOT NULL DEFAULT false;

ALTER TABLE public.report_qa_messages
  ADD COLUMN IF NOT EXISTS tool_invocations jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_report_qa_messages_tool_invocations
  ON public.report_qa_messages USING gin (tool_invocations);
