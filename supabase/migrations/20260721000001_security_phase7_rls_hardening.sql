-- Security Remediation Phase 7 (DB-002 / DB-003 / F-07)
-- Deny-by-default RLS for priority tables. Service-role-specific policies for
-- these tables already exist and are unchanged; this migration removes
-- world-open access paths.
--
-- NOTE: this migration was applied to production incrementally via MCP
-- (notifications+document_chunks, then email_copilot after the frontend fix).
-- The guards below make it idempotent so a later `supabase db push` re-run is
-- a safe no-op instead of failing on already-existing policies.
DROP POLICY IF EXISTS notifications_select_own_or_broadcast ON public.notifications;
DROP POLICY IF EXISTS notifications_update_own_or_broadcast ON public.notifications;
DROP POLICY IF EXISTS notifications_delete_own_or_broadcast ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_authenticated ON public.notifications;
DROP POLICY IF EXISTS notifications_service_role_all ON public.notifications;
DROP POLICY IF EXISTS document_chunks_select_authenticated ON public.document_chunks;
DROP POLICY IF EXISTS email_copilot_emails_select_scoped ON public.email_copilot_emails;
DROP POLICY IF EXISTS email_copilot_emails_update_scoped ON public.email_copilot_emails;
DROP POLICY IF EXISTS email_copilot_emails_delete_scoped ON public.email_copilot_emails;
DROP POLICY IF EXISTS email_copilot_sent_replies_select_scoped ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS email_copilot_sent_replies_update_scoped ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS email_copilot_sent_replies_delete_scoped ON public.email_copilot_sent_replies;

-- ── password_reset_tokens ─────────────────────────────────────────────────
-- The legacy "Service role can manage password reset tokens" policy was
-- attached to {public} with qual=true, exposing plaintext OTP codes to any
-- anon/authenticated PostgREST caller. Service-role access is preserved by
-- the dedicated password_reset_tokens_service_role_* policies.
DROP POLICY IF EXISTS "Service role can manage password reset tokens" ON public.password_reset_tokens;

-- ── notifications ─────────────────────────────────────────────────────────
-- Previous policies were qual=true for {public}: any caller (including anon)
-- could read, update and delete every notification. Scope to authenticated
-- users: broadcast rows (target_user_id IS NULL) plus rows targeted at the
-- caller. INSERT stays open to authenticated staff (the dashboard creates
-- broadcast and targeted notifications); anon loses all access.
DROP POLICY IF EXISTS "All users can view all notifications" ON public.notifications;
DROP POLICY IF EXISTS "All users can update notifications" ON public.notifications;
DROP POLICY IF EXISTS "All users can delete notifications" ON public.notifications;
DROP POLICY IF EXISTS "Service role can create notifications" ON public.notifications;

CREATE POLICY notifications_select_own_or_broadcast
  ON public.notifications FOR SELECT TO authenticated
  USING (target_user_id IS NULL OR target_user_id = auth.uid());

CREATE POLICY notifications_update_own_or_broadcast
  ON public.notifications FOR UPDATE TO authenticated
  USING (target_user_id IS NULL OR target_user_id = auth.uid())
  WITH CHECK (target_user_id IS NULL OR target_user_id = auth.uid());

CREATE POLICY notifications_delete_own_or_broadcast
  ON public.notifications FOR DELETE TO authenticated
  USING (target_user_id IS NULL OR target_user_id = auth.uid());

CREATE POLICY notifications_insert_authenticated
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY notifications_service_role_all
  ON public.notifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── document_chunks ───────────────────────────────────────────────────────
-- DB-003: remove all-authenticated CRUD. Reads remain available to
-- authenticated staff (suburb/report reference data used for RAG search);
-- writes go exclusively through service-role edge functions.
DROP POLICY IF EXISTS "Authenticated users can create document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Authenticated users can update document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Authenticated users can delete document chunks" ON public.document_chunks;
DROP POLICY IF EXISTS "Authenticated users can view document chunks" ON public.document_chunks;

CREATE POLICY document_chunks_select_authenticated
  ON public.document_chunks FOR SELECT TO authenticated
  USING (true);

