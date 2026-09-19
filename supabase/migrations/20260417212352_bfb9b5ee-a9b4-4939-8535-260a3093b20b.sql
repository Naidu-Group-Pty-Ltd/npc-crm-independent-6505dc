-- Push subscriptions table (one row per device/browser per user)
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  device_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON public.push_subscriptions(user_id) WHERE is_active = true;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Service-role only access pattern (matches dashboard standard); edge functions mediate user actions
CREATE POLICY "service_role_full_access_push_subscriptions"
  ON public.push_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Push delivery log
CREATE TABLE IF NOT EXISTS public.push_delivery_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID REFERENCES public.push_subscriptions(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.custom_users(id) ON DELETE SET NULL,
  notification_id UUID,
  status TEXT NOT NULL,
  status_code INTEGER,
  error_message TEXT,
  payload_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_log_user ON public.push_delivery_log(user_id, created_at DESC);

ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_push_delivery_log"
  ON public.push_delivery_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- updated_at trigger
CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger function: on new notification, fan out to web push via edge function
CREATE OR REPLACE FUNCTION public.dispatch_web_push_on_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_anon TEXT;
BEGIN
  -- Only dispatch if there's a recipient
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_url := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/send-web-push';
  v_anon := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object(
      'notification_id', NEW.id,
      'user_id', NEW.user_id,
      'title', COALESCE(NEW.title, 'New notification'),
      'body', COALESCE(NEW.message, ''),
      'url', NEW.link_url,
      'category', NEW.category
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block notification insert on push failure
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_web_push ON public.notifications;
CREATE TRIGGER trg_dispatch_web_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.dispatch_web_push_on_notification();