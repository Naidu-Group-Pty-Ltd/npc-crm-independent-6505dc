
-- ============================================================
-- BATCH 1: Foundation tables for Agent Enhancements
-- ============================================================

-- 1. COLLABORATIVE CHAT SHARING
-- Tracks who a conversation is shared with, permissions, and handoff points
CREATE TABLE public.agent_conversation_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  shared_by UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  shared_with UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'collaborate', 'admin')),
  handoff_note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, shared_with)
);

ALTER TABLE public.agent_conversation_shares ENABLE ROW LEVEL SECURITY;

-- Handoff log to track when collaboration transitions occur
CREATE TABLE public.agent_conversation_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  handoff_type TEXT NOT NULL DEFAULT 'transfer' CHECK (handoff_type IN ('transfer', 'collaborate', 'escalate', 'return')),
  note TEXT,
  message_id UUID REFERENCES public.agent_messages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_conversation_handoffs ENABLE ROW LEVEL SECURITY;

-- Add shared_by indicator to messages so we know who sent each message in shared chats
ALTER TABLE public.agent_messages ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES public.custom_users(id);

-- 2. USER PREFERENCES / MEMORY
CREATE TABLE public.agent_user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, preference_key)
);

ALTER TABLE public.agent_user_preferences ENABLE ROW LEVEL SECURITY;

-- 3. AUDIT TRAIL + UNDO/ROLLBACK
CREATE TABLE public.agent_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.agent_conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.agent_messages(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_arguments JSONB,
  tool_result JSONB,
  affected_table TEXT,
  affected_record_id TEXT,
  affected_client_id UUID,
  rollback_data JSONB,
  rollback_sql TEXT,
  is_rolled_back BOOLEAN NOT NULL DEFAULT false,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by UUID REFERENCES public.custom_users(id),
  confidence_score NUMERIC(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  execution_time_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'rolled_back', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_action_log ENABLE ROW LEVEL SECURITY;

-- Index for quick lookups
CREATE INDEX idx_agent_action_log_user ON public.agent_action_log(user_id, created_at DESC);
CREATE INDEX idx_agent_action_log_client ON public.agent_action_log(affected_client_id, created_at DESC);
CREATE INDEX idx_agent_action_log_conversation ON public.agent_action_log(conversation_id, created_at DESC);
CREATE INDEX idx_agent_conversation_shares_user ON public.agent_conversation_shares(shared_with, is_active);
CREATE INDEX idx_agent_conversation_shares_conv ON public.agent_conversation_shares(conversation_id, is_active);

-- Triggers for updated_at
CREATE TRIGGER update_agent_conversation_shares_updated_at
  BEFORE UPDATE ON public.agent_conversation_shares
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_agent_user_preferences_updated_at
  BEFORE UPDATE ON public.agent_user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
