-- =============================================================================
-- RLS-C1 (Critical): scope agent_conversations / agent_messages to the owner
-- =============================================================================
--
-- Both tables carried policies named "own" but implemented as USING(true) /
-- WITH CHECK(true) for the public role, so ANY signed-in user could read, edit,
-- or delete every user's AI-assistant chats (which may contain client financial
-- data). Replace with owner-scoped policies (auth.uid() = user_id), honouring
-- active conversation shares for collaborative chats. service_role (edge
-- functions) bypasses RLS and is unaffected; the frontend never queries these
-- tables directly — it uses ai-dashboard-agent (service role) and a realtime
-- subscription on agent_messages that this scoping keeps working.
-- =============================================================================

-- ── agent_conversations ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own agent conversations"   ON public.agent_conversations;
DROP POLICY IF EXISTS "Users can insert own agent conversations" ON public.agent_conversations;
DROP POLICY IF EXISTS "Users can update own agent conversations" ON public.agent_conversations;
DROP POLICY IF EXISTS "Users can delete own agent conversations" ON public.agent_conversations;

CREATE POLICY "agent_conversations_select_own_or_shared" ON public.agent_conversations
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.agent_conversation_shares s
      WHERE s.conversation_id = agent_conversations.id
        AND s.shared_with = auth.uid() AND s.is_active = true
    )
  );

CREATE POLICY "agent_conversations_insert_own" ON public.agent_conversations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "agent_conversations_update_own" ON public.agent_conversations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "agent_conversations_delete_own" ON public.agent_conversations
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── agent_messages (ownership derived from the parent conversation) ──────────
DROP POLICY IF EXISTS "Users can view own agent messages"   ON public.agent_messages;
DROP POLICY IF EXISTS "Users can insert own agent messages" ON public.agent_messages;

CREATE POLICY "agent_messages_select_via_conversation" ON public.agent_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND (
          c.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.agent_conversation_shares s
            WHERE s.conversation_id = c.id AND s.shared_with = auth.uid() AND s.is_active = true
          )
        )
    )
  );

CREATE POLICY "agent_messages_insert_via_conversation" ON public.agent_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agent_conversations c
      WHERE c.id = agent_messages.conversation_id
        AND (
          c.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.agent_conversation_shares s
            WHERE s.conversation_id = c.id AND s.shared_with = auth.uid() AND s.is_active = true
          )
        )
    )
  );
