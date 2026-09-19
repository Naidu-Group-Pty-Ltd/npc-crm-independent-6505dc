-- 20260606161000_sync_client_current_address.sql
CREATE OR REPLACE FUNCTION public.sync_client_current_address()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_current IS TRUE AND NEW.contact_type = 'primary' AND NEW.additional_contact_id IS NULL THEN
    UPDATE public.clients
       SET current_address = COALESCE(NEW.address, current_address),
           country = COALESCE(NEW.country, country),
           living_situation = COALESCE(NEW.living_situation, living_situation),
           residential_status = COALESCE(NEW.residential_status, residential_status),
           updated_at = now()
     WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_client_current_address ON public.client_address_history;
CREATE TRIGGER trg_sync_client_current_address
  AFTER INSERT OR UPDATE OF address, country, living_situation, residential_status, is_current, contact_type, additional_contact_id
  ON public.client_address_history FOR EACH ROW EXECUTE FUNCTION public.sync_client_current_address();

UPDATE public.clients c
SET current_address = COALESCE(NULLIF(c.current_address, ''), ah.address),
    country = COALESCE(NULLIF(c.country, ''), ah.country),
    living_situation = COALESCE(NULLIF(c.living_situation, ''), ah.living_situation),
    residential_status = COALESCE(NULLIF(c.residential_status, ''), ah.residential_status),
    updated_at = now()
FROM (SELECT DISTINCT ON (client_id) client_id, address, country, living_situation, residential_status
      FROM public.client_address_history
      WHERE is_current IS TRUE AND contact_type = 'primary' AND additional_contact_id IS NULL
      ORDER BY client_id, start_date DESC NULLS LAST, created_at DESC) ah
WHERE c.id = ah.client_id AND (c.current_address IS NULL OR c.current_address = '');

-- 20260606162000_migrate_client_income_to_sources.sql
INSERT INTO public.client_income_sources (
  client_id, contact_type, source_category, source_type, source_name,
  gross_annual_amount, input_frequency, input_amount,
  bonus, commission, overtime_essential, overtime_non_essential,
  allowance, other_taxable_income,
  default_shading_rate, is_active, display_order, notes)
SELECT ci.client_id, COALESCE(NULLIF(ci.contact_type, ''), 'primary'),
  'employment', 'payg_fulltime', NULL,
  CASE lower(COALESCE(ci.salary_frequency, 'annual'))
    WHEN 'weekly' THEN COALESCE(ci.gross_salary,0)*52
    WHEN 'fortnightly' THEN COALESCE(ci.gross_salary,0)*26
    WHEN 'monthly' THEN COALESCE(ci.gross_salary,0)*12
    ELSE COALESCE(ci.gross_salary,0) END,
  CASE WHEN lower(COALESCE(ci.salary_frequency,'annual')) IN ('weekly','fortnightly','monthly')
    THEN lower(ci.salary_frequency) ELSE 'annual' END,
  COALESCE(ci.gross_salary,0), COALESCE(ci.bonus,0), COALESCE(ci.commission,0),
  COALESCE(ci.overtime_essential,0), COALESCE(ci.overtime_non_essential,0),
  COALESCE(ci.allowance,0), COALESCE(ci.other_taxable_income,0),
  1.0, true, 0, 'Migrated from legacy finance portal income'
FROM public.client_income ci
WHERE NOT EXISTS (SELECT 1 FROM public.client_income_sources s WHERE s.client_id = ci.client_id);

-- 20260606163000_client_portal_messages_internal.sql
ALTER TABLE public.client_portal_messages ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_client_portal_messages_internal ON public.client_portal_messages(client_id, is_internal);

-- 20260607160000_fix_purchase_file_status_history_actor_kind.sql
CREATE OR REPLACE FUNCTION public.bump_pf_last_partner_action()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.actor_kind IS NULL OR NEW.actor_kind IN ('finance_partner','finance_user','partner') THEN
    UPDATE public.purchase_files SET last_partner_action_at = now() WHERE id = NEW.purchase_file_id;
  END IF;
  RETURN NEW;
END; $$;

