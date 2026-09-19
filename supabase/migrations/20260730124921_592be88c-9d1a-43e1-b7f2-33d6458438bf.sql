-- =========================================================
-- Solicitor Portal Phase 6 — Communications & tri-portal sync
-- =========================================================

DO $$ BEGIN
  CREATE TYPE public.legal_thread_scope AS ENUM (
    'solicitor_npc',
    'solicitor_client',
    'solicitor_finance',
    'firm_internal'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.legal_message_sender_type AS ENUM (
    'solicitor_user',
    'staff',
    'client',
    'finance_partner',
    'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------
-- Threads
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_matter_threads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  legal_matter_id UUID NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  client_id UUID,
  firm_id UUID REFERENCES public.solicitor_firms(id) ON DELETE SET NULL,
  scope public.legal_thread_scope NOT NULL DEFAULT 'solicitor_npc',
  subject TEXT NOT NULL DEFAULT 'Matter conversation',
  finance_user_id UUID,
  last_message_at TIMESTAMP WITH TIME ZONE,
  last_message_preview TEXT,
  last_sender_type public.legal_message_sender_type,
  unread_count_solicitor INTEGER NOT NULL DEFAULT 0,
  unread_count_staff INTEGER NOT NULL DEFAULT 0,
  unread_count_client INTEGER NOT NULL DEFAULT 0,
  unread_count_finance INTEGER NOT NULL DEFAULT 0,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.legal_matter_threads TO service_role;
ALTER TABLE public.legal_matter_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_matter_threads_service_role_only
  ON public.legal_matter_threads FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_legal_matter_threads_matter
  ON public.legal_matter_threads(legal_matter_id, scope);
CREATE INDEX IF NOT EXISTS idx_legal_matter_threads_client
  ON public.legal_matter_threads(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_legal_matter_threads_scope
  ON public.legal_matter_threads(legal_matter_id, scope, COALESCE(finance_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------
-- Messages
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legal_matter_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id UUID NOT NULL REFERENCES public.legal_matter_threads(id) ON DELETE CASCADE,
  legal_matter_id UUID NOT NULL REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  client_id UUID,
  scope public.legal_thread_scope NOT NULL DEFAULT 'solicitor_npc',
  sender_type public.legal_message_sender_type NOT NULL,
  sender_solicitor_user_id UUID REFERENCES public.solicitor_portal_users(id) ON DELETE SET NULL,
  sender_staff_user_id UUID,
  sender_finance_user_id UUID,
  sender_client_portal_user_id UUID,
  sender_name TEXT,
  body TEXT NOT NULL,
  attachment_path TEXT,
  attachment_filename TEXT,
  attachment_mime TEXT,
  attachment_size_bytes BIGINT,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  mirrored_client_message_id UUID,
  mirrored_finance_message_id UUID,
  read_by_solicitor_at TIMESTAMP WITH TIME ZONE,
  read_by_staff_at TIMESTAMP WITH TIME ZONE,
  read_by_client_at TIMESTAMP WITH TIME ZONE,
  read_by_finance_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.legal_matter_messages TO service_role;
ALTER TABLE public.legal_matter_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_matter_messages_service_role_only
  ON public.legal_matter_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_legal_matter_messages_thread
  ON public.legal_matter_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_legal_matter_messages_matter
  ON public.legal_matter_messages(legal_matter_id, created_at DESC);

-- ---------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitor_portal_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitor_user_id UUID NOT NULL REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE,
  firm_id UUID REFERENCES public.solicitor_firms(id) ON DELETE CASCADE,
  client_id UUID,
  legal_matter_id UUID REFERENCES public.legal_matters(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link_path TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.solicitor_portal_notifications TO service_role;
ALTER TABLE public.solicitor_portal_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY solicitor_portal_notifications_service_role_only
  ON public.solicitor_portal_notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_solicitor_notifications_user
  ON public.solicitor_portal_notifications(solicitor_user_id, is_read, created_at DESC);

-- ---------------------------------------------------------
-- Notification preferences
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitor_notification_prefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  solicitor_user_id UUID NOT NULL REFERENCES public.solicitor_portal_users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (solicitor_user_id, event_type)
);

GRANT ALL ON public.solicitor_notification_prefs TO service_role;
ALTER TABLE public.solicitor_notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY solicitor_notification_prefs_service_role_only
  ON public.solicitor_notification_prefs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.legal_comms_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_matter_threads_touch ON public.legal_matter_threads;
CREATE TRIGGER trg_legal_matter_threads_touch
  BEFORE UPDATE ON public.legal_matter_threads
  FOR EACH ROW EXECUTE FUNCTION public.legal_comms_touch_updated_at();

DROP TRIGGER IF EXISTS trg_solicitor_notification_prefs_touch ON public.solicitor_notification_prefs;
CREATE TRIGGER trg_solicitor_notification_prefs_touch
  BEFORE UPDATE ON public.solicitor_notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.legal_comms_touch_updated_at();

-- ---------------------------------------------------------
-- Thread rollup on new message
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.legal_thread_after_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.legal_matter_threads t
     SET last_message_at = NEW.created_at,
         last_message_preview = left(NEW.body, 240),
         last_sender_type = NEW.sender_type,
         unread_count_solicitor = CASE WHEN NEW.sender_type = 'solicitor_user'
              THEN t.unread_count_solicitor ELSE t.unread_count_solicitor + 1 END,
         unread_count_staff = CASE WHEN NEW.sender_type = 'staff'
              THEN t.unread_count_staff ELSE t.unread_count_staff + 1 END,
         unread_count_client = CASE
              WHEN NEW.is_internal OR NEW.scope <> 'solicitor_client' THEN t.unread_count_client
              WHEN NEW.sender_type = 'client' THEN t.unread_count_client
              ELSE t.unread_count_client + 1 END,
         unread_count_finance = CASE
              WHEN NEW.is_internal OR NEW.scope <> 'solicitor_finance' THEN t.unread_count_finance
              WHEN NEW.sender_type = 'finance_partner' THEN t.unread_count_finance
              ELSE t.unread_count_finance + 1 END,
         updated_at = now()
   WHERE t.id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_legal_thread_after_message ON public.legal_matter_messages;
CREATE TRIGGER trg_legal_thread_after_message
  AFTER INSERT ON public.legal_matter_messages
  FOR EACH ROW EXECUTE FUNCTION public.legal_thread_after_message();

-- ---------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------
ALTER TABLE public.legal_matter_threads REPLICA IDENTITY FULL;
ALTER TABLE public.legal_matter_messages REPLICA IDENTITY FULL;
ALTER TABLE public.solicitor_portal_notifications REPLICA IDENTITY FULL;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_threads;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.legal_matter_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.solicitor_portal_notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
