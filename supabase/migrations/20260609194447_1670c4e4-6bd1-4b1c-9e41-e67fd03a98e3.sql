-- =====================================================================
-- Cross-portal message fan-out: notifications + activity logs in all scopes
-- =====================================================================

-- 1) Enum additions for activity_logs
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'portal_message_sent';
ALTER TYPE public.activity_action_type ADD VALUE IF NOT EXISTS 'portal_message_received';
ALTER TYPE public.activity_entity_type ADD VALUE IF NOT EXISTS 'portal_message';

-- 2) Helper to resolve client display name
CREATE OR REPLACE FUNCTION public.resolve_client_display_name(p_client_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(TRIM(CONCAT_WS(' ', primary_first_name, primary_surname)), ''),
    primary_email,
    'Client'
  )
  FROM public.clients
  WHERE id = p_client_id;
$$;

-- =====================================================================
-- 3) client_portal_messages: comprehensive fan-out
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fanout_client_portal_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name   text;
  v_assigned_user uuid;
  v_preview       text;
  v_sender_label  text;
  v_visible_client  boolean;
  v_visible_finance boolean;
  v_finance_user  uuid;
BEGIN
  SELECT c.assigned_team_user_id, public.resolve_client_display_name(c.id)
    INTO v_assigned_user, v_client_name
  FROM public.clients c WHERE c.id = NEW.client_id;

  v_preview := COALESCE(NULLIF(LEFT(BTRIM(COALESCE(NEW.message, '')), 140), ''), '(blank message)');

  v_visible_client  := NEW.visibility_scope IN ('command_client_private', 'command_client_with_finance_allocated');
  v_visible_finance := NEW.visibility_scope = 'command_client_with_finance_allocated';

  v_sender_label := CASE NEW.sender_type
    WHEN 'client'  THEN COALESCE(NEW.sender_name, v_client_name, 'Client')
    WHEN 'advisor' THEN COALESCE(NEW.sender_name, 'Command Centre')
    ELSE COALESCE(NEW.sender_name, 'System')
  END;

  -- 3a) Command Centre bell (only inbound from client; advisor sees their own send)
  IF NEW.sender_type = 'client' AND NEW.visibility_scope <> 'internal_command_only'
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
       WHERE n.type IN ('portal_message_received','portal_message_sent')
         AND n.metadata->>'message_id' = NEW.id::text
     ) THEN
    INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
    VALUES (
      'portal_message_received',
      'Client message · ' || v_client_name,
      v_preview,
      NEW.client_id::text,
      v_assigned_user,
      jsonb_build_object(
        'source','client_portal',
        'channel','client_portal_messages',
        'client_id', NEW.client_id,
        'message_id', NEW.id,
        'thread_id', NEW.thread_id,
        'thread_type', NEW.thread_type,
        'visibility_scope', NEW.visibility_scope,
        'sender_name', NEW.sender_name,
        'link_path', '/clients?clientId=' || NEW.client_id::text || '&tab=portal-messages'
      )
    );
  END IF;

  -- 3b) Client portal notification when advisor posts a client-visible message
  IF v_visible_client AND NEW.sender_type = 'advisor'
     AND NOT EXISTS (
       SELECT 1 FROM public.client_portal_notifications cpn
       WHERE cpn.metadata->>'message_id' = NEW.id::text
     ) THEN
    INSERT INTO public.client_portal_notifications (client_id, title, message, type, category, action_url, metadata)
    VALUES (
      NEW.client_id,
      'New message from ' || v_sender_label,
      v_preview,
      'info', 'message', '/client/messages',
      jsonb_build_object(
        'message_id', NEW.id,
        'thread_id', NEW.thread_id,
        'thread_type', NEW.thread_type,
        'visibility_scope', NEW.visibility_scope,
        'allocation_status', NEW.allocation_status,
        'source','command_centre'
      )
    );
  END IF;

  -- 3c) Finance portal notification when scope = allocated and sender is client (CC→Finance handled by edge fn)
  IF v_visible_finance AND NEW.sender_type = 'client' THEN
    SELECT finance_user_id INTO v_finance_user
    FROM public.finance_portal_client_assignments
    WHERE client_id = NEW.client_id
    ORDER BY assigned_at DESC LIMIT 1;

    IF v_finance_user IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.finance_portal_notifications fpn
      WHERE fpn.metadata->>'message_id' = NEW.id::text
    ) THEN
      INSERT INTO public.finance_portal_notifications (portal_user_id, client_id, notification_type, title, body, link_path, metadata)
      VALUES (
        v_finance_user, NEW.client_id, 'client_allocation_reply',
        'Client replied · ' || v_client_name,
        v_preview, '/finance/messages',
        jsonb_build_object(
          'message_id', NEW.id,
          'thread_id', NEW.thread_id,
          'thread_type', NEW.thread_type,
          'visibility_scope', NEW.visibility_scope,
          'source','client_portal'
        )
      );
    END IF;
  END IF;

  -- 3d) activity_logs (Command Centre oversight)
  BEGIN
    INSERT INTO public.activity_logs (user_id, username, action_type, entity_type, entity_id, entity_name, metadata)
    VALUES (
      NEW.command_owner_user_id,
      v_sender_label,
      CASE WHEN NEW.sender_type = 'advisor' THEN 'portal_message_sent'::public.activity_action_type
           ELSE 'portal_message_received'::public.activity_action_type END,
      'portal_message'::public.activity_entity_type,
      NEW.id,
      v_client_name,
      jsonb_build_object(
        'channel','client_portal',
        'sender_type', NEW.sender_type,
        'sender_name', NEW.sender_name,
        'client_id', NEW.client_id,
        'thread_id', NEW.thread_id,
        'thread_type', NEW.thread_type,
        'visibility_scope', NEW.visibility_scope,
        'allocation_status', NEW.allocation_status,
        'preview', v_preview,
        'link_path', '/clients?clientId=' || NEW.client_id::text || '&tab=portal-messages'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fanout_client_portal_message] activity_logs insert failed: %', SQLERRM;
  END;

  -- 3e) finance_portal_activity_log mirror when finance has visibility
  IF v_visible_finance THEN
    IF v_finance_user IS NULL THEN
      SELECT finance_user_id INTO v_finance_user
      FROM public.finance_portal_client_assignments
      WHERE client_id = NEW.client_id
      ORDER BY assigned_at DESC LIMIT 1;
    END IF;
    BEGIN
      INSERT INTO public.finance_portal_activity_log
        (finance_user_id, client_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        v_finance_user, NEW.client_id,
        CASE WHEN NEW.sender_type='advisor' THEN NEW.command_owner_user_id ELSE NULL END,
        CASE WHEN NEW.sender_type='advisor' THEN 'admin'
             WHEN NEW.sender_type='client'  THEN 'client'
             ELSE 'system' END,
        'cross_portal_message',
        'client_portal_message',
        NEW.id,
        jsonb_build_object(
          'sender_type', NEW.sender_type,
          'sender_name', NEW.sender_name,
          'thread_id', NEW.thread_id,
          'thread_type', NEW.thread_type,
          'visibility_scope', NEW.visibility_scope,
          'allocation_status', NEW.allocation_status,
          'preview', v_preview
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[fanout_client_portal_message] %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fanout_client_portal_message ON public.client_portal_messages;
CREATE TRIGGER trg_fanout_client_portal_message
AFTER INSERT ON public.client_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.fanout_client_portal_message();

-- Old narrow trigger replaced; drop to avoid duplicate bell entries
DROP TRIGGER IF EXISTS trg_notify_staff_on_client_portal_message ON public.client_portal_messages;

-- =====================================================================
-- 4) finance_portal_messages: comprehensive fan-out
-- =====================================================================
CREATE OR REPLACE FUNCTION public.fanout_finance_portal_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name   text;
  v_assigned_user uuid;
  v_preview       text;
  v_sender_label  text;
  v_visible_client  boolean;
  v_thread_finance_user uuid;
  v_thread_client_id    uuid;
  v_thread_scope        text;
  v_thread_type         text;
BEGIN
  SELECT t.finance_user_id, t.client_id, t.visibility_scope::text, t.thread_type
    INTO v_thread_finance_user, v_thread_client_id, v_thread_scope, v_thread_type
  FROM public.finance_portal_threads t WHERE t.id = NEW.thread_id;

  -- Prefer NEW.* over thread fallback
  v_thread_client_id := COALESCE(NEW.client_id, v_thread_client_id);

  SELECT c.assigned_team_user_id, public.resolve_client_display_name(c.id)
    INTO v_assigned_user, v_client_name
  FROM public.clients c WHERE c.id = v_thread_client_id;

  v_preview := COALESCE(
    NULLIF(LEFT(BTRIM(COALESCE(NEW.body, '')), 140), ''),
    CASE WHEN NEW.attachment_path IS NOT NULL THEN '(attachment)' ELSE '(blank message)' END
  );

  v_visible_client := NEW.visibility_scope::text IN ('finance_client_with_command_visibility','command_client_with_finance_allocated');

  v_sender_label := CASE NEW.sender_type
    WHEN 'partner' THEN COALESCE(NEW.sender_name, 'Finance Partner')
    WHEN 'staff'   THEN COALESCE(NEW.sender_name, 'Command Centre')
    WHEN 'client'  THEN COALESCE(NEW.sender_name, v_client_name, 'Client')
    ELSE COALESCE(NEW.sender_name, 'System')
  END;

  -- 4a) Command Centre bell — every inbound (partner or client) message lands in CC
  IF NEW.sender_type IN ('partner','client')
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
       WHERE n.type IN ('finance_portal_message_received','portal_message_received')
         AND n.metadata->>'message_id' = NEW.id::text
     ) THEN
    INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
    VALUES (
      'finance_portal_message_received',
      CASE WHEN NEW.sender_type = 'partner'
           THEN 'Finance message · ' || v_client_name
           ELSE 'Client → Finance · ' || v_client_name END,
      v_preview,
      v_thread_client_id::text,
      v_assigned_user,
      jsonb_build_object(
        'source', CASE WHEN NEW.sender_type='partner' THEN 'finance_portal' ELSE 'client_portal' END,
        'channel','finance_portal_messages',
        'client_id', v_thread_client_id,
        'message_id', NEW.id,
        'thread_id', NEW.thread_id,
        'thread_type', COALESCE(NEW.thread_type, v_thread_type),
        'visibility_scope', NEW.visibility_scope,
        'sender_name', NEW.sender_name,
        'sender_type', NEW.sender_type,
        'link_path', '/clients?clientId=' || v_thread_client_id::text || '&tab=finance-messages'
      )
    );
  END IF;

  -- 4b) Client portal notification when scope grants visibility and sender is partner OR staff
  IF v_visible_client AND NEW.sender_type IN ('partner','staff')
     AND NOT EXISTS (
       SELECT 1 FROM public.client_portal_notifications cpn
       WHERE cpn.metadata->>'message_id' = NEW.id::text
     ) THEN
    INSERT INTO public.client_portal_notifications (client_id, title, message, type, category, action_url, metadata)
    VALUES (
      v_thread_client_id,
      'New message from ' || v_sender_label,
      v_preview,
      'info','message','/client/messages',
      jsonb_build_object(
        'message_id', NEW.id,
        'thread_id', NEW.thread_id,
        'thread_type', COALESCE(NEW.thread_type, v_thread_type),
        'visibility_scope', NEW.visibility_scope,
        'allocation_status', NEW.allocation_status,
        'source', CASE WHEN NEW.sender_type='partner' THEN 'finance_portal' ELSE 'command_centre' END
      )
    );
  END IF;

  -- 4c) Finance portal notification when sender is staff OR client (partner sees own send)
  IF v_thread_finance_user IS NOT NULL AND NEW.sender_type IN ('staff','client')
     AND NOT EXISTS (
       SELECT 1 FROM public.finance_portal_notifications fpn
       WHERE fpn.metadata->>'message_id' = NEW.id::text
     ) THEN
    INSERT INTO public.finance_portal_notifications (portal_user_id, client_id, notification_type, title, body, link_path, metadata)
    VALUES (
      v_thread_finance_user, v_thread_client_id,
      CASE WHEN NEW.sender_type='staff' THEN 'message_from_command' ELSE 'client_finance_reply' END,
      CASE WHEN NEW.sender_type='staff'
           THEN 'Command Centre · ' || v_client_name
           ELSE 'Client reply · ' || v_client_name END,
      v_preview, '/finance/messages',
      jsonb_build_object(
        'message_id', NEW.id,
        'thread_id', NEW.thread_id,
        'thread_type', COALESCE(NEW.thread_type, v_thread_type),
        'visibility_scope', NEW.visibility_scope,
        'source', CASE WHEN NEW.sender_type='staff' THEN 'command_centre' ELSE 'client_portal' END
      )
    );
  END IF;

  -- 4d) activity_logs
  BEGIN
    INSERT INTO public.activity_logs (user_id, username, action_type, entity_type, entity_id, entity_name, metadata)
    VALUES (
      NEW.command_owner_user_id,
      v_sender_label,
      CASE WHEN NEW.sender_type = 'staff' THEN 'portal_message_sent'::public.activity_action_type
           ELSE 'portal_message_received'::public.activity_action_type END,
      'portal_message'::public.activity_entity_type,
      NEW.id,
      v_client_name,
      jsonb_build_object(
        'channel','finance_portal',
        'sender_type', NEW.sender_type,
        'sender_name', NEW.sender_name,
        'client_id', v_thread_client_id,
        'thread_id', NEW.thread_id,
        'thread_type', COALESCE(NEW.thread_type, v_thread_type),
        'visibility_scope', NEW.visibility_scope,
        'allocation_status', NEW.allocation_status,
        'has_attachment', NEW.attachment_path IS NOT NULL,
        'preview', v_preview,
        'link_path', '/clients?clientId=' || v_thread_client_id::text || '&tab=finance-messages'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[fanout_finance_portal_message] activity_logs insert failed: %', SQLERRM;
  END;

  -- 4e) finance_portal_activity_log
  IF v_thread_finance_user IS NOT NULL THEN
    BEGIN
      INSERT INTO public.finance_portal_activity_log
        (finance_user_id, client_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata)
      VALUES (
        v_thread_finance_user, v_thread_client_id,
        CASE WHEN NEW.sender_type='staff' THEN NEW.command_owner_user_id ELSE NULL END,
        CASE WHEN NEW.sender_type='partner' THEN 'finance_partner'
             WHEN NEW.sender_type='staff'   THEN 'admin'
             WHEN NEW.sender_type='client'  THEN 'client'
             ELSE 'system' END,
        'cross_portal_message',
        'finance_portal_message',
        NEW.id,
        jsonb_build_object(
          'sender_type', NEW.sender_type,
          'sender_name', NEW.sender_name,
          'thread_id', NEW.thread_id,
          'thread_type', COALESCE(NEW.thread_type, v_thread_type),
          'visibility_scope', NEW.visibility_scope,
          'allocation_status', NEW.allocation_status,
          'has_attachment', NEW.attachment_path IS NOT NULL,
          'preview', v_preview
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[fanout_finance_portal_message] %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fanout_finance_portal_message ON public.finance_portal_messages;
CREATE TRIGGER trg_fanout_finance_portal_message
AFTER INSERT ON public.finance_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.fanout_finance_portal_message();

-- Old narrow trigger replaced
DROP TRIGGER IF EXISTS trg_notify_staff_on_finance_portal_message ON public.finance_portal_messages;

-- =====================================================================
-- 5) Realtime publication for portal notification tables
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='client_portal_notifications') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.client_portal_notifications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='finance_portal_notifications') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_notifications';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='message_governance_log') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_governance_log';
  END IF;
END $$;