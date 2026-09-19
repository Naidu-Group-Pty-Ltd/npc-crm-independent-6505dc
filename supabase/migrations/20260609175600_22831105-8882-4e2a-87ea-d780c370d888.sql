-- NPC Internal Messaging Workflow governance, visibility scopes, allocations, and safe backfill.

DO $$ BEGIN
  CREATE TYPE public.message_visibility_scope AS ENUM (
    'command_finance_private',
    'command_client_private',
    'command_client_with_finance_allocated',
    'finance_client_with_command_visibility',
    'internal_command_only'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.message_allocation_status AS ENUM (
    'none',
    'finance_action_required',
    'finance_review_required',
    'finance_input_required',
    'allocate_to_finance'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.message_governance_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  message_id uuid,
  source_table text,
  thread_id uuid,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  sender_user_id uuid,
  sender_portal text NOT NULL,
  recipient_portals text[] NOT NULL DEFAULT '{}',
  visibility_scope public.message_visibility_scope NOT NULL,
  thread_type text NOT NULL,
  allocation_status public.message_allocation_status NOT NULL DEFAULT 'none',
  notification_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  permission_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  attachment_metadata jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.message_governance_log TO service_role;

ALTER TABLE public.message_governance_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages message governance log" ON public.message_governance_log;
CREATE POLICY "Service role manages message governance log"
ON public.message_governance_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_message_governance_log_client_created
  ON public.message_governance_log(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_governance_log_thread_created
  ON public.message_governance_log(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_governance_log_message
  ON public.message_governance_log(message_id, source_table);
CREATE INDEX IF NOT EXISTS idx_message_governance_log_event
  ON public.message_governance_log(event_type, created_at DESC);

ALTER TABLE public.client_portal_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visibility_scope public.message_visibility_scope NOT NULL DEFAULT 'command_client_private',
  ADD COLUMN IF NOT EXISTS thread_type text NOT NULL DEFAULT 'command_client',
  ADD COLUMN IF NOT EXISTS allocation_status public.message_allocation_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS finance_allocated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allocated_finance_user_id uuid REFERENCES public.finance_portal_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS command_owner_user_id uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS permission_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_status jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.finance_portal_threads
  ADD COLUMN IF NOT EXISTS visibility_scope public.message_visibility_scope NOT NULL DEFAULT 'command_finance_private',
  ADD COLUMN IF NOT EXISTS thread_type text NOT NULL DEFAULT 'command_finance',
  ADD COLUMN IF NOT EXISTS allocation_status public.message_allocation_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS command_owner_user_id uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finance_allocated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permission_status jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.finance_portal_messages
  ADD COLUMN IF NOT EXISTS visibility_scope public.message_visibility_scope NOT NULL DEFAULT 'command_finance_private',
  ADD COLUMN IF NOT EXISTS thread_type text NOT NULL DEFAULT 'command_finance',
  ADD COLUMN IF NOT EXISTS allocation_status public.message_allocation_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS command_owner_user_id uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS permission_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_status jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.client_portal_messages
SET visibility_scope = CASE WHEN COALESCE(is_internal, false) THEN 'internal_command_only'::public.message_visibility_scope ELSE 'command_client_private'::public.message_visibility_scope END,
    thread_type = CASE WHEN COALESCE(is_internal, false) THEN 'internal_command' ELSE 'command_client' END,
    allocation_status = 'none'::public.message_allocation_status,
    finance_allocated = false,
    permission_status = CASE WHEN COALESCE(is_internal, false)
      THEN jsonb_build_object('command_centre', 'full', 'client_portal', 'blocked', 'finance_portal', 'blocked')
      ELSE jsonb_build_object('command_centre', 'full', 'client_portal', 'granted', 'finance_portal', 'blocked') END
WHERE permission_status = '{}'::jsonb;

UPDATE public.finance_portal_threads
SET visibility_scope = 'command_finance_private'::public.message_visibility_scope,
    thread_type = 'command_finance',
    allocation_status = 'none'::public.message_allocation_status,
    finance_allocated = false,
    permission_status = jsonb_build_object('command_centre', 'full', 'finance_portal', 'granted', 'client_portal', 'blocked')
WHERE permission_status = '{}'::jsonb;

UPDATE public.finance_portal_messages
SET visibility_scope = 'command_finance_private'::public.message_visibility_scope,
    thread_type = 'command_finance',
    allocation_status = 'none'::public.message_allocation_status,
    permission_status = jsonb_build_object('command_centre', 'full', 'finance_portal', 'granted', 'client_portal', 'blocked')
WHERE permission_status = '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_client_portal_messages_visibility
  ON public.client_portal_messages(client_id, visibility_scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_portal_messages_allocation
  ON public.client_portal_messages(client_id, finance_allocated, allocation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_portal_threads_visibility
  ON public.finance_portal_threads(finance_user_id, visibility_scope, allocation_status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_portal_messages_visibility
  ON public.finance_portal_messages(client_id, visibility_scope, allocation_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_client_portal_message_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.message_governance_log (
    event_type, message_id, source_table, thread_id, client_id, sender_user_id, sender_portal,
    recipient_portals, visibility_scope, thread_type, allocation_status,
    notification_status, permission_status, metadata
  ) VALUES (
    CASE
      WHEN NEW.sender_type = 'client' THEN 'client_replied'
      WHEN NEW.finance_allocated THEN 'finance_allocated'
      ELSE 'message_created'
    END,
    NEW.id, 'client_portal_messages', NEW.thread_id, NEW.client_id, NEW.command_owner_user_id,
    CASE WHEN NEW.sender_type = 'client' THEN 'client_portal' WHEN COALESCE(NEW.is_internal, false) THEN 'command_centre' ELSE 'command_centre' END,
    CASE
      WHEN NEW.visibility_scope = 'command_client_with_finance_allocated' THEN ARRAY['client_portal','finance_portal']
      WHEN NEW.visibility_scope = 'command_client_private' THEN ARRAY['client_portal']
      WHEN NEW.visibility_scope = 'internal_command_only' THEN ARRAY['command_centre']
      ELSE ARRAY['client_portal']
    END,
    NEW.visibility_scope, NEW.thread_type, NEW.allocation_status,
    NEW.notification_status,
    COALESCE(NULLIF(NEW.permission_status, '{}'::jsonb),
      CASE
        WHEN NEW.visibility_scope = 'command_client_with_finance_allocated' THEN jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','thread_granted')
        WHEN NEW.visibility_scope = 'internal_command_only' THEN jsonb_build_object('command_centre','full','client_portal','blocked','finance_portal','blocked')
        ELSE jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','blocked')
      END),
    jsonb_build_object('is_internal', COALESCE(NEW.is_internal, false), 'finance_allocated', NEW.finance_allocated)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_client_portal_message_governance ON public.client_portal_messages;
CREATE TRIGGER trg_log_client_portal_message_governance
AFTER INSERT ON public.client_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.log_client_portal_message_governance();

CREATE OR REPLACE FUNCTION public.log_finance_portal_message_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attachment jsonb;
BEGIN
  IF NEW.attachment_path IS NOT NULL THEN
    v_attachment := jsonb_build_object(
      'path', NEW.attachment_path,
      'filename', NEW.attachment_filename,
      'mime', NEW.attachment_mime,
      'size_bytes', NEW.attachment_size_bytes
    );
  END IF;

  INSERT INTO public.message_governance_log (
    event_type, message_id, source_table, thread_id, client_id, sender_user_id, sender_portal,
    recipient_portals, visibility_scope, thread_type, allocation_status,
    notification_status, permission_status, attachment_metadata, metadata
  ) VALUES (
    CASE
      WHEN NEW.sender_type = 'partner' THEN 'finance_replied'
      WHEN NEW.sender_type = 'client' THEN 'client_replied'
      ELSE 'message_created'
    END,
    NEW.id, 'finance_portal_messages', NEW.thread_id, NEW.client_id, NEW.staff_user_id,
    CASE
      WHEN NEW.sender_type = 'partner' THEN 'finance_portal'
      WHEN NEW.sender_type = 'client' THEN 'client_portal'
      ELSE 'command_centre'
    END,
    CASE
      WHEN NEW.visibility_scope = 'finance_client_with_command_visibility' AND NEW.sender_type = 'client' THEN ARRAY['finance_portal','command_centre']
      WHEN NEW.visibility_scope = 'finance_client_with_command_visibility' THEN ARRAY['client_portal','command_centre']
      WHEN NEW.visibility_scope = 'command_client_with_finance_allocated' THEN ARRAY['client_portal','finance_portal']
      WHEN NEW.visibility_scope = 'command_finance_private' THEN ARRAY['finance_portal']
      ELSE ARRAY['finance_portal']
    END,
    NEW.visibility_scope, NEW.thread_type, NEW.allocation_status,
    NEW.notification_status,
    COALESCE(NULLIF(NEW.permission_status, '{}'::jsonb),
      CASE
        WHEN NEW.visibility_scope = 'finance_client_with_command_visibility' THEN jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','granted')
        WHEN NEW.visibility_scope = 'command_client_with_finance_allocated' THEN jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','thread_granted')
        ELSE jsonb_build_object('command_centre','full','finance_portal','granted','client_portal','blocked')
      END),
    v_attachment,
    jsonb_build_object('has_attachment', NEW.attachment_path IS NOT NULL)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_finance_portal_message_governance ON public.finance_portal_messages;
CREATE TRIGGER trg_log_finance_portal_message_governance
AFTER INSERT ON public.finance_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.log_finance_portal_message_governance();

ALTER TABLE public.finance_portal_messages
  DROP CONSTRAINT IF EXISTS finance_portal_messages_sender_type_check;
ALTER TABLE public.finance_portal_messages
  ADD CONSTRAINT finance_portal_messages_sender_type_check CHECK (sender_type IN ('partner','staff','client'));

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
      WHEN NEW.sender_type IN ('staff','client') THEN unread_count_partner + 1
      ELSE unread_count_partner
    END,
    unread_count_staff = CASE
      WHEN NEW.sender_type IN ('partner','client') THEN unread_count_staff + 1
      ELSE unread_count_staff
    END,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

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
  v_sender_label  TEXT;
BEGIN
  IF NEW.sender_type NOT IN ('partner', 'client') THEN
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
  v_sender_label := CASE WHEN NEW.sender_type = 'client' THEN 'Client finance reply · ' ELSE 'New finance message · ' END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.type = 'finance_portal_message_received'
      AND n.metadata->>'message_id' = NEW.id::text
  ) THEN
    INSERT INTO public.notifications (type, title, message, entity_id, target_user_id, metadata)
    VALUES (
      'finance_portal_message_received',
      v_sender_label || COALESCE(v_client_name, 'Client'),
      v_preview,
      NEW.client_id::text,
      v_assigned_user,
      jsonb_build_object(
        'client_id', NEW.client_id,
        'thread_id', NEW.thread_id,
        'message_id', NEW.id,
        'sender_name', NEW.sender_name,
        'sender_type', NEW.sender_type,
        'visibility_scope', NEW.visibility_scope,
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

ALTER TABLE public.finance_portal_threads
  DROP CONSTRAINT IF EXISTS finance_portal_threads_client_id_finance_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_portal_threads_client_finance_type
  ON public.finance_portal_threads(client_id, finance_user_id, thread_type);

CREATE INDEX IF NOT EXISTS idx_finance_portal_threads_client_finance_scope
  ON public.finance_portal_threads(client_id, finance_user_id, visibility_scope, thread_type);