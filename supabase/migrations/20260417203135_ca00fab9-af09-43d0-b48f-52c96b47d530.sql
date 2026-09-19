-- Phase 6A: Secure Messaging — finance partners ↔ NPC staff per client
-- Phase 6D: Compliance reporting export (no schema needed beyond existing audit log)

-- Threads scoped per client. One thread per (client_id, finance_user_id) keeps the model simple
-- (finance partners only see threads for clients they're assigned to; NPC staff see all threads for a client).
CREATE TABLE IF NOT EXISTS public.finance_portal_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  finance_user_id uuid NOT NULL REFERENCES public.finance_portal_users(id) ON DELETE CASCADE,
  subject text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count_partner integer NOT NULL DEFAULT 0,
  unread_count_staff integer NOT NULL DEFAULT 0,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, finance_user_id)
);

CREATE INDEX IF NOT EXISTS idx_fpt_client ON public.finance_portal_threads(client_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_fpt_partner ON public.finance_portal_threads(finance_user_id, last_message_at DESC);

ALTER TABLE public.finance_portal_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages finance threads"
ON public.finance_portal_threads FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Messages within a thread.
-- sender_type: 'partner' (finance portal user) or 'staff' (internal NPC user)
CREATE TABLE IF NOT EXISTS public.finance_portal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.finance_portal_threads(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('partner','staff')),
  finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  staff_user_id uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  sender_name text,
  body text NOT NULL,
  attachment_path text,
  attachment_filename text,
  attachment_mime text,
  attachment_size_bytes bigint,
  is_read_by_partner boolean NOT NULL DEFAULT false,
  is_read_by_staff boolean NOT NULL DEFAULT false,
  read_by_partner_at timestamptz,
  read_by_staff_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpm_thread ON public.finance_portal_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fpm_client ON public.finance_portal_messages(client_id, created_at DESC);

ALTER TABLE public.finance_portal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages finance messages"
ON public.finance_portal_messages FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Trigger to keep thread metadata fresh on new messages
CREATE OR REPLACE FUNCTION public.fp_thread_after_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.finance_portal_threads
  SET
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.body, 200),
    unread_count_partner = CASE
      WHEN NEW.sender_type = 'staff' THEN unread_count_partner + 1
      ELSE unread_count_partner
    END,
    unread_count_staff = CASE
      WHEN NEW.sender_type = 'partner' THEN unread_count_staff + 1
      ELSE unread_count_staff
    END,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fp_thread_after_message ON public.finance_portal_messages;
CREATE TRIGGER trg_fp_thread_after_message
AFTER INSERT ON public.finance_portal_messages
FOR EACH ROW
EXECUTE FUNCTION public.fp_thread_after_message();

-- Updated_at trigger on threads
CREATE OR REPLACE FUNCTION public.fp_threads_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_fp_threads_updated_at ON public.finance_portal_threads;
CREATE TRIGGER trg_fp_threads_updated_at
BEFORE UPDATE ON public.finance_portal_threads
FOR EACH ROW
EXECUTE FUNCTION public.fp_threads_set_updated_at();

-- Storage bucket for message attachments (private, mediated through edge function)
INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-portal-messages', 'finance-portal-messages', false)
ON CONFLICT (id) DO NOTHING;

-- Service-role only access to bucket (handled in mediator function)
CREATE POLICY "Service role manages finance message attachments"
ON storage.objects FOR ALL TO service_role
USING (bucket_id = 'finance-portal-messages')
WITH CHECK (bucket_id = 'finance-portal-messages');
