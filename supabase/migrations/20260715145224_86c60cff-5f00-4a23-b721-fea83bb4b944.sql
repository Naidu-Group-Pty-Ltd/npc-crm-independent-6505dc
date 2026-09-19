ALTER TABLE public.report_qa_messages ADD COLUMN IF NOT EXISTS stream_id text;
CREATE UNIQUE INDEX IF NOT EXISTS report_qa_messages_stream_role_uidx
  ON public.report_qa_messages(conversation_id, stream_id, role)
  WHERE stream_id IS NOT NULL;