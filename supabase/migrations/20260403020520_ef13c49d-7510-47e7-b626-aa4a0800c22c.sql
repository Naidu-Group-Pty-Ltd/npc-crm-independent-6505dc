
-- ============================================================
-- GHL Conversations table
-- ============================================================
CREATE TABLE public.ghl_conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ghl_conversation_id TEXT NOT NULL,
  ghl_contact_id TEXT,
  channel_type TEXT NOT NULL DEFAULT 'sms',
  last_message_body TEXT,
  last_message_date TIMESTAMPTZ,
  last_message_direction TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  conversation_status TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  last_synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ghl_conversation UNIQUE (ghl_conversation_id)
);

-- Enable RLS (service-role only)
ALTER TABLE public.ghl_conversations ENABLE ROW LEVEL SECURITY;

-- Service-role-only policies
CREATE POLICY "Service role full access on ghl_conversations"
  ON public.ghl_conversations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_ghl_conversations_client_id ON public.ghl_conversations(client_id);
CREATE INDEX idx_ghl_conversations_ghl_contact_id ON public.ghl_conversations(ghl_contact_id);
CREATE INDEX idx_ghl_conversations_last_message_date ON public.ghl_conversations(last_message_date DESC);
CREATE INDEX idx_ghl_conversations_channel_type ON public.ghl_conversations(channel_type);

-- Auto-update updated_at
CREATE TRIGGER update_ghl_conversations_updated_at
  BEFORE UPDATE ON public.ghl_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- GHL Conversation Messages table
-- ============================================================
CREATE TABLE public.ghl_conversation_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.ghl_conversations(id) ON DELETE CASCADE,
  ghl_message_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'inbound',
  channel_type TEXT NOT NULL DEFAULT 'sms',
  body TEXT,
  content_type TEXT NOT NULL DEFAULT 'text',
  attachment_urls TEXT[],
  sender_name TEXT,
  sender_number TEXT,
  recipient_number TEXT,
  message_status TEXT DEFAULT 'sent',
  ghl_date_added TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ghl_message UNIQUE (ghl_message_id)
);

-- Enable RLS (service-role only)
ALTER TABLE public.ghl_conversation_messages ENABLE ROW LEVEL SECURITY;

-- Service-role-only policies
CREATE POLICY "Service role full access on ghl_conversation_messages"
  ON public.ghl_conversation_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_ghl_conv_messages_conversation_id ON public.ghl_conversation_messages(conversation_id);
CREATE INDEX idx_ghl_conv_messages_ghl_date ON public.ghl_conversation_messages(ghl_date_added DESC);
CREATE INDEX idx_ghl_conv_messages_direction ON public.ghl_conversation_messages(direction);
CREATE INDEX idx_ghl_conv_messages_dedup ON public.ghl_conversation_messages(ghl_message_id);

-- Auto-update updated_at
CREATE TRIGGER update_ghl_conv_messages_updated_at
  BEFORE UPDATE ON public.ghl_conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
