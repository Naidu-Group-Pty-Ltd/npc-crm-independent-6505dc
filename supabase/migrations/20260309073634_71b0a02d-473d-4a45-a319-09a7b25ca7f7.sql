-- Portal messages table for client-advisor communication
CREATE TABLE public.client_portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  portal_user_id uuid REFERENCES public.client_portal_users(id) ON DELETE SET NULL,
  sender_type text NOT NULL CHECK (sender_type IN ('client', 'advisor')),
  sender_name text,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  read_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.client_portal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on portal messages"
  ON public.client_portal_messages
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Portal notifications table
CREATE TABLE public.client_portal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text,
  type text DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'action')),
  category text DEFAULT 'general' CHECK (category IN ('general', 'deal', 'document', 'message', 'property')),
  is_read boolean DEFAULT false,
  read_at timestamptz,
  action_url text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.client_portal_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on portal notifications"
  ON public.client_portal_notifications
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_portal_messages_client ON public.client_portal_messages(client_id, created_at DESC);
CREATE INDEX idx_portal_notifications_client ON public.client_portal_notifications(client_id, created_at DESC);
CREATE INDEX idx_portal_notifications_unread ON public.client_portal_notifications(client_id, is_read) WHERE is_read = false;