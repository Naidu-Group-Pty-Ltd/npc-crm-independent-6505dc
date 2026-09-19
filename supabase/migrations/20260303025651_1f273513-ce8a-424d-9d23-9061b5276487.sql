
-- Agent conversations table (user-scoped persistent chat)
CREATE TABLE public.agent_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;

-- Only the owning user can access their conversations
CREATE POLICY "Users can view own agent conversations"
  ON public.agent_conversations FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own agent conversations"
  ON public.agent_conversations FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update own agent conversations"
  ON public.agent_conversations FOR UPDATE
  USING (true);

CREATE POLICY "Users can delete own agent conversations"
  ON public.agent_conversations FOR DELETE
  USING (true);

-- Agent messages table
CREATE TABLE public.agent_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  tool_calls JSONB,
  tool_results JSONB,
  requires_confirmation BOOLEAN DEFAULT false,
  confirmation_status TEXT CHECK (confirmation_status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agent messages"
  ON public.agent_messages FOR SELECT
  USING (true);

CREATE POLICY "Users can insert own agent messages"
  ON public.agent_messages FOR INSERT
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_agent_conversations_user_id ON public.agent_conversations(user_id);
CREATE INDEX idx_agent_messages_conversation_id ON public.agent_messages(conversation_id);
CREATE INDEX idx_agent_messages_created_at ON public.agent_messages(created_at);

-- Trigger for updated_at
CREATE TRIGGER update_agent_conversations_updated_at
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