-- ── email_copilot_emails ──────────────────────────────────────────────────
-- MAIL-003: the previous policies exposed every row with client_id IS NULL
-- (which includes personal-mailbox syncs) to all users. Personal emails are
-- now visible only to their owner; unattributed legacy personal rows stay
-- visible until backfill completes. Admin/shared-mailbox rows keep their
-- existing visibility.
DROP POLICY IF EXISTS "Users can view emails for their clients" ON public.email_copilot_emails;
DROP POLICY IF EXISTS "Users can update emails for their clients" ON public.email_copilot_emails;
DROP POLICY IF EXISTS "Users can delete emails for their clients" ON public.email_copilot_emails;

CREATE POLICY email_copilot_emails_select_scoped
  ON public.email_copilot_emails FOR SELECT TO authenticated
  USING (
    (client_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = email_copilot_emails.client_id
        AND (c.created_by)::text = (auth.uid())::text
    ))
    OR created_by = auth.uid()
    OR owner_user_id = auth.uid()
    OR (
      client_id IS NULL
      AND (
        mailbox_source IS DISTINCT FROM 'personal'
        OR (owner_user_id IS NULL AND created_by IS NULL)
      )
    )
  );

CREATE POLICY email_copilot_emails_update_scoped
  ON public.email_copilot_emails FOR UPDATE TO authenticated
  USING (
    (client_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = email_copilot_emails.client_id
        AND (c.created_by)::text = (auth.uid())::text
    ))
    OR created_by = auth.uid()
    OR owner_user_id = auth.uid()
    OR (
      client_id IS NULL
      AND (
        mailbox_source IS DISTINCT FROM 'personal'
        OR (owner_user_id IS NULL AND created_by IS NULL)
      )
    )
  )
  WITH CHECK (
    -- RLS-02: an update may leave a row unowned or owned by the caller, but
    -- never assign ownership to another user
    owner_user_id IS NULL OR owner_user_id = auth.uid()
  );

CREATE POLICY email_copilot_emails_delete_scoped
  ON public.email_copilot_emails FOR DELETE TO authenticated
  USING (
    (client_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = email_copilot_emails.client_id
        AND (c.created_by)::text = (auth.uid())::text
    ))
    OR created_by = auth.uid()
    OR owner_user_id = auth.uid()
    OR (
      client_id IS NULL
      AND (
        mailbox_source IS DISTINCT FROM 'personal'
        OR (owner_user_id IS NULL AND created_by IS NULL)
      )
    )
  );

-- ── email_copilot_sent_replies ────────────────────────────────────────────
-- Same personal-mailbox scoping for sent replies (created_by is text here).
DROP POLICY IF EXISTS "Users can view replies for their emails" ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS "Users can update replies for their emails" ON public.email_copilot_sent_replies;
DROP POLICY IF EXISTS "Users can delete replies for their emails" ON public.email_copilot_sent_replies;

CREATE POLICY email_copilot_sent_replies_select_scoped
  ON public.email_copilot_sent_replies FOR SELECT TO authenticated
  USING (
    created_by = (auth.uid())::text
    OR owner_user_id = auth.uid()
    OR (
      mailbox_source IS DISTINCT FROM 'personal'
      OR (owner_user_id IS NULL AND created_by IS NULL)
    )
  );

CREATE POLICY email_copilot_sent_replies_update_scoped
  ON public.email_copilot_sent_replies FOR UPDATE TO authenticated
  USING (
    created_by = (auth.uid())::text
    OR owner_user_id = auth.uid()
    OR (
      mailbox_source IS DISTINCT FROM 'personal'
      OR (owner_user_id IS NULL AND created_by IS NULL)
    )
  );

CREATE POLICY email_copilot_sent_replies_delete_scoped
  ON public.email_copilot_sent_replies FOR DELETE TO authenticated
  USING (
    created_by = (auth.uid())::text
    OR owner_user_id = auth.uid()
    OR (
      mailbox_source IS DISTINCT FROM 'personal'
      OR (owner_user_id IS NULL AND created_by IS NULL)
    )
  );
