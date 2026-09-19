
-- ============================================================
-- Server-side notification triggers
-- These SECURITY DEFINER functions insert into the notifications
-- table automatically, so the client-side hooks are no longer needed.
-- ============================================================

-- 1. Investment Reports: status change → completed or failed
CREATE OR REPLACE FUNCTION public.notify_report_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'completed' AND OLD.status = 'pending' THEN
      INSERT INTO public.notifications (type, title, message, entity_id, read)
      VALUES (
        'report_generation_completed',
        'Report Ready',
        'Investment report for ' || COALESCE(NEW.property_address, 'Unknown property') || ' is ready to view',
        NEW.id::text,
        false
      );
    ELSIF NEW.status = 'failed' THEN
      INSERT INTO public.notifications (type, title, message, entity_id, read)
      VALUES (
        'report_generation_failed',
        'Report Generation Failed',
        'Failed to generate report for ' || COALESCE(NEW.property_address, 'Unknown property'),
        NEW.id::text,
        false
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_report_status ON public.investment_reports;
CREATE TRIGGER trg_notify_report_status
  AFTER UPDATE ON public.investment_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_report_status_change();

-- 2. Portal Report Requests: new request from client
CREATE OR REPLACE FUNCTION public.notify_portal_report_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  request_label text;
BEGIN
  request_label := INITCAP(REPLACE(COALESCE(NEW.request_type, 'report'), '_', ' '));
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'portal_report_requested',
    'New Report Request',
    'A client has requested a ' || request_label,
    NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_portal_report_request ON public.client_portal_report_requests;
CREATE TRIGGER trg_notify_portal_report_request
  AFTER INSERT ON public.client_portal_report_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_portal_report_request();

-- 3. Agency Agreements: new agreement generated
CREATE OR REPLACE FUNCTION public.notify_agreement_generated()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'agreement_generated',
    'Agreement Generated',
    'New agency agreement created for ' || COALESCE(NEW.buyer_names, 'Unknown buyer'),
    NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_agreement_generated ON public.agency_agreements;
CREATE TRIGGER trg_notify_agreement_generated
  AFTER INSERT ON public.agency_agreements
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_agreement_generated();

-- 4. Clients: new GHL contact synced
CREATE OR REPLACE FUNCTION public.notify_new_ghl_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  client_name text;
BEGIN
  -- Only fire for GHL-sourced contacts
  IF NEW.ghl_contact_id IS NULL THEN
    RETURN NEW;
  END IF;
  
  client_name := TRIM(COALESCE(NEW.primary_first_name, '') || ' ' || COALESCE(NEW.primary_surname, ''));
  IF client_name = '' THEN client_name := 'Unknown'; END IF;
  
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'new_ghl_contact',
    'New GHL Contact',
    client_name || ' has been synced from GoHighLevel',
    NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_ghl_contact ON public.clients;
CREATE TRIGGER trg_notify_new_ghl_contact
  AFTER INSERT ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_ghl_contact();

-- 5. Marketing Leads: new UTM/Meta attributed lead
CREATE OR REPLACE FUNCTION public.notify_new_marketing_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  source_name text;
  campaign_name text;
  msg text;
BEGIN
  source_name := COALESCE(NEW.utm_source, NEW.ghl_attribution_source, 'Unknown');
  campaign_name := COALESCE(NEW.utm_campaign, NEW.meta_campaign_name, '');
  
  IF campaign_name != '' THEN
    msg := 'New lead from ' || source_name || ' — ' || campaign_name;
  ELSE
    msg := 'New lead attributed to ' || source_name;
  END IF;
  
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'new_marketing_lead',
    'New Marketing Lead',
    msg,
    COALESCE(NEW.client_id::text, NEW.id::text),
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_new_marketing_lead ON public.lead_source_attributions;
CREATE TRIGGER trg_notify_new_marketing_lead
  AFTER INSERT ON public.lead_source_attributions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_marketing_lead();

-- 6. VAPI Call Logs: missed calls
CREATE OR REPLACE FUNCTION public.notify_missed_call()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_name text;
  is_missed boolean;
BEGIN
  is_missed := (
    NEW.call_direction = 'inbound' AND (
      NEW.call_status = 'no-answer' OR
      NEW.call_status = 'missed' OR
      (NEW.call_status = 'ended' AND NEW.duration_seconds IS NOT NULL AND NEW.duration_seconds < 5)
    )
  );
  
  IF NOT is_missed THEN
    RETURN NEW;
  END IF;
  
  -- For UPDATEs, only fire if status actually changed
  IF TG_OP = 'UPDATE' AND OLD.call_status IS NOT DISTINCT FROM NEW.call_status THEN
    RETURN NEW;
  END IF;
  
  caller_name := COALESCE(NEW.customer_name, NEW.phone_number, 'Unknown caller');
  
  INSERT INTO public.notifications (type, title, message, entity_id, read)
  VALUES (
    'missed_call',
    'Missed Call',
    'Missed call from ' || caller_name,
    NEW.id::text,
    false
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_missed_call ON public.vapi_call_logs;
CREATE TRIGGER trg_notify_missed_call
  AFTER INSERT OR UPDATE ON public.vapi_call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_missed_call();

-- 7. Client Reminders: due/overdue notifications via trigger on status or date
-- Instead of polling, we create a trigger that fires on INSERT of new reminders
-- The daily check for overdue reminders should be a scheduled function, 
-- but we can at least catch new reminders being created
CREATE OR REPLACE FUNCTION public.notify_reminder_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  client_name text;
  due_label text;
BEGIN
  -- Only for pending reminders with a due date
  IF NEW.status != 'pending' OR NEW.due_date IS NULL THEN
    RETURN NEW;
  END IF;
  
  -- Get client name
  SELECT TRIM(COALESCE(primary_first_name, '') || ' ' || COALESCE(primary_surname, ''))
  INTO client_name
  FROM public.clients WHERE id = NEW.client_id;
  
  IF client_name IS NULL OR client_name = '' THEN
    client_name := 'Unknown Client';
  END IF;
  
  -- Check if due today or overdue
  IF NEW.due_date::date < CURRENT_DATE THEN
    INSERT INTO public.notifications (type, title, message, entity_id, read)
    VALUES (
      'client_reminder_overdue',
      'Overdue: ' || COALESCE(NEW.title, 'Reminder'),
      'Reminder for ' || client_name || ' was due on ' || NEW.due_date::date::text,
      NEW.client_id::text,
      false
    );
  ELSIF NEW.due_date::date = CURRENT_DATE THEN
    INSERT INTO public.notifications (type, title, message, entity_id, read)
    VALUES (
      'client_reminder_due',
      'Due Today: ' || COALESCE(NEW.title, 'Reminder'),
      'Reminder for ' || client_name || ' is due today',
      NEW.client_id::text,
      false
    );
  ELSIF NEW.due_date::date = CURRENT_DATE + 1 THEN
    INSERT INTO public.notifications (type, title, message, entity_id, read)
    VALUES (
      'client_reminder_upcoming',
      'Tomorrow: ' || COALESCE(NEW.title, 'Reminder'),
      'Reminder for ' || client_name || ' is due tomorrow',
      NEW.client_id::text,
      false
    );
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_reminder_due ON public.client_reminders;
CREATE TRIGGER trg_notify_reminder_due
  AFTER INSERT ON public.client_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_reminder_due();
