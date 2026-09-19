
-- 1. Extend notifications type check constraint
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'report_generated','report_failed','info','call_completed',
    'report_generation_completed','report_generation_failed','portal_report_requested',
    'agreement_generated','new_ghl_contact','new_marketing_lead','missed_call',
    'client_reminder_overdue','client_reminder_due','client_reminder_upcoming',
    'report_request','email_received','conversation_shared',
    'game_plan_created','game_plan_updated','game_plan_milestone_completed',
    'conversation_reply','lender_submission_status','lender_rate_alert',
    'client_data_updated','portal_message_received','finance_portal_message_received'
  ]::text[])
);

-- 2. Trigger function: notify staff when a CLIENT sends a portal message
CREATE OR REPLACE FUNCTION public.notify_staff_on_client_portal_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_user UUID;
  v_client_name   TEXT;
  v_preview       TEXT;
BEGIN
  IF NEW.sender_type IS DISTINCT FROM 'client' THEN
    RETURN NEW;
  END IF;

  SELECT c.assigned_team_user_id,
         COALESCE(NULLIF(TRIM(c.first_name || ' ' || COALESCE(c.last_name,'')), ''), c.first_name, 'Client')
  INTO v_assigned_user, v_client_name
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  v_preview := LEFT(COALESCE(NEW.message, ''), 140);

  INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
  VALUES (
    'portal_message_received',
    'New message from ' || COALESCE(v_client_name, 'a client'),
    v_preview,
    NEW.client_id::text,
    v_assigned_user,  -- NULL = visible to all staff (existing convention)
    jsonb_build_object(
      'client_id', NEW.client_id,
      'message_id', NEW.id,
      'sender_name', NEW.sender_name,
      'link_path', '/clients/' || NEW.client_id::text || '?tab=messages'
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_staff_on_client_portal_message] %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_staff_on_client_portal_message ON public.client_portal_messages;
CREATE TRIGGER trg_notify_staff_on_client_portal_message
AFTER INSERT ON public.client_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_on_client_portal_message();

-- 3. Trigger function: notify staff when a PARTNER sends a finance portal message
CREATE OR REPLACE FUNCTION public.notify_staff_on_finance_portal_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assigned_user UUID;
  v_client_name   TEXT;
  v_preview       TEXT;
BEGIN
  IF NEW.sender_type IS DISTINCT FROM 'partner' THEN
    RETURN NEW;
  END IF;

  SELECT c.assigned_team_user_id,
         COALESCE(NULLIF(TRIM(c.first_name || ' ' || COALESCE(c.last_name,'')), ''), c.first_name, 'Client')
  INTO v_assigned_user, v_client_name
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  v_preview := LEFT(COALESCE(NEW.body, ''), 140);

  INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
  VALUES (
    'finance_portal_message_received',
    'New finance message · ' || COALESCE(v_client_name, 'Client'),
    COALESCE(NULLIF(v_preview, ''), '(attachment)'),
    NEW.client_id::text,
    v_assigned_user,
    jsonb_build_object(
      'client_id', NEW.client_id,
      'thread_id', NEW.thread_id,
      'message_id', NEW.id,
      'sender_name', NEW.sender_name,
      'link_path', '/clients/' || NEW.client_id::text || '?tab=finance-messages'
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[notify_staff_on_finance_portal_message] %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_staff_on_finance_portal_message ON public.finance_portal_messages;
CREATE TRIGGER trg_notify_staff_on_finance_portal_message
AFTER INSERT ON public.finance_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_on_finance_portal_message();

-- 4. Add messaging tables to realtime publication (idempotent)
ALTER TABLE public.client_portal_messages REPLICA IDENTITY FULL;
ALTER TABLE public.finance_portal_messages REPLICA IDENTITY FULL;
ALTER TABLE public.finance_portal_threads REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='client_portal_messages') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.client_portal_messages';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='finance_portal_messages') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_messages';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='finance_portal_threads') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.finance_portal_threads';
  END IF;
END $$;
