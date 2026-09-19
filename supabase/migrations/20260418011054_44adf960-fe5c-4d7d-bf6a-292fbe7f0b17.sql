
-- 1) Make push_subscriptions polymorphic
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_user_id_fkey;

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS subscriber_type TEXT NOT NULL DEFAULT 'staff';

-- Validation: only known subscriber types
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_subscriber_type_check;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_subscriber_type_check
  CHECK (subscriber_type IN ('staff','client_portal','finance_portal'));

-- Replace the endpoint-only uniqueness with (subscriber_type, endpoint)
ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_endpoint_key;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_subscriber_endpoint_uniq
  ON public.push_subscriptions (subscriber_type, endpoint);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_lookup_idx
  ON public.push_subscriptions (subscriber_type, user_id, is_active);

-- 2) Add must_change_password flag on finance_portal_users (idempotent)
ALTER TABLE public.finance_portal_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- 3) Polymorphic dispatcher used by client_portal_notifications + finance_portal_notifications
CREATE OR REPLACE FUNCTION public.dispatch_web_push_for_portal_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url TEXT := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/send-web-push';
  v_anon TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';
  v_subscriber_type TEXT;
  v_user_id UUID;
  v_title TEXT;
  v_body TEXT;
  v_url_path TEXT;
  v_category TEXT;
  v_portal_user RECORD;
BEGIN
  IF TG_TABLE_NAME = 'client_portal_notifications' THEN
    v_subscriber_type := 'client_portal';
    -- Resolve recipient: client_portal_notifications stores client_id, not portal_user_id
    -- Fan-out by sending to each active portal user for this client
    FOR v_portal_user IN
      SELECT id FROM public.client_portal_users
      WHERE client_id = NEW.client_id AND status = 'active'
    LOOP
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || v_anon
        ),
        body := jsonb_build_object(
          'notification_id', NEW.id,
          'user_id', v_portal_user.id,
          'subscriber_type', v_subscriber_type,
          'title', COALESCE(NEW.title,'New notification'),
          'body', COALESCE(NEW.message,''),
          'url', NEW.action_url,
          'category', NEW.category
        )
      );
    END LOOP;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'finance_portal_notifications' THEN
    v_subscriber_type := 'finance_portal';
    v_user_id := NEW.portal_user_id;
    v_title := COALESCE(NEW.title,'New notification');
    v_body := COALESCE(NEW.body,'');
    v_url_path := NEW.link_path;
    v_category := NEW.notification_type;
    IF v_user_id IS NULL THEN RETURN NEW; END IF;
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || v_anon
      ),
      body := jsonb_build_object(
        'notification_id', NEW.id,
        'user_id', v_user_id,
        'subscriber_type', v_subscriber_type,
        'title', v_title,
        'body', v_body,
        'url', v_url_path,
        'category', v_category
      )
    );
    RETURN NEW;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

-- Attach triggers (idempotent)
DROP TRIGGER IF EXISTS trg_dispatch_web_push_client_portal ON public.client_portal_notifications;
CREATE TRIGGER trg_dispatch_web_push_client_portal
  AFTER INSERT ON public.client_portal_notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_web_push_for_portal_notification();

DROP TRIGGER IF EXISTS trg_dispatch_web_push_finance_portal ON public.finance_portal_notifications;
CREATE TRIGGER trg_dispatch_web_push_finance_portal
  AFTER INSERT ON public.finance_portal_notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_web_push_for_portal_notification();