-- 20260609000000_fix_client_portal_message_notifications.sql
CREATE OR REPLACE FUNCTION public.notify_staff_on_client_portal_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_assigned_user UUID; v_client_name TEXT; v_preview TEXT;
BEGIN
  IF NEW.sender_type IS DISTINCT FROM 'client' THEN RETURN NEW; END IF;
  SELECT c.assigned_team_user_id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.primary_first_name, c.primary_surname)),''), c.primary_email, 'Client')
  INTO v_assigned_user, v_client_name FROM public.clients c WHERE c.id = NEW.client_id;
  v_preview := COALESCE(NULLIF(LEFT(BTRIM(COALESCE(NEW.message,'')),140),''), '(blank message)');
  IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.type='portal_message_received' AND n.metadata->>'message_id'=NEW.id::text) THEN
    INSERT INTO public.notifications (type,title,message,entity_id,target_user_id,metadata)
    VALUES ('portal_message_received','New message from ' || COALESCE(v_client_name,'a client'),v_preview,NEW.client_id::text,v_assigned_user,
      jsonb_build_object('client_id',NEW.client_id,'message_id',NEW.id,'sender_name',NEW.sender_name,'link_path','/clients?clientId='||NEW.client_id::text||'&tab=portal-messages'));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING '[notify_staff_on_client_portal_message] %', SQLERRM; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_staff_on_client_portal_message ON public.client_portal_messages;
CREATE TRIGGER trg_notify_staff_on_client_portal_message AFTER INSERT ON public.client_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_on_client_portal_message();

-- 20260609090000_three_way_address_sync.sql
ALTER TABLE public.client_address_history
  ADD COLUMN IF NOT EXISTS current_suburb text,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS current_postcode text;
ALTER TABLE public.client_additional_contacts
  ADD COLUMN IF NOT EXISTS current_suburb text,
  ADD COLUMN IF NOT EXISTS current_state text,
  ADD COLUMN IF NOT EXISTS current_postcode text;
CREATE INDEX IF NOT EXISTS idx_client_address_history_current_primary
  ON public.client_address_history (client_id, is_current, contact_type, start_date DESC, created_at DESC)
  WHERE contact_type = 'primary' AND additional_contact_id IS NULL;

