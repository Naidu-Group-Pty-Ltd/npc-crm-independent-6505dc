CREATE TABLE IF NOT EXISTS public.finance_portal_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id UUID NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpn_recipient_unread
  ON public.finance_portal_notifications (portal_user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fpn_client
  ON public.finance_portal_notifications (client_id, created_at DESC);

ALTER TABLE public.finance_portal_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages finance portal notifications"
  ON public.finance_portal_notifications
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');