-- Fix client portal message notifications so client-sent portal messages reliably
-- appear in the Command Centre bell and deep-link to the client's Portal Messages tab.
-- The prior trigger referenced legacy client name columns and could fail before
-- inserting the notification.

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
         COALESCE(
           NULLIF(TRIM(CONCAT_WS(' ', c.primary_first_name, c.primary_surname)), ''),
           c.primary_email,
           'Client'
         )
  INTO v_assigned_user, v_client_name
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  v_preview := COALESCE(NULLIF(LEFT(BTRIM(COALESCE(NEW.message, '')), 140), ''), '(blank message)');

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.type = 'portal_message_received'
      AND n.metadata->>'message_id' = NEW.id::text
  ) THEN
    INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
    VALUES (
      'portal_message_received',
      'New message from ' || COALESCE(v_client_name, 'a client'),
      v_preview,
      NEW.client_id::text,
      v_assigned_user,
      jsonb_build_object(
        'client_id', NEW.client_id,
        'message_id', NEW.id,
        'sender_name', NEW.sender_name,
        'link_path', '/clients?clientId=' || NEW.client_id::text || '&tab=portal-messages'
      )
    );
  END IF;

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

-- Also fix finance partner -> Command Centre notifications. The previous
-- implementation used legacy client name columns and could fail before creating
-- the staff bell notification.
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
         COALESCE(
           NULLIF(TRIM(CONCAT_WS(' ', c.primary_first_name, c.primary_surname)), ''),
           c.primary_email,
           'Client'
         )
  INTO v_assigned_user, v_client_name
  FROM public.clients c
  WHERE c.id = NEW.client_id;

  v_preview := COALESCE(NULLIF(LEFT(BTRIM(COALESCE(NEW.body, '')), 140), ''), '(attachment)');

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.type = 'finance_portal_message_received'
      AND n.metadata->>'message_id' = NEW.id::text
  ) THEN
    INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
    VALUES (
      'finance_portal_message_received',
      'New finance message · ' || COALESCE(v_client_name, 'Client'),
      v_preview,
      NEW.client_id::text,
      v_assigned_user,
      jsonb_build_object(
        'client_id', NEW.client_id,
        'thread_id', NEW.thread_id,
        'message_id', NEW.id,
        'sender_name', NEW.sender_name,
        'link_path', '/clients?clientId=' || NEW.client_id::text || '&tab=finance-messages'
      )
    );
  END IF;

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
