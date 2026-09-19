
-- 1. Feedback table
CREATE TABLE IF NOT EXISTS public.report_qa_message_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.report_qa_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.report_qa_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating IN (-1, 1)),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

ALTER TABLE public.report_qa_message_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own feedback"
  ON public.report_qa_message_feedback
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "superadmin reads all feedback"
  ON public.report_qa_message_feedback
  FOR SELECT
  USING (has_role(auth.uid(), 'superadmin'::app_role));

CREATE INDEX IF NOT EXISTS idx_qa_feedback_message ON public.report_qa_message_feedback(message_id);
CREATE INDEX IF NOT EXISTS idx_qa_feedback_conversation ON public.report_qa_message_feedback(conversation_id);

-- 2. New columns on messages
ALTER TABLE public.report_qa_messages
  ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS share_token uuid,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS branched_from_message_id uuid REFERENCES public.report_qa_messages(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_messages_share_token ON public.report_qa_messages(share_token) WHERE share_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qa_messages_pinned ON public.report_qa_messages(conversation_id) WHERE pinned = true;

-- 3. New columns on conversations
ALTER TABLE public.report_qa_conversations
  ADD COLUMN IF NOT EXISTS branched_from_conversation_id uuid REFERENCES public.report_qa_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branched_from_message_id uuid REFERENCES public.report_qa_messages(id) ON DELETE SET NULL;

-- 4. Public read function for shared answers (no auth required, token-gated)
CREATE OR REPLACE FUNCTION public.get_shared_qa_answer(_share_token uuid)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  conversation_title text,
  role text,
  content text,
  created_at timestamptz,
  model_provider text,
  citations jsonb,
  tool_invocations jsonb,
  attachments jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.conversation_id,
    c.title,
    m.role,
    COALESCE(m.edited_content, m.content),
    m.created_at,
    m.model_provider,
    m.citations,
    m.tool_invocations,
    m.attachments
  FROM public.report_qa_messages m
  JOIN public.report_qa_conversations c ON c.id = m.conversation_id
  WHERE m.share_token = _share_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_qa_answer(uuid) TO anon, authenticated;