CREATE OR REPLACE FUNCTION public.address_values_match(
  a_address text,a_suburb text,a_state text,a_postcode text,a_country text,
  b_address text,b_suburb text,b_state text,b_postcode text,b_country text
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(trim(coalesce(a_address,''))) = lower(trim(coalesce(b_address,'')))
     AND lower(trim(coalesce(a_suburb,''))) = lower(trim(coalesce(b_suburb,'')))
     AND upper(trim(coalesce(a_state,''))) = upper(trim(coalesce(b_state,'')))
     AND trim(coalesce(a_postcode,'')) = trim(coalesce(b_postcode,''))
     AND lower(trim(coalesce(a_country,'Australia'))) = lower(trim(coalesce(b_country,'Australia')));
$$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_current_primary_address()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_current IS TRUE THEN
    IF NEW.contact_type='primary' AND NEW.additional_contact_id IS NULL THEN
      UPDATE public.client_address_history SET is_current=false,
        end_date = COALESCE(end_date, COALESCE((NEW.start_date - INTERVAL '1 day')::date, CURRENT_DATE)),
        updated_at=now()
      WHERE client_id=NEW.client_id AND contact_type='primary' AND additional_contact_id IS NULL AND id<>NEW.id AND is_current IS TRUE;
    ELSIF NEW.contact_type='secondary' AND NEW.additional_contact_id IS NULL THEN
      UPDATE public.client_address_history SET is_current=false,
        end_date = COALESCE(end_date, COALESCE((NEW.start_date - INTERVAL '1 day')::date, CURRENT_DATE)),
        updated_at=now()
      WHERE client_id=NEW.client_id AND contact_type='secondary' AND additional_contact_id IS NULL AND id<>NEW.id AND is_current IS TRUE;
    ELSIF NEW.additional_contact_id IS NOT NULL THEN
      UPDATE public.client_address_history SET is_current=false,
        end_date = COALESCE(end_date, COALESCE((NEW.start_date - INTERVAL '1 day')::date, CURRENT_DATE)),
        updated_at=now()
      WHERE client_id=NEW.client_id AND additional_contact_id=NEW.additional_contact_id AND id<>NEW.id AND is_current IS TRUE;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_prevent_duplicate_current_primary_address ON public.client_address_history;
CREATE TRIGGER trg_prevent_duplicate_current_primary_address
  BEFORE INSERT OR UPDATE OF is_current, contact_type, additional_contact_id, start_date
  ON public.client_address_history FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_current_primary_address();

CREATE OR REPLACE FUNCTION public.sync_client_current_address()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE latest RECORD;
BEGIN
  SELECT * INTO latest FROM public.client_address_history
  WHERE client_id = COALESCE(NEW.client_id, OLD.client_id)
    AND is_current IS TRUE AND contact_type='primary' AND additional_contact_id IS NULL
  ORDER BY start_date DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1;
  IF FOUND THEN
    UPDATE public.clients
       SET current_address = NULLIF(latest.address,''),
           current_suburb = NULLIF(latest.current_suburb,''),
           current_state = NULLIF(upper(latest.current_state),''),
           current_postcode = NULLIF(latest.current_postcode,''),
           country = COALESCE(NULLIF(latest.country,''), country, 'Australia'),
           living_situation = NULLIF(latest.living_situation,''),
           residential_status = NULLIF(latest.residential_status,''),
           updated_at = now()
     WHERE id = latest.client_id;
  ELSE
    UPDATE public.clients SET current_address=NULL, current_suburb=NULL, current_state=NULL, current_postcode=NULL, updated_at=now()
    WHERE id = COALESCE(NEW.client_id, OLD.client_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_sync_client_current_address ON public.client_address_history;
CREATE TRIGGER trg_sync_client_current_address
  AFTER INSERT OR UPDATE OF address, current_suburb, current_state, current_postcode, country,
    living_situation, residential_status, is_current, contact_type, additional_contact_id, start_date
  ON public.client_address_history FOR EACH ROW EXECUTE FUNCTION public.sync_client_current_address();

DROP TRIGGER IF EXISTS trg_sync_client_current_address_delete ON public.client_address_history;
CREATE TRIGGER trg_sync_client_current_address_delete
  AFTER DELETE ON public.client_address_history FOR EACH ROW EXECUTE FUNCTION public.sync_client_current_address();

CREATE OR REPLACE FUNCTION public.sync_clients_primary_address_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_current RECORD; new_address text; new_suburb text; new_state text; new_postcode text; new_country text;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  new_address := NULLIF(trim(coalesce(NEW.current_address,'')),'');
  new_suburb := NULLIF(trim(coalesce(NEW.current_suburb,'')),'');
  new_state := NULLIF(upper(trim(coalesce(NEW.current_state,''))),'');
  new_postcode := NULLIF(trim(coalesce(NEW.current_postcode,'')),'');
  new_country := COALESCE(NULLIF(trim(coalesce(NEW.country,'')),''),'Australia');
  IF new_address IS NULL AND new_suburb IS NULL AND new_state IS NULL AND new_postcode IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO existing_current FROM public.client_address_history
  WHERE client_id=NEW.id AND is_current IS TRUE AND contact_type='primary' AND additional_contact_id IS NULL
  ORDER BY start_date DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST LIMIT 1;
  IF FOUND AND public.address_values_match(existing_current.address, existing_current.current_suburb, existing_current.current_state, existing_current.current_postcode, existing_current.country, new_address, new_suburb, new_state, new_postcode, new_country) THEN
    UPDATE public.client_address_history SET country=new_country, living_situation=NULLIF(NEW.living_situation,''), residential_status=NULLIF(NEW.residential_status,''), updated_at=now() WHERE id = existing_current.id;
    RETURN NEW;
  END IF;
  UPDATE public.client_address_history SET is_current=false, end_date=COALESCE(end_date, CURRENT_DATE), updated_at=now()
  WHERE client_id=NEW.id AND contact_type='primary' AND additional_contact_id IS NULL AND is_current IS TRUE;
  INSERT INTO public.client_address_history (client_id, contact_type, address, current_suburb, current_state, current_postcode, country, living_situation, residential_status, start_date, end_date, is_current, notes)
  VALUES (NEW.id, 'primary', new_address, new_suburb, new_state, new_postcode, new_country, NULLIF(NEW.living_situation,''), NULLIF(NEW.residential_status,''), CURRENT_DATE, NULL, true, 'Synced from Command Centre primary address');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_clients_primary_address_history ON public.clients;
CREATE TRIGGER trg_sync_clients_primary_address_history
  AFTER INSERT OR UPDATE OF current_address, current_suburb, current_state, current_postcode, country, living_situation, residential_status
  ON public.clients FOR EACH ROW EXECUTE FUNCTION public.sync_clients_primary_address_history();

UPDATE public.client_address_history ah
SET current_suburb = COALESCE(NULLIF(ah.current_suburb,''), NULLIF(c.current_suburb,'')),
    current_state = COALESCE(NULLIF(ah.current_state,''), NULLIF(c.current_state,'')),
    current_postcode = COALESCE(NULLIF(ah.current_postcode,''), NULLIF(c.current_postcode,'')),
    updated_at = now()
FROM public.clients c
WHERE ah.client_id=c.id AND ah.is_current IS TRUE AND ah.contact_type='primary' AND ah.additional_contact_id IS NULL;

UPDATE public.clients c
SET current_address=ah.address, current_suburb=ah.current_suburb, current_state=ah.current_state, current_postcode=ah.current_postcode,
    country=COALESCE(ah.country, c.country, 'Australia'), living_situation=ah.living_situation, residential_status=ah.residential_status,
    updated_at=now()
FROM (SELECT DISTINCT ON (client_id) client_id, address, current_suburb, current_state, current_postcode, country, living_situation, residential_status
      FROM public.client_address_history WHERE is_current IS TRUE AND contact_type='primary' AND additional_contact_id IS NULL
      ORDER BY client_id, start_date DESC NULLS LAST, updated_at DESC NULLS LAST, created_at DESC NULLS LAST) ah
WHERE c.id=ah.client_id;

-- 20260609090100_internal_messaging_governance.sql
DO $$ BEGIN CREATE TYPE public.message_visibility_scope AS ENUM ('command_finance_private','command_client_private','command_client_with_finance_allocated','finance_client_with_command_visibility','internal_command_only');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.message_allocation_status AS ENUM ('none','finance_action_required','finance_review_required','finance_input_required','allocate_to_finance');
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_governance_log TO authenticated;
GRANT ALL ON public.message_governance_log TO service_role;
ALTER TABLE public.message_governance_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages message governance log" ON public.message_governance_log;
CREATE POLICY "Service role manages message governance log" ON public.message_governance_log FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_message_governance_log_client_created ON public.message_governance_log(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_governance_log_thread_created ON public.message_governance_log(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_governance_log_message ON public.message_governance_log(message_id, source_table);
CREATE INDEX IF NOT EXISTS idx_message_governance_log_event ON public.message_governance_log(event_type, created_at DESC);

ALTER TABLE public.client_portal_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid,
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
SET visibility_scope = CASE WHEN COALESCE(is_internal,false) THEN 'internal_command_only'::public.message_visibility_scope ELSE 'command_client_private'::public.message_visibility_scope END,
    thread_type = CASE WHEN COALESCE(is_internal,false) THEN 'internal_command' ELSE 'command_client' END,
    allocation_status = 'none'::public.message_allocation_status, finance_allocated=false,
    permission_status = CASE WHEN COALESCE(is_internal,false)
      THEN jsonb_build_object('command_centre','full','client_portal','blocked','finance_portal','blocked')
      ELSE jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','blocked') END
WHERE permission_status = '{}'::jsonb;

UPDATE public.finance_portal_threads
SET visibility_scope='command_finance_private'::public.message_visibility_scope, thread_type='command_finance',
    allocation_status='none'::public.message_allocation_status, finance_allocated=false,
    permission_status=jsonb_build_object('command_centre','full','finance_portal','granted','client_portal','blocked')
WHERE permission_status = '{}'::jsonb;

UPDATE public.finance_portal_messages
SET visibility_scope='command_finance_private'::public.message_visibility_scope, thread_type='command_finance',
    allocation_status='none'::public.message_allocation_status,
    permission_status=jsonb_build_object('command_centre','full','finance_portal','granted','client_portal','blocked')
WHERE permission_status = '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_client_portal_messages_visibility ON public.client_portal_messages(client_id, visibility_scope, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_client_portal_messages_allocation ON public.client_portal_messages(client_id, finance_allocated, allocation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_portal_threads_visibility ON public.finance_portal_threads(finance_user_id, visibility_scope, allocation_status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_portal_messages_visibility ON public.finance_portal_messages(client_id, visibility_scope, allocation_status, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_client_portal_message_governance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.message_governance_log (event_type, message_id, source_table, thread_id, client_id, sender_user_id, sender_portal, recipient_portals, visibility_scope, thread_type, allocation_status, notification_status, permission_status, metadata)
  VALUES (
    CASE WHEN NEW.sender_type='client' THEN 'client_replied' WHEN NEW.finance_allocated THEN 'finance_allocated' ELSE 'message_created' END,
    NEW.id, 'client_portal_messages', NEW.thread_id, NEW.client_id, NEW.command_owner_user_id,
    CASE WHEN NEW.sender_type='client' THEN 'client_portal' ELSE 'command_centre' END,
    CASE WHEN NEW.visibility_scope='command_client_with_finance_allocated' THEN ARRAY['client_portal','finance_portal']
         WHEN NEW.visibility_scope='command_client_private' THEN ARRAY['client_portal']
         WHEN NEW.visibility_scope='internal_command_only' THEN ARRAY['command_centre']
         ELSE ARRAY['client_portal'] END,
    NEW.visibility_scope, NEW.thread_type, NEW.allocation_status, NEW.notification_status,
    COALESCE(NULLIF(NEW.permission_status,'{}'::jsonb),
      CASE WHEN NEW.visibility_scope='command_client_with_finance_allocated' THEN jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','thread_granted')
           WHEN NEW.visibility_scope='internal_command_only' THEN jsonb_build_object('command_centre','full','client_portal','blocked','finance_portal','blocked')
           ELSE jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','blocked') END),
    jsonb_build_object('is_internal', COALESCE(NEW.is_internal,false), 'finance_allocated', NEW.finance_allocated)
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_log_client_portal_message_governance ON public.client_portal_messages;
CREATE TRIGGER trg_log_client_portal_message_governance AFTER INSERT ON public.client_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.log_client_portal_message_governance();

CREATE OR REPLACE FUNCTION public.log_finance_portal_message_governance()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_attachment jsonb;
BEGIN
  IF NEW.attachment_path IS NOT NULL THEN
    v_attachment := jsonb_build_object('path', NEW.attachment_path, 'filename', NEW.attachment_filename, 'mime', NEW.attachment_mime, 'size_bytes', NEW.attachment_size_bytes);
  END IF;
  INSERT INTO public.message_governance_log (event_type, message_id, source_table, thread_id, client_id, sender_user_id, sender_portal, recipient_portals, visibility_scope, thread_type, allocation_status, notification_status, permission_status, attachment_metadata, metadata)
  VALUES (
    CASE WHEN NEW.sender_type='partner' THEN 'finance_replied' WHEN NEW.sender_type='client' THEN 'client_replied' ELSE 'message_created' END,
    NEW.id, 'finance_portal_messages', NEW.thread_id, NEW.client_id, NEW.staff_user_id,
    CASE WHEN NEW.sender_type='partner' THEN 'finance_portal' WHEN NEW.sender_type='client' THEN 'client_portal' ELSE 'command_centre' END,
    CASE WHEN NEW.visibility_scope='finance_client_with_command_visibility' AND NEW.sender_type='client' THEN ARRAY['finance_portal','command_centre']
         WHEN NEW.visibility_scope='finance_client_with_command_visibility' THEN ARRAY['client_portal','command_centre']
         WHEN NEW.visibility_scope='command_client_with_finance_allocated' THEN ARRAY['client_portal','finance_portal']
         WHEN NEW.visibility_scope='command_finance_private' THEN ARRAY['finance_portal']
         ELSE ARRAY['finance_portal'] END,
    NEW.visibility_scope, NEW.thread_type, NEW.allocation_status, NEW.notification_status,
    COALESCE(NULLIF(NEW.permission_status,'{}'::jsonb),
      CASE WHEN NEW.visibility_scope='finance_client_with_command_visibility' THEN jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','granted')
           WHEN NEW.visibility_scope='command_client_with_finance_allocated' THEN jsonb_build_object('command_centre','full','client_portal','granted','finance_portal','thread_granted')
           ELSE jsonb_build_object('command_centre','full','finance_portal','granted','client_portal','blocked') END),
    v_attachment,
    jsonb_build_object('has_attachment', NEW.attachment_path IS NOT NULL)
  );
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_log_finance_portal_message_governance ON public.finance_portal_messages;
CREATE TRIGGER trg_log_finance_portal_message_governance AFTER INSERT ON public.finance_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.log_finance_portal_message_governance();

ALTER TABLE public.finance_portal_messages DROP CONSTRAINT IF EXISTS finance_portal_messages_sender_type_check;
ALTER TABLE public.finance_portal_messages ADD CONSTRAINT finance_portal_messages_sender_type_check CHECK (sender_type IN ('partner','staff','client'));

CREATE OR REPLACE FUNCTION public.fp_thread_after_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.finance_portal_threads
  SET last_message_at=NEW.created_at, last_message_preview=LEFT(NEW.body,200),
    unread_count_partner = CASE WHEN NEW.sender_type IN ('staff','client') THEN unread_count_partner+1 ELSE unread_count_partner END,
    unread_count_staff = CASE WHEN NEW.sender_type IN ('partner','client') THEN unread_count_staff+1 ELSE unread_count_staff END,
    updated_at=now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.notify_staff_on_finance_portal_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_assigned_user UUID; v_client_name TEXT; v_preview TEXT; v_sender_label TEXT;
BEGIN
  IF NEW.sender_type NOT IN ('partner','client') THEN RETURN NEW; END IF;
  SELECT c.assigned_team_user_id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.primary_first_name, c.primary_surname)),''), c.primary_email, 'Client')
  INTO v_assigned_user, v_client_name FROM public.clients c WHERE c.id=NEW.client_id;
  v_preview := COALESCE(NULLIF(LEFT(BTRIM(COALESCE(NEW.body,'')),140),''),'(attachment)');
  v_sender_label := CASE WHEN NEW.sender_type='client' THEN 'Client finance reply · ' ELSE 'New finance message · ' END;
  IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.type='finance_portal_message_received' AND n.metadata->>'message_id'=NEW.id::text) THEN
    INSERT INTO public.notifications (type,title,message,entity_id,target_user_id,metadata)
    VALUES ('finance_portal_message_received', v_sender_label || COALESCE(v_client_name,'Client'), v_preview, NEW.client_id::text, v_assigned_user,
      jsonb_build_object('client_id',NEW.client_id,'thread_id',NEW.thread_id,'message_id',NEW.id,'sender_name',NEW.sender_name,'sender_type',NEW.sender_type,'visibility_scope',NEW.visibility_scope,'link_path','/clients?clientId='||NEW.client_id::text||'&tab=finance-messages'));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RAISE WARNING '[notify_staff_on_finance_portal_message] %', SQLERRM; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_notify_staff_on_finance_portal_message ON public.finance_portal_messages;
CREATE TRIGGER trg_notify_staff_on_finance_portal_message AFTER INSERT ON public.finance_portal_messages
FOR EACH ROW EXECUTE FUNCTION public.notify_staff_on_finance_portal_message();

ALTER TABLE public.finance_portal_threads DROP CONSTRAINT IF EXISTS finance_portal_threads_client_id_finance_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_portal_threads_client_finance_type ON public.finance_portal_threads(client_id, finance_user_id, thread_type);
CREATE INDEX IF NOT EXISTS idx_finance_portal_threads_client_finance_scope ON public.finance_portal_threads(client_id, finance_user_id, visibility_scope, thread_type);

-- 20260610120000_template_reconstruct_agent_assignment.sql
INSERT INTO public.agent_model_assignments (agent_key, agent_label, agent_category, agent_description, route, model_id, fallback_chain, temperature, max_tokens, reasoning_effort, is_locked)
VALUES ('template_reconstruct_agent', 'Template Reconstruction', 'template',
  'Reconstructs PDFs / images / code into editable templates (Claude-primary; native vision + PDF, strict tool output).',
  'native', 'claude-opus-4-8',
  '[{"route":"gateway","model_id":"google/gemini-3-pro-preview"},{"route":"gateway","model_id":"openai/gpt-5"}]'::jsonb,
  NULL, 8192, 'high', false)
ON CONFLICT (agent_key) DO UPDATE SET
  agent_label=excluded.agent_label, agent_category=excluded.agent_category, agent_description=excluded.agent_description,
  route=excluded.route, model_id=excluded.model_id, fallback_chain=excluded.fallback_chain,
  max_tokens=excluded.max_tokens, reasoning_effort=excluded.reasoning_effort, updated_at=now();