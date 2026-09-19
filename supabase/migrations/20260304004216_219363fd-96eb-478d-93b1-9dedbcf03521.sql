
CREATE TABLE public.agent_file_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_bucket TEXT NOT NULL DEFAULT 'client-files',
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  file_category TEXT NOT NULL DEFAULT 'general',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_file_uploads ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_agent_file_uploads_user_id ON public.agent_file_uploads(user_id);
CREATE INDEX idx_agent_file_uploads_conversation_id ON public.agent_file_uploads(conversation_id);
CREATE INDEX idx_agent_file_uploads_filename ON public.agent_file_uploads(filename);
CREATE INDEX idx_agent_file_uploads_mime_type ON public.agent_file_uploads(mime_type);

CREATE TRIGGER update_agent_file_uploads_updated_at
  BEFORE UPDATE ON public.agent_file_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
